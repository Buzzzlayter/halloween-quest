import FLOW from "./quest-flow.json" with { type: "json" };
import * as legacy from "./legacy-engine.mjs";
import { teamsFor, roomLimits } from "./room-scenario.mjs";
export const GameError = legacy.GameError;
const check = (ok,message,status=409) => { if(!ok) throw new GameError(message,status); };
const copy = value => JSON.parse(JSON.stringify(value));
const ids = room => teamsFor(room).map(t=>t.id);
const activeIds = room => ids(room).filter(id=>room.members[id].active!==false);
function settleRoom(room,now) {
  const active=activeIds(room);
  if(room.phase==="lobby"&&active.length&&active.every(id=>room.members[id].joined)) {
    room.phase="playing";room.phaseStarted=now;
  }
  if(room.phase==="playing"&&active.length&&active.every(id=>room.runs[id].done)) {
    room.phase="finished";room.finishedAt=now;room.finishReason="completed";
  }
}
import { normalizeAnswer, validateFlow, validateTaskBank } from "./quest-config.mjs";
import BANK from "./task-bank.json" with { type: "json" };
import { dealQuest } from "./task-dealer.mjs";
export { normalizeAnswer, validateFlow } from "./quest-config.mjs";
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
export const flowConfig = () => ({ ...roomLimits(), scoring:copy(FLOW.scoring), engine:"quest-flow-v2", demo:FLOW.demo, randomized:true, stages:FLOW.stages.map(s=>({id:s.id,title:s.title,type:s.type})) });
const flowFor=(room,role)=>room.teamFlows?.[role]||room.flow;
export function createRoom(code,now,makeToken,count,options={}) {
  validateTaskBank(FLOW,BANK,roomLimits().maxTeams);
  const room=legacy.createRoom(code,now,makeToken,count);
  room.engine="quest-flow-v2";room.flow=copy(FLOW.stages);room.demo=FLOW.demo;
  Object.assign(room,dealQuest(FLOW,BANK,room.teams));
  for(const flow of Object.values(room.teamFlows))validateFlow(flow);
  room.bankVersion=BANK.version;
  room.questionPolicy="final-once-v1";
  room.taskCatalog=BANK.questions.map(q=>({id:q.id,prompt:q.prompt,videoId:q.videoId}));
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
const stageVideos=stage=>[...(stage.videoIds||[]),...(stage.questions||[]).map(q=>q.videoId).filter(Boolean)];
function visibleVideos(room,role) {
  const run=room.runs[role],flow=flowFor(room,role);
  // Older snapshots may contain videos unlocked by a wrong code attempt.
  const locked=new Set(flow.filter(s=>s.type==="code"&&!run.history.includes(s.id)).flatMap(stageVideos));
  const videos=run.videos.filter(id=>!locked.has(id));
  // Include older completed attempts too, without rewriting their scores or saved results.
  for(const stage of flow)if(run.history.includes(stage.id))for(const id of stageVideos(stage))if(!videos.includes(id))videos.push(id);
  return videos;
}
function complete(room,team,stage,run,now,reward=true) {
  if(run.cleared)return;
  run.cleared=true;run.history.push(stage.id);unlock(run,stageVideos(stage));
  if(reward) {
    credit(room,team,team+":"+stage.id+":complete",room.scoring.stage,"Этап пройден",stage.id,now);
  }
}
function submitQuestions(room,team,stage,run,data,now,final=false) {
  const answers=data.answers;
  check(answers&&typeof answers==="object"&&!Array.isArray(answers),"Введите ответы.",400);
  const qids=stage.questions.map(q=>q.id);
  check(Object.keys(answers).every(id=>qids.includes(id)),"Неизвестный вопрос.",400);
  const inputs=Object.fromEntries(stage.questions.map(q=>[q.id,answerLines(Object.hasOwn(answers,q.id)?answers[q.id]:undefined,160*q.maxAnswers)]));
  if(!final)check(Object.values(inputs).some(lines=>lines.length),"Напишите хотя бы один ответ.",400);
  const scoreBefore=room.scores[team]||0;
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
  if(final) {
    const outcomes=Object.fromEntries(stage.questions.map(q=>[q.id,found[q.id].length>=q.required?"correct":inputs[q.id].length?"incorrect":"skipped"]));
    const count=status=>Object.values(outcomes).filter(value=>value===status).length;
    const summary={total:stage.questions.length,correct:count("correct"),incorrect:count("incorrect"),skipped:count("skipped"),
      notCorrect:count("incorrect")+count("skipped"),outcomes};
    complete(room,team,stage,run,now,!missing);
    summary.points=(room.scores[team]||0)-scoreBefore;
    (run.results ||= {})[stage.id]=summary;
    run.result="Ответы отправлены. Правильно: "+summary.correct+" из "+summary.total+". Не засчитано: "+summary.notCorrect+".";
    return;
  }
  run.result=missing?"Засчитано на этапе: "+total+". До завершения не хватает ответов: "+missing+".":"Нужные ответы засчитаны! Открыт ролик.";
  if(!missing)complete(room,team,stage,run,now);
}
function actFlow(room,role,action,data={},now=Date.now()) {
  check(role==="host"||ids(room).includes(role),"Команда не входит в комнату.",403);
  check(room.phase!=="closed","Комната закрыта.");
  if(action==="close") {check(role==="host","Только ведущий завершает комнату.",403);room.phase="closed";room.version++;return;}
  if(action==="finishGame") {
    check(role==="host","Только ведущий подводит итоги досрочно.",403);
    if(room.phase==="finished")return;
    check(room.phase==="playing","Сначала подключите команды и начните игру.");
    room.phase="finished";room.finishedAt=now;room.finishReason="host";
  } else if(action==="setTeamActive") {
    check(role==="host","Участниками управляет ведущий.",403);
    check(ids(room).includes(data.team)&&typeof data.active==="boolean","Проверьте команду и участие.",400);
    if((room.members[data.team].active!==false)===data.active)return;
    check(room.phase==="lobby"||room.phase==="playing","Игра уже закончилась.");
    check(data.active||activeIds(room).length>1,"Должна остаться хотя бы одна участвующая команда.");
    room.members[data.team].active=data.active;
    settleRoom(room,now);
  } else if(action==="setScoring") {
    check(role==="host","Очки настраивает ведущий.",403);check(room.phase!=="finished","Игра уже закончилась.");
    room.scoring=validateScoring(data.scoring,room.scoring);
  } else if(action==="start") {
    check(role==="host","Запускает игру ведущий.",403);
    // Older clients may still send start after the last team has already joined.
    if(room.phase==="playing")return;
    check(room.phase==="lobby","Игра уже началась.");
    check(activeIds(room).every(id=>room.members[id].joined),"Подключите все выбранные команды.");
    room.phase="playing";room.phaseStarted=now;
  } else {
    check(role!=="host","Это действие выполняет телефон команды.",403);
    check(room.phase==="playing","Дождитесь начала игры.");
    check(room.members[role].active!==false,"Ведущий отключил участие вашей команды.",403);
    const run=room.runs[role];
    check(!run.done,"Ваша команда уже завершила игру.");
    check(data.roundIndex===run.stageIndex,"Этап уже изменился. Обновите экран.");
    const stage=flowFor(room,role)[run.stageIndex];
    if(action==="thank") {
      check(ids(room).includes(data.helper)&&data.helper!==role,"Выберите другую команду.",400);
      check(room.members[data.helper].joined,"Эта команда ещё не подключилась.");
      check(room.members[data.helper].active!==false,"Эта команда не участвует в игре.");
      check(room.scoring.thanks>0,"Бонус за подсказку выключен ведущим.");
      if(run.thanks[stage.id]) {
        check(run.thanks[stage.id]===data.helper,"На этом этапе вы уже поблагодарили команду.");return;
      }
      const sender=teamsFor(room).find(t=>t.id===role);
      credit(room,data.helper,role+":"+stage.id+":thanks",room.scoring.thanks,"Подсказка команде «"+sender.name+"»",stage.id,now);
      run.thanks[stage.id]=data.helper;
    } else if(action==="continue") {
      check(run.cleared,"Сначала выполните задание.");
      if(run.stageIndex===flowFor(room,role).length-1)run.done=true;
      else {run.stageIndex++;run.cleared=false;run.result="";run.lastCodeAttempt=0;}
      settleRoom(room,now);
    } else if(action==="submitQuestions"||action==="finishQuestions") {
      check(stage.type==="questions","На этом этапе нужно ввести код.");
      if(run.cleared)return;
      submitQuestions(room,role,stage,run,data,now,action==="finishQuestions"||room.questionPolicy==="final-once-v1");
    } else if(action==="submitCode") {
      check(stage.type==="code","На этом этапе нужно ответить на вопросы.");
      if(run.cleared)return;
      check(typeof data.code==="string"&&data.code.trim().length>0&&data.code.length<=64,"Введите код.",400);
      check(!run.lastCodeAttempt||now-run.lastCodeAttempt>=1000,"Подождите секунду перед следующей попыткой.",429);
      run.lastCodeAttempt=now;run.codeAttempts++;
      if(normalizeCode(data.code)===normalizeCode(stage.code)) {
        credit(room,role,role+":"+stage.id+":code",room.scoring.code,"Верный код",stage.id,now);
        run.result="Код верный! Открыт новый ролик.";complete(room,role,stage,run,now);
      } else run.result="Код пока не подошёл. Уточните код у ведущего.";
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
function publicStage(stage,completed=false) {
  return {id:stage.id,title:stage.title,type:stage.type,prompt:stage.type==="code"?"Получите код у ведущего и введите его.":stage.prompt,
    ...(stage.story?{story:stage.story}:{}),
    ...(completed&&stage.epilogue?{epilogue:stage.epilogue}:{}),
    questions:stage.questions?.map(q=>({id:q.id,prompt:q.prompt,required:q.required,maxAnswers:q.maxAnswers,
      ...(q.videoId?{videoId:q.videoId}:{}),
      ...(completed&&q.explanation?{solution:{answer:q.answers.map(a=>a.variants[0]).join("; "),explanation:q.explanation}}:{})}))||[]};
}
function stats(room,id) {
  const run=room.runs[id];
  return {stageIndex:run.stageIndex,cleared:run.cleared,done:run.done,
    relevant:Object.values(run.found).reduce((sum,questions)=>sum+Object.values(questions).reduce((n,answers)=>n+answers.length,0),0),
    codes:flowFor(room,id).filter(s=>s.type==="code"&&run.history.includes(s.id)).length};
}
export function view(room,role) {
  if(room.engine!=="quest-flow-v2")return legacy.view(room,role);
  const own=room.runs[role],playing=room.phase!=="lobby";
  const ownFlow=flowFor(room,role);
  const stage=own?ownFlow[own.stageIndex]:null;
  const result={engine:room.engine,code:room.code,role,version:room.version,phase:room.phase,demo:room.demo,
    roundIndex:own?.stageIndex||0,total:ownFlow.length,teamCount:ids(room).length,expiresAt:room.expiresAt,
    scoring:copy(room.scoring),scoreEvents:copy(room.scoreEvents),
    teams:teamsFor(room).map(t=>({...t,score:room.scores[t.id]||0,joined:room.members[t.id].joined,active:room.members[t.id].active!==false,...stats(room,t.id)})),
    stages:ownFlow.map(s=>({id:s.id,title:s.title,type:s.type})),
    stage:own&&playing?publicStage(stage,own.cleared||own.done):null};
  if(room.phase==="finished") {
    const routes=ids(room).map(id=>flowFor(room,id));
    const sorted=[...result.teams].sort((a,b)=>Number(b.active)-Number(a.active)||b.score-a.score);let rank=0;
    result.finale={
      reason:room.finishReason||"completed",
      completed:result.teams.filter(t=>t.active&&t.done).length,
      activeTeams:activeIds(room).length,
      videoIds:[...new Set(routes.flatMap(route=>stageVideos(route.at(-1))))],
      allVideoIds:[...new Set(routes.flatMap(route=>route.flatMap(stageVideos)))],
      standings:sorted.map((team,index)=>{
        if(team.active&&(!index||team.score!==sorted[index-1].score))rank=index+1;
        return {id:team.id,name:team.name,icon:team.icon,artId:team.artId,accent:team.accent,score:team.score,rank:team.active?rank:null,active:team.active,done:team.done};
      })
    };
  }
  if(role==="host") {
    result.invites=Object.fromEntries(ids(room).map(id=>[id,room.members[id].invite]));
    result.runs=Object.fromEntries(ids(room).map(id=>[id,{...stats(room,id),submissions:copy(room.runs[id].submissions),results:copy(room.runs[id].results||{}),
      acceptedByStage:Object.fromEntries(Object.entries(room.runs[id].found).map(([stageId,questions])=>[stageId,Object.fromEntries(Object.entries(questions).map(([qid,answers])=>[qid,answers.length]))]))}]));
    result.guide=copy(room.flow);
    result.guides=Object.fromEntries(ids(room).map(id=>[id,copy(flowFor(room,id))]));
    if(room.taskCatalog)result.taskCatalog=copy(room.taskCatalog);
  } else if(own&&playing) {
    const stageVideoIds=stageVideos(stage),videos=visibleVideos(room,role);
    result.run={...stats(room,role),result:own.result,videos,stageVideos:videos.filter(id=>stageVideoIds.includes(id)),thanked:own.thanks[stage.id]||null,
      accepted:Object.fromEntries((stage.questions||[]).map(q=>[q.id,(own.found[stage.id]?.[q.id]||[]).length])),
      submission:copy(own.submissions[stage.id]?.answers||{}),summary:copy(own.results?.[stage.id]||null)};
  }
  return result;
}
export const authorize=legacy.authorize;
export function joinRoom(room,team,invite,now=Date.now()) {
  if(room.engine==="quest-flow-v2")check(room.members[team]?.active!==false,"Этот слот отключён ведущим.",403);
  const session=legacy.joinRoom(room,team,invite);
  if(room.engine==="quest-flow-v2")settleRoom(room,now);
  return session;
}
export const validateTeamCount=legacy.validateTeamCount;
