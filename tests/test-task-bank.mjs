import test from "node:test";
import assert from "node:assert/strict";
import FLOW from "../server/quest-flow.json" with {type:"json"};
import BANK from "../server/task-bank.json" with {type:"json"};
import {createRoom,joinRoom,act,view} from "../server/game-engine.mjs";
import {validateTaskBank,normalizeAnswer} from "../server/quest-config.mjs";
import {dealQuest} from "../server/task-dealer.mjs";
const start=count=>{
  const r=createRoom("123456",Date.now(),undefined,count);
  for(const t of r.teams)joinRoom(r,t.id,r.members[t.id].invite);
  act(r,"host","start");return r;
};
test("every new room deals distinct bank questions and globally unique codes to 1..8 teams",()=>{
  assert.deepEqual(validateTaskBank(FLOW,BANK,8),{questionsPerTeam:6,questionsAvailable:48});
  for(let count=1;count<=8;count++) {
    const r=start(count),host=view(r,"host"),questions=[],prompts=[],codes=[];
    for(const t of r.teams) {
      const route=host.guides[t.id];
      assert.deepEqual(route.map(s=>s.type),["questions","code","code","code","questions"]);
      const ownQuestions=route.flatMap(s=>s.questions||[]);assert.equal(ownQuestions.length,6);
      assert.ok(ownQuestions.every(q=>q.required===1&&q.maxAnswers===1));
      questions.push(...ownQuestions.map(q=>q.id));prompts.push(...ownQuestions.map(q=>normalizeAnswer(q.prompt)));
      codes.push(...route.filter(s=>s.type==="code").map(s=>s.code));
      const own=view(r,t.id);
      for(const key of ["guides","guide","teamFlows","teamHints","taskCatalog"])assert.equal(key in own,false);
      assert.ok(own.stage.questions.every(q=>!("answers" in q)));
    }
    assert.equal(new Set(questions).size,count*6);assert.equal(new Set(prompts).size,count*6);
    assert.equal(new Set(codes).size,count*3);assert.ok(codes.every(code=>/^\d{4}$/.test(code)));
    assert.equal(host.taskCatalog.length,48);assert.ok(host.taskCatalog.every(q=>!("answers" in q)));
  }
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
      assert.equal(r.scores[t.id],2500);assert.equal(r.runs[t.id].done,true);
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
  validateTaskBank(FLOW,bank,8);
  const r=start(1),dealt=dealQuest(FLOW,bank,r.teams,limit=>limit===17?0:limit-1);
  assert.equal(dealt.teamFlows[r.teams[0].id][0].questions[0].id,"ghost-new");
});
test("invalid or undersized banks are rejected instead of reusing questions",()=>{
  const small=structuredClone(BANK);small.questions=small.questions.slice(0,47);
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
    assert.deepEqual(route[0].questions.map(q=>q.videoId),[1,1]);
    assert.deepEqual(route[4].questions.map(q=>q.videoId),[5,6,7,8]);
    assert.ok(route.every(s=>s.story&&s.epilogue));
    for(const stage of route)for(const q of stage.questions||[])assert.ok(q.explanation.length>20);
  }
  const wrongPool=structuredClone(BANK);wrongPool.questions.find(q=>q.videoId===5).videoId=1;
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
