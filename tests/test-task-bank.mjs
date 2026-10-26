import test from "node:test";
import assert from "node:assert/strict";
import FLOW from "../server/quest-flow.json" with {type:"json"};
import BANK from "../server/task-bank.json" with {type:"json"};
import {createRoom,joinRoom,act,view} from "../server/game-engine.mjs";
import {validateTaskBank,normalizeAnswer} from "../server/quest-config.mjs";
import {dealQuest} from "../server/task-dealer.mjs";
const start=count=>{
  const r=createRoom("123456",Date.now(),undefined,count);
  delete r.codePolicy;delete r.codeTimers; // Exercise existing pre-timer rooms.
  for(const t of r.teams)joinRoom(r,t.id,r.members[t.id].invite);
  act(r,"host","start");return r;
};
test("every team receives 6 shared questions, 3 unique codes and 6 final questions",()=>{
  assert.deepEqual(validateTaskBank(FLOW,BANK,8),{questionsPerTeam:12,questionsAvailable:12});
  for(let count=1;count<=8;count++) {
    const r=start(count),host=view(r,"host"),questions=[],prompts=[],codes=[];
    for(const t of r.teams) {
      const route=host.guides[t.id];
      assert.equal(route[0].questions.length,6);
      assert.equal(view(r,t.id).stage.questions.length,6);
      assert.deepEqual(route[0].questions.map(q=>q.id),FLOW.stages[0].questionIds);
      assert.deepEqual(route.map(s=>s.type),["questions","code","code","code","questions"]);
      const ownQuestions=route.flatMap(s=>s.questions||[]);assert.equal(ownQuestions.length,12);
      assert.equal(route[4].questions.length,6);
      assert.equal(new Set(ownQuestions.map(q=>q.id)).size,12);
      assert.equal(new Set(ownQuestions.map(q=>normalizeAnswer(q.prompt))).size,12);
      assert.ok(ownQuestions.every(q=>q.required===1&&q.maxAnswers===1));
      questions.push(...ownQuestions.map(q=>q.id));prompts.push(...ownQuestions.map(q=>normalizeAnswer(q.prompt)));
      codes.push(...route.filter(s=>s.type==="code").map(s=>s.code));
      const own=view(r,t.id);
      for(const key of ["guides","guide","teamFlows","teamHints","taskCatalog"])assert.equal(key in own,false);
      assert.ok(own.stage.questions.every(q=>!("answers" in q)));
    }
    assert.equal(questions.length,count*12);assert.equal(prompts.length,count*12);
    if(count===8)assert.ok(new Set(questions).size<questions.length);
    assert.equal(new Set(codes).size,count*3);assert.ok(codes.every(code=>/^[А-ЯЁ]{2,24}$/u.test(code)&&FLOW.codeWords.includes(code)));
    assert.equal(host.taskCatalog.length,12);assert.ok(host.taskCatalog.every(q=>!("answers" in q)&&q.answer===BANK.questions.find(item=>item.id===q.id).answers[0].variants[0]));
  }
});
test("the question bank covers every video, including candle, guardian and bats",()=>{
  assert.deepEqual([...new Set(BANK.questions.map(q=>q.videoId))].sort((a,b)=>a-b),[1,2,3,4,5,6,7,8]);
  for(const id of [2,3,4])assert.ok(BANK.questions.some(q=>q.videoId===id));
  const flow=structuredClone(FLOW);
  assert.deepEqual(FLOW.stages[0].questionVideoIds,[1,1,2,3,4,4]);
  validateTaskBank(flow,BANK,8);
  const r=start(8),dealt=dealQuest(flow,BANK,r.teams,()=>0);
  for(const route of Object.values(dealt.teamFlows)) {
    assert.deepEqual(route[0].questions.map(q=>q.videoId),[1,1,2,3,4,4]);
    for(const q of route[0].questions)assert.ok(q.explanation&&q.answers[0].variants.length);
  }
});

test("six shared riddles retain the same order for every team, with answers hidden until submission",()=>{
  const r=start(8),answers=["Книга","Яма","Круг","Имя","Мэри","Сон"];
  const roles=r.teams.map(team=>team.id),first=view(r,roles[0]).stage.questions;
  assert.equal(first.length,6);
  for(const role of roles) {
    const state=view(r,role);
    assert.deepEqual(state.stage.questions,first);
    for(const q of state.stage.questions) {
      assert.equal("options" in q,false);
      assert.equal("answers" in q,false);assert.equal("solution" in q,false);
    }
    assert.deepEqual(r.teamFlows[role][0].questions.map(q=>q.answers[0].variants[0]),answers);
  }
  const q=r.teamFlows[roles[0]][0].questions;
  act(r,roles[0],"finishQuestions",{roundIndex:0,answers:{[q[0].id]:"Телевизор",[q[1].id]:"  яМа! "}});
  const own=view(r,roles[0]);
  assert.equal(own.run.summary.correct,1);assert.equal(own.run.summary.incorrect,1);assert.equal(own.run.summary.skipped,4);
  assert.equal(r.scores[roles[0]],100);assert.equal(r.scores[roles[1]],0);
  assert.equal(view(r,roles[1]).run.cleared,false);
});

test("Halloween word codes accept case, whitespace and е/ё, but reject wrong and partial words",()=>{
  const base=start(1),role=base.teams[0].id;
  act(base,role,"finishQuestions",{roundIndex:0,answers:{}});act(base,role,"continue",{roundIndex:0});
  base.teamFlows[role][1].code="КОТЁЛ";
  for(const code of ["КОТЁЛ","котёл","Котел"," \tкОтЕл\n"]) {
    const r=JSON.parse(JSON.stringify(base));
    act(r,role,"submitCode",{roundIndex:1,code},10000);
    assert.equal(r.runs[role].cleared,true);assert.equal(r.scores[role],500);
    act(r,role,"submitCode",{roundIndex:1,code},10001);assert.equal(r.scores[role],500);
    assert.equal("code" in view(r,role).stage,false);
    assert.equal("codeWords" in view(r,role),false);
  }
  for(const code of ["1234","кот","котелок","котёл!","совакотёл","не котёл"]) {
    const r=structuredClone(base);
    act(r,role,"submitCode",{roundIndex:1,code},10000);
    assert.equal(r.runs[role].cleared,false,code);assert.equal(r.scores[role],0,code);
    assert.throws(()=>act(r,role,"continue",{roundIndex:1}),e=>e.status===409);
  }
});

test("word-code configuration rejects duplicates, insufficient pools and non-word entries",()=>{
  for(const word of ["котел","1234","летучая мышь","BOO",""]) {
    const flow=structuredClone(FLOW);flow.codeWords.push(word);
    assert.throws(()=>validateTaskBank(flow,BANK,8));
  }
  const short=structuredClone(FLOW);short.codeWords=short.codeWords.slice(0,23);
  assert.throws(()=>validateTaskBank(short,BANK,8),/Не хватает уникальных кодовых слов/);
});

test("new rooms unlock videos after each completed stage and reject incorrect codes",()=>{
  const r=start(1),role=r.teams[0].id;
  const own=view(r,role);
  assert.equal("previewVideoIds" in own.stage,false);assert.deepEqual(own.run.stageVideos,[]);
  assert.ok(own.stage.questions.every(q=>!q.solution&&!q.answers));
  act(r,role,"finishQuestions",{roundIndex:0,answers:{}});act(r,role,"continue",{roundIndex:0});
  const stage=r.teamFlows[role][1],wrong=stage.code==="0000"?"0001":"0000";
  assert.equal("previewVideoIds" in view(r,role).stage,false);
  act(r,role,"submitCode",{roundIndex:1,code:wrong},10000);
  assert.deepEqual(view(r,role).run.stageVideos,[]);assert.equal(r.scores[role],0);
  assert.throws(()=>act(r,role,"continue",{roundIndex:1}),e=>e.status===409);
  assert.deepEqual(view(JSON.parse(JSON.stringify(r)),role).run.stageVideos,[]);
  act(r,role,"submitCode",{roundIndex:1,code:stage.code},11000);
  assert.deepEqual(view(r,role).run.stageVideos,[2]);
});

test("older catalogs recover short host-only answers without rewriting saved room state",()=>{
  const r=start(2);
  for(const task of r.taskCatalog)delete task.answer;
  const original=r.teamFlows[r.teams[0].id][0].questions[0];
  original.answers[0].variants[0]="saved-room-answer";
  const before=JSON.stringify(r),host=view(r,"host");
  assert.equal(host.taskCatalog.find(q=>q.id===original.id).answer,"saved-room-answer");
  assert.ok(host.taskCatalog.every(q=>q.answer&&q.answer!=="—"));
  assert.equal(JSON.stringify(r),before);
  for(const team of r.teams)assert.equal("taskCatalog" in view(r,team.id),false);
});

test("shuffling changes assignments and a deterministic RNG cannot hang code uniqueness",()=>{
  const r=start(8);
  const first=dealQuest(FLOW,BANK,r.teams,limit=>limit-1),second=dealQuest(FLOW,BANK,r.teams,()=>0);
  assert.notDeepEqual(first.teamFlows,second.teamFlows);
  const codes=Object.values(second.teamFlows).flatMap(route=>route.filter(s=>s.type==="code").map(s=>s.code));
  assert.equal(new Set(codes).size,24);
  const another=start(8);
  assert.notDeepEqual(r.teamFlows,another.teamFlows);
});
test("different team routes finish independently with equal earning opportunities and every reward video",()=>{
  for(const count of [1,2,8]) {
    const r=start(count),host=view(r,"host");
    for(const [teamIndex,t] of r.teams.entries()) {
      const route=host.guides[t.id];
      for(const [index,stage] of route.entries()) {
        const data=stage.type==="code"?{code:stage.code}:{answers:Object.fromEntries(stage.questions.map(q=>[q.id,"Ответ: "+q.answers[0].variants[0]+"!"]))};
        act(r,t.id,stage.type==="code"?"submitCode":"submitQuestions",{roundIndex:index,...data});
        assert.equal(r.runs[t.id].cleared,true);
        const score=r.scores[t.id];
        act(r,t.id,stage.type==="code"?"submitCode":"submitQuestions",{roundIndex:index,...data});assert.equal(r.scores[t.id],score);
        act(r,t.id,"continue",{roundIndex:index});
      }
      assert.equal(r.scores[t.id],3100);assert.equal(r.runs[t.id].done,true);
      assert.deepEqual(r.runs[t.id].videos,[1,2,3,4,5,6,7,8]);
      if(teamIndex<count-1)assert.equal(view(r,r.teams[teamIndex+1].id).roundIndex,0);
    }
    assert.equal(r.phase,"finished");
  }
});
test("client hints are absent even in old snapshots; answers and codes remain host-only",()=>{
  for(const count of [1,2,8]) {
    const r=start(count),marker="PRIVATE-HINT-SENTINEL";
    assert.equal(r.teamHints,undefined);
    for(const team of r.teams) {
      r.teamHints ||= {};r.teamHints[team.id]=[{text:marker}];
      r.teamFlows[team.id][0].hintParts=[marker];
      r.teamFlows[team.id][0].questions[0].hint=marker;
      const own=view(r,team.id);
      assert.equal("hints" in own,false);assert.equal("teamHints" in own,false);
      assert.equal(JSON.stringify(own).includes(marker),false);
      assert.equal(view(r,"host").guides[team.id][0].questions[0].hint,marker);
      assert.ok(view(r,"host").guides[team.id][1].code);
    }
  }
});
test("refresh and serialized persistence keep assignments and mutable host views cannot change them",()=>{
  const r=start(2),role=r.teams[0].id,assignment=structuredClone(r.teamFlows);
  const restored=JSON.parse(JSON.stringify(r));
  assert.deepEqual(restored.teamFlows,assignment);
  assert.deepEqual(view(restored,role).stage,view(r,role).stage);
  view(restored,"host").guides[role][0].questions[0].prompt="changed view";
  assert.deepEqual(restored.teamFlows,assignment);
});
test("adding a JSON bank record makes it eligible for dealing without code changes",()=>{
  const bank=structuredClone(BANK);
  bank.questions.push({id:"ghost-new",videoId:1,prompt:"Привидение передало знаки: ключ, луна, ключ. Какой знак находится между двумя ключами?",answers:[{id:"solution",variants:["луна"]}],hint:"В середине луна.",explanation:"Между первым и последним ключом стоит луна."});
  const flow=structuredClone(FLOW);delete flow.stages[0].questionIds;
  flow.stages[0].questionCount=5;flow.stages[0].questionVideoIds=[1,1,2,3,4];
  validateTaskBank(flow,bank,8);
  const r=start(1),dealt=dealQuest(flow,bank,r.teams,()=>0);
  assert.ok(dealt.teamFlows[r.teams[0].id][0].questions.some(q=>q.id==="ghost-new"));
});
test("invalid or undersized banks are rejected instead of repeating questions within a team",()=>{
  const small=structuredClone(BANK);small.questions=small.questions.slice(0,4);
  assert.throws(()=>validateTaskBank(FLOW,small,8),/не хватает/);
  const duplicate=structuredClone(BANK);duplicate.questions[1].prompt=duplicate.questions[0].prompt;
  assert.throws(()=>validateTaskBank(FLOW,duplicate,8),/повторяются/);
  const invalid=structuredClone(BANK);invalid.questions[0].hint="";
  assert.throws(()=>validateTaskBank(FLOW,invalid,8),/подсказка/);
  const missing=structuredClone(FLOW);missing.stages[0].questionCount=0;
  assert.throws(()=>validateTaskBank(missing,BANK,8));
});

test("every dealt question stays with its story video; per-video capacity cannot borrow unrelated riddles",()=>{
  const r=start(8);
  for(const route of Object.values(r.teamFlows)) {
    assert.deepEqual(route[0].questions.map(q=>q.videoId),[1,1,2,3,4,4]);
    assert.deepEqual(route[4].questions.map(q=>q.videoId),[5,5,6,6,7,8]);
    assert.ok(route.every(s=>s.story&&s.epilogue));
    for(const stage of route)for(const q of stage.questions||[])assert.ok(q.explanation.length>20);
  }
  const wrongPool=structuredClone(BANK);for(const q of wrongPool.questions.filter(q=>q.videoId===5))q.videoId=1;
  assert.throws(()=>validateTaskBank(FLOW,wrongPool,8),/ролика 5 не хватает/);
  const noSolution=structuredClone(BANK);delete noSolution.questions[0].explanation;
  assert.throws(()=>validateTaskBank(FLOW,noSolution,8),/разбор/);
});

test("solutions and epilogue are withheld until final submission, including wrong or blank results",()=>{
  const r=start(2),[first,second]=r.teams.map(t=>t.id);
  for(const [index,stage] of r.teamFlows[first].entries()) {
    const before=view(r,first);
    assert.equal(before.stage.story,stage.story);assert.equal("epilogue" in before.stage,false);
    assert.ok(before.stage.questions.every(q=>!("solution" in q)&&!("explanation" in q)&&!("hint" in q)&&!("answers" in q)));
    act(r,first,stage.type==="questions"?"finishQuestions":"submitCode",{roundIndex:index,...(stage.type==="questions"?{answers:{}}:{code:stage.code})});
    const after=view(r,first);
    assert.equal(after.stage.epilogue,stage.epilogue);
    assert.deepEqual(after.stage.questions.map(q=>q.solution), (stage.questions||[]).map(q=>({answer:q.answers[0].variants[0],explanation:q.explanation})));
    const untouched=view(r,second);
    assert.equal(untouched.run.cleared,false);
    assert.ok(untouched.stage.questions.every(q=>!("solution" in q)));
    act(r,first,"continue",{roundIndex:index});
  }
  assert.ok(view(r,first).stage.questions.every(q=>q.solution));
});

test("the shared finale opens only after every team finishes and exposes the same public ranking to all",()=>{
  const r=start(3),roles=r.teams.map(t=>t.id);
  const finish=role=>{
    for(const [index,stage] of r.teamFlows[role].entries()) {
      act(r,role,stage.type==="code"?"submitCode":"finishQuestions",{roundIndex:index,...(stage.type==="code"?{code:stage.code}:{answers:{}})});
      act(r,role,"continue",{roundIndex:index});
    }
  };
  assert.equal("finale" in view(r,"host"),false);
  finish(roles[0]);
  assert.equal(r.phase,"playing");assert.equal(view(r,roles[0]).run.done,true);
  for(const role of ["host",...roles])assert.equal("finale" in view(r,role),false);
  finish(roles[1]);finish(roles[2]);
  assert.equal(r.phase,"finished");
  const finale=view(r,"host").finale;
  assert.deepEqual(finale.videoIds,[5,6,7,8]);assert.deepEqual(finale.allVideoIds,[1,2,3,4,5,6,7,8]);
  assert.deepEqual(finale.standings.map(t=>[t.score,t.rank]),[[1500,1],[1500,1],[1500,1]]);
  for(const role of roles)assert.deepEqual(view(r,role).finale,finale);
  const saved=JSON.stringify(r);view(r,roles[0]).finale.standings[0].score=99999;
  assert.equal(JSON.stringify(r),saved);
  assert.deepEqual(view(JSON.parse(saved),roles[0]).finale,finale);
});

test("final ranking sorts points, shares tied places and works for a solo room",()=>{
  for(const count of [1,3]) {
    const r=start(count);
    for(const [index,t] of r.teams.entries()) {
      r.scores[t.id]=index===2?25:100;
      for(const [stageIndex,stage] of r.teamFlows[t.id].entries()) {
        act(r,t.id,stage.type==="code"?"submitCode":"finishQuestions",{roundIndex:stageIndex,...(stage.type==="code"?{code:stage.code}:{answers:{}})});
        act(r,t.id,"continue",{roundIndex:stageIndex});
      }
    }
    assert.deepEqual(view(r,"host").finale.standings.map(t=>t.rank),count===1?[1]:[1,1,3]);
  }
});

test("the spoken riddle bank stays short and asks one question without reading-dependent ciphers",()=>{
  assert.equal(BANK.version,11);
  for(const q of BANK.questions) {
    assert.ok(q.prompt.length<=130,q.id+": too long to read aloud once");
    assert.ok(q.prompt.trim().split(/\s+/u).length<=24,q.id+": too many words");
    assert.equal((q.prompt.match(/\?/g)||[]).length,1,q.id+": one question per riddle");
    assert.doesNotMatch(q.prompt,/первых букв|восьмым|после двух замен|среднего сообщения|половину|по три звезды/iu);
    if(!q.id.startsWith("shared-"))assert.ok(q.discussion&&q.discussion.length<=150,q.id+": a short spoken creative invitation");
  }
  for(const stage of FLOW.stages.filter(s=>s.type==="questions")) {
    assert.match(stage.prompt,/прочитай вопросы вслух/u);
    assert.match(stage.prompt,/Обсудите всей командой/u);
    assert.match(stage.prompt,/общий ответ/u);
  }
});

test("creative invitations are public but ungraded, and a valid shared answer still awards one answer",()=>{
  const r=start(1),role=r.teams[0].id,stage=r.teamFlows[role][4];r.runs[role].stageIndex=4;
  const own=view(r,role);
  for(const q of stage.questions)assert.equal(own.stage.questions.find(item=>item.id===q.id).discussion,q.discussion);
  assert.ok(own.stage.questions.every(q=>!q.solution&&!q.answers));
  const answers=Object.fromEntries(stage.questions.map(q=>[q.id,q.answers[0].variants[0]]));
  act(r,role,"finishQuestions",{roundIndex:4,answers});
  assert.equal(view(r,role).run.summary.correct,6);assert.equal(r.scores[role],800);
});

test("every spoken riddle accepts its colloquial answers and word forms as one shared answer",()=>{
  const base=start(1),role=base.teams[0].id;
  for(const q of BANK.questions)for(const alias of q.answers[0].variants) {
    const r=structuredClone(base),stage=r.teamFlows[role][0];
    stage.questions=[{...structuredClone(q),required:1,maxAnswers:1}];
    const answer="Мы решили: "+alias.toLocaleUpperCase("ru").replaceAll("Ё","Е")+"!";
    act(r,role,"finishQuestions",{roundIndex:0,answers:{[q.id]:answer}});
    assert.equal(view(r,role).run.summary.correct,1,q.id+": "+alias);
    assert.equal(r.scores[role],300,q.id+": only one answer and one stage bonus");
  }
});

test("simple riddles still reject wrong alternatives rather than awarding participation as correctness",()=>{
  const base=start(1),role=base.teams[0].id;
  const cases={"shared-01":"телевизор","shared-02":"гора","orb-01":"корабль","orb-02":"квадрат",
    "pumpkin-02":"на крышу","pumpkin-07":"фонарь","key-07":"две","potion-06":"зелёный"};
  for(const [id,answer] of Object.entries(cases)) {
    const r=structuredClone(base),q=BANK.questions.find(q=>q.id===id);
    assert.ok(q,id+": test references a retained riddle");
    r.teamFlows[role][0].questions=[{...structuredClone(q),required:1,maxAnswers:1}];
    act(r,role,"finishQuestions",{roundIndex:0,answers:{[id]:answer}});
    assert.equal(view(r,role).run.summary.incorrect,1,id);
    assert.equal(r.scores[role],0,id);
    assert.equal(r.runs[role].cleared,true,id+": submitting still ends the question stage");
  }
});
