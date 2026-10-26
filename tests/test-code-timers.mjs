import test from "node:test";
import assert from "node:assert/strict";
import {createRoom,joinRoom,act,view} from "../server/game-engine.mjs";

test("three timed rounds wait for everyone and allow one wrong, blank or correct answer",()=>{
  let now=1_000_000;
  const r=createRoom("123456",now,undefined,3),[a,b,c]=r.teams.map(t=>t.id);
  for(const id of [a,b,c])joinRoom(r,id,r.members[id].invite,now);
  const send=(id,action,data={})=>act(r,id,action,{roundIndex:r.runs[id].stageIndex,...data},now);
  const next=id=>send(id,"continue");
  for(const id of [a,b,c]){send(id,"finishQuestions",{answers:{}});next(id);}
  for(let index=1;index<=3;index++) {
    assert.throws(()=>act(r,a,"startCodeTimer",{stageIndex:index,minutes:1},now),e=>e.status===403);
    assert.throws(()=>act(r,"host","startCodeTimer",{stageIndex:index,minutes:0},now),e=>e.status===400);
    act(r,"host","startCodeTimer",{stageIndex:index,minutes:1},now);
    assert.throws(()=>act(r,"host","startCodeTimer",{stageIndex:index,minutes:1},now));
    assert.throws(()=>send(a,"submitCode",{code:r.teamFlows[a][index].code}),/таймера/);
    now+=60_000;
    const oldScore=r.scores[a];
    send(a,"submitCode",{code:r.teamFlows[a][index].code.toLowerCase()});
    send(b,"submitCode",{code:"неверно"});send(c,"submitCode",{code:""});
    assert.equal(r.scores[a],oldScore+500);
    assert.equal(view(r,b).run.codeOutcome,"incorrect");assert.deepEqual(view(r,b).run.stageVideos,[]);
    assert.equal(view(r,c).run.codeOutcome,"incorrect");assert.equal(view(r,b).run.codes,0);
    const score=r.scores[b];send(b,"submitCode",{code:r.teamFlows[b][index].code});assert.equal(r.scores[b],score);
    next(a);next(b);
    if(index<3)assert.throws(()=>act(r,"host","startCodeTimer",{stageIndex:index+1,minutes:1},now),/все команды/);
    next(c);
    const saved=JSON.parse(JSON.stringify(r));assert.deepEqual(saved.codeTimers,r.codeTimers);
  }
  assert.equal(r.runs[a].stageIndex,4);assert.equal(r.runs[b].stageIndex,4);assert.equal(r.runs[c].stageIndex,4);
  assert.equal(view(r,a).run.codes,3);assert.equal(view(r,b).run.codes,0);
});

test("timer starts only when every active team reaches the same code stage",()=>{
  const now=1_000_000,r=createRoom("123456",now,undefined,2),[a,b]=r.teams.map(t=>t.id);
  for(const id of [a,b])joinRoom(r,id,r.members[id].invite,now);
  act(r,a,"finishQuestions",{roundIndex:0,answers:{}},now);act(r,a,"continue",{roundIndex:0},now);
  assert.throws(()=>act(r,"host","startCodeTimer",{stageIndex:1,minutes:1},now),/все команды/);
  act(r,"host","setTeamActive",{team:b,active:false},now);
  act(r,"host","startCodeTimer",{stageIndex:1,minutes:1},now);
  assert.equal(view(r,a).codeTimers[1].endsAt,now+60000);
});
