import FLOW from "./quest-flow.json" with { type: "json" };
import * as legacy from "./legacy-engine.mjs";
import { teamsFor, roomLimits } from "./room-scenario.mjs";
export const GameError = legacy.GameError;
const check = (ok,message,status=409) => { if(!ok) throw new GameError(message,status); };
const copy = value => JSON.parse(JSON.stringify(value));
const ids = room => teamsFor(room).map(t=>t.id);
export const normalizeAnswer = value => value.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё","е").replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim();
const normalizeCode = value => value.normalize("NFKC").replace(/\s+/g,"").toUpperCase();
function answerLines(value,limit) {
  if(value===undefined)return [];
  check(typeof value==="string"||Array.isArray(value),"Напишите ответы текстом.",400);
  const parts=Array.isArray(value)?value:[value];
  check(parts.length<=limit+1&&parts.every(part=>typeof part==="string"),"Напишите ответы текстом.",400);
  const text=parts.join("\n");
  check(text.length<=limit,"Ответ слишком длинный: не больше "+limit+" символов на вопрос.",400);
  return text.split(/\r\n?|\n/u).map(line=>line.trim()).filter(Boolean);
}
function findAnswerIds(question,text) {
  const words=normalizeAnswer(text).split(" ").filter(Boolean);
  const variants=question.answers.flatMap(answer=>answer.variants.map(variant=>({id:answer.id,words:normalizeAnswer(variant).split(" ")})))
    .sort((a,b)=>b.words.length-a.words.length);
  const found=new Set();
  // Match complete words, preferring longer phrases; never count a substring or a synonym twice.
  for(let index=0;index<words.length;) {
    const match=variants.find(variant=>variant.words.every((word,offset)=>words[index+offset]===word));
    if(match){found.add(match.id);index+=match.words.length;}else index++;
  }
  return [...found];
}
export function validateScoring(input,base=FLOW.scoring) {
  if(input===undefined) input={};
  check(input && typeof input==="object" && !Array.isArray(input),"Проверьте настройки очков.",400);
  check(Object.keys(input).every(key=>Object.hasOwn(FLOW.scoring,key)),"Неизвестная настройка очков.",400);
  const result={...base,...input};
  check(Object.values(result).every(n=>Number.isInteger(n)&&n>=0&&n<=10000),"Очки должны быть целыми числами от 0 до 10000.",400);
  return result;
}
export function validateFlow(stages) {
  const validId=id=>typeof id==="string"&&/^[a-z][a-z0-9-]{0,63}$/.test(id);
  const requireConfig=ok=>{if(!ok)throw new Error("Некорректная конфигурация вопросов, кодов или подсказок.");};
  requireConfig(Array.isArray(stages)&&stages.length>0&&new Set(stages.map(s=>s.id)).size===stages.length);
  for(const stage of stages) {
    requireConfig(validId(stage.id)&&["code","questions"].includes(stage.type)&&typeof stage.title==="string");
    requireConfig(Array.isArray(stage.hintParts)&&stage.hintParts.length>0&&stage.hintParts.every(s=>typeof s==="string"&&s.trim()));
    if(stage.type==="code")requireConfig(typeof stage.code==="string"&&stage.code.trim().length>0&&stage.code.length<=64);
    else {
      requireConfig(Array.isArray(stage.questions)&&stage.questions.length>0&&stage.questions.length<=8&&new Set(stage.questions.map(q=>q.id)).size===stage.questions.length);
      for(const q of stage.questions) {
        requireConfig(validId(q.id)&&typeof q.prompt==="string"&&Array.isArray(q.answers)&&Number.isInteger(q.required)&&q.required>0&&Number.isInteger(q.maxAnswers)&&q.maxAnswers<=5&&q.maxAnswers>=q.required&&q.answers.length>=q.required);
        const aliases=new Map(),canonical=new Set();
        for(const answer of q.answers) {
          requireConfig(validId(answer.id)&&!canonical.has(answer.id)&&Array.isArray(answer.variants)&&answer.variants.length>0);canonical.add(answer.id);
          for(const variant of answer.variants) {
            requireConfig(typeof variant==="string"&&normalizeAnswer(variant));const normalized=normalizeAnswer(variant);
            requireConfig(!aliases.has(normalized)||aliases.get(normalized)===answer.id);aliases.set(normalized,answer.id);
          }
        }
      }
    }
  }
}
export const flowConfig = () => ({ ...roomLimits(), scoring:copy(FLOW.scoring), engine:"quest-flow-v2", demo:FLOW.demo, stages:FLOW.stages.map(s=>({id:s.id,title:s.title,type:s.type})) });
export function createRoom(code,now,makeToken,count,options={}) {
  validateFlow(FLOW.stages);
  const room=legacy.createRoom(code,now,makeToken,count);
  room.engine="quest-flow-v2";room.flow=copy(FLOW.stages);room.demo=FLOW.demo;
  room.scoring=validateScoring(options.scoring);
  room.runs=Object.fromEntries(ids(room).map(id=>[id,{stageIndex:0,cleared:false,done:false,found:{},submissions:{},history:[],videos:[],thanks:{},codeAttempts:0,lastCodeAttempt:0,result:""}]));
  delete room.testMode;delete room.rounds;delete room.orders;delete room.proposal;delete room.ready;
  return room;
}
function credit(room,team,key,points,label,stageId,now) {
  room.scoreAwards ||= {};if(room.scoreAwards[key]) return false;
  room.scoreAwards[key]=true;
  room.scores[team]=(room.scores[team]||0)+points;
  if(points) {
    room.scoreEvents.push({id:++room.scoreSequence,team,points,label,stageId,at:now});
    room.scoreEvents=room.scoreEvents.slice(-32);
  }
  return true;
}
function unlock(run,videoIds=[]) { for(const id of videoIds) if(!run.videos.includes(id))run.videos.push(id); }
function complete(room,team,stage,run,now) {
  if(run.cleared)return;
  run.cleared=true;run.history.push(stage.id);unlock(run,stage.videoIds);
  credit(room,team,team+":"+stage.id+":complete",room.scoring.stage,"Этап пройден",stage.id,now);
}
function submitQuestions(room,team,stage,run,data,now) {
  const answers=data.answers;
  check(answers&&typeof answers==="object"&&!Array.isArray(answers),"Введите ответы.",400);
  const qids=stage.questions.map(q=>q.id);
  check(Object.keys(answers).every(id=>qids.includes(id)),"Неизвестный вопрос.",400);
  const inputs=Object.fromEntries(stage.questions.map(q=>[q.id,answerLines(Object.hasOwn(answers,q.id)?answers[q.id]:undefined,160*q.maxAnswers)]));
  check(Object.values(inputs).some(lines=>lines.length),"Напишите хотя бы один ответ.",400);
  const found=run.found[stage.id] ||= {};
  for(const q of stage.questions) {
    const accepted=found[q.id] ||= [];
    for(const answerId of findAnswerIds(q,inputs[q.id].join("\n"))) {
      if(accepted.includes(answerId)||accepted.length>=q.maxAnswers)continue;
      accepted.push(answerId);
      credit(room,team,team+":"+stage.id+":"+q.id+":"+answerId,room.scoring.answer,"Засчитан ответ на вопрос",stage.id,now);
    }
    if(accepted.length>=q.required&&q.videoId)unlock(run,[q.videoId]);
  }
  run.submissions[stage.id]={answers:inputs,at:now};
  const total=Object.values(found).reduce((sum,list)=>sum+list.length,0);
  const missing=stage.questions.reduce((sum,q)=>sum+Math.max(0,q.required-found[q.id].length),0);
  run.result=missing?"Засчитано на этапе: "+total+". До завершения не хватает ответов: "+missing+".":"Нужные ответы засчитаны! Открыт ролик.";
  if(!missing)complete(room,team,stage,run,now);
}
function actFlow(room,role,action,data={},now=Date.now()) {
  check(role==="host"||ids(room).includes(role),"Команда не входит в комнату.",403);
  check(room.phase!=="closed","Комната закрыта.");
  if(action==="close") {check(role==="host","Только ведущий завершает комнату.",403);room.phase="closed";room.version++;return;}
  if(action==="setScoring") {
    check(role==="host","Очки настраивает ведущий.",403);check(room.phase!=="finished","Игра уже закончилась.");
    room.scoring=validateScoring(data.scoring,room.scoring);
  } else if(action==="start") {
    check(role==="host","Запускает игру ведущий.",403);check(room.phase==="lobby","Игра уже началась.");
    check(ids(room).every(id=>room.members[id].joined),"Подключите все выбранные команды.");
    room.phase="playing";
  } else {
    check(role!=="host","Это действие выполняет телефон команды.",403);
    check(room.phase==="playing","Дождитесь начала игры.");
    const run=room.runs[role];
    check(!run.done,"Ваша команда уже завершила игру.");
    check(data.roundIndex===run.stageIndex,"Этап уже изменился. Обновите экран.");
    const stage=room.flow[run.stageIndex];
    if(action==="thank") {
      check(ids(room).includes(data.helper)&&data.helper!==role,"Выберите другую команду.",400);
      check(room.members[data.helper].joined,"Эта команда ещё не подключилась.");
      check(room.scoring.thanks>0,"Бонус за подсказку выключен ведущим.");
      if(run.thanks[stage.id]) {
        check(run.thanks[stage.id]===data.helper,"На этом этапе вы уже поблагодарили команду.");return;
      }
      const sender=teamsFor(room).find(t=>t.id===role);
      credit(room,data.helper,role+":"+stage.id+":thanks",room.scoring.thanks,"Подсказка команде «"+sender.name+"»",stage.id,now);
      run.thanks[stage.id]=data.helper;
    } else if(action==="continue") {
      check(run.cleared,"Сначала выполните задание.");
      if(run.stageIndex===room.flow.length-1)run.done=true;
      else {run.stageIndex++;run.cleared=false;run.result="";run.lastCodeAttempt=0;}
      if(ids(room).every(id=>room.runs[id].done))room.phase="finished";
    } else if(action==="submitQuestions") {
      check(stage.type==="questions","На этом этапе нужно ввести код.");
      if(run.cleared)return;
      submitQuestions(room,role,stage,run,data,now);
    } else if(action==="submitCode") {
      check(stage.type==="code","На этом этапе нужно ответить на вопросы.");
      if(run.cleared)return;
      check(typeof data.code==="string"&&data.code.trim().length>0&&data.code.length<=64,"Введите код.",400);
      check(!run.lastCodeAttempt||now-run.lastCodeAttempt>=1000,"Подождите секунду перед следующей попыткой.",429);
      run.lastCodeAttempt=now;run.codeAttempts++;
      if(normalizeCode(data.code)===normalizeCode(stage.code)) {
        credit(room,role,role+":"+stage.id+":code",room.scoring.code,"Верный код",stage.id,now);
        run.result="Код верный! Открыт новый ролик.";complete(room,role,stage,run,now);
      } else run.result="Код пока не подошёл. Сверьте подсказки или попросите помощь другой команды.";
    } else throw new GameError("Неизвестное действие.",400);
  }
  room.version++;
}
export function dispatch(room,role,action,data={},now=Date.now()) {
  if(room.engine!=="quest-flow-v2")return legacy.dispatch(room,role,action,data,now);
  check(data.asTeam===undefined,"Действуйте с телефона своей команды.",403);
  actFlow(room,role,action,data,now);
}
export function act(room,role,action,data={},now=Date.now()) {
  if(room.engine!=="quest-flow-v2")return legacy.act(room,role,action,data,now);
  return actFlow(room,role,action,data,now);
}
function publicStage(stage) {
  return {id:stage.id,title:stage.title,type:stage.type,prompt:stage.prompt,
    questions:stage.questions?.map(q=>({id:q.id,prompt:q.prompt,required:q.required,maxAnswers:q.maxAnswers}))||[]};
}
function hintFor(room,stage,role) {
  const index=ids(room).indexOf(role),parts=stage.hintParts||[];
  const assigned=parts.filter((_,i)=>i%ids(room).length===index);
  return (assigned.length?assigned:[parts[index%parts.length]]).filter(Boolean).join(" ");
}
function stats(room,id) {
  const run=room.runs[id];
  return {stageIndex:run.stageIndex,cleared:run.cleared,done:run.done,
    relevant:Object.values(run.found).reduce((sum,questions)=>sum+Object.values(questions).reduce((n,answers)=>n+answers.length,0),0),
    codes:room.flow.filter(s=>s.type==="code"&&run.history.includes(s.id)).length};
}
export function view(room,role) {
  if(room.engine!=="quest-flow-v2")return legacy.view(room,role);
  const own=room.runs[role],playing=room.phase!=="lobby";
  const stage=own?room.flow[own.stageIndex]:null;
  const result={engine:room.engine,code:room.code,role,version:room.version,phase:room.phase,demo:room.demo,
    roundIndex:own?.stageIndex||0,total:room.flow.length,teamCount:ids(room).length,expiresAt:room.expiresAt,
    scoring:copy(room.scoring),scoreEvents:copy(room.scoreEvents),
    teams:teamsFor(room).map(t=>({...t,score:room.scores[t.id]||0,joined:room.members[t.id].joined,...stats(room,t.id)})),
    stages:room.flow.map(s=>({id:s.id,title:s.title,type:s.type})),
    stage:own&&playing?publicStage(stage):null};
  if(role==="host") {
    result.invites=Object.fromEntries(ids(room).map(id=>[id,room.members[id].invite]));
    result.runs=Object.fromEntries(ids(room).map(id=>[id,{...stats(room,id),submissions:copy(room.runs[id].submissions),
      acceptedByStage:Object.fromEntries(Object.entries(room.runs[id].found).map(([stageId,questions])=>[stageId,Object.fromEntries(Object.entries(questions).map(([qid,answers])=>[qid,answers.length]))]))}]));
    result.guide=copy(room.flow);
  } else if(own&&playing) {
    const stageVideoIds=[...(stage.videoIds||[]),...(stage.questions||[]).map(q=>q.videoId).filter(Boolean)];
    result.run={...stats(room,role),result:own.result,videos:[...own.videos],stageVideos:own.videos.filter(id=>stageVideoIds.includes(id)),thanked:own.thanks[stage.id]||null,
      accepted:Object.fromEntries((stage.questions||[]).map(q=>[q.id,(own.found[stage.id]?.[q.id]||[]).length])),
      submission:copy(own.submissions[stage.id]?.answers||{})};
    result.hints=room.flow.slice(0,own.stageIndex+1).map(s=>({id:s.id,title:s.title,text:hintFor(room,s,role)}));
  }
  return result;
}
export const authorize=legacy.authorize;
export const joinRoom=legacy.joinRoom;
export const validateTeamCount=legacy.validateTeamCount;
