import test from "node:test";
import assert from "node:assert/strict";
import {createRoom,joinRoom,dispatch,view,authorize} from "../server/game-engine.mjs";

const room=(count=3)=>createRoom("123456",Date.now(),undefined,count);
const join=(r,id)=>joinRoom(r,id,r.members[id].invite);
const host=(r,action,data={})=>dispatch(r,"host",action,data);
const toggle=(r,id,active)=>host(r,"setTeamActive",{team:id,active});
const submit=(r,id)=>dispatch(r,id,"finishQuestions",{roundIndex:0,answers:Object.fromEntries(r.teamFlows[id][0].questions.map(q=>[q.id,q.answers[0].variants[0]]))});
const finish=(r,id)=>{
  for(const [roundIndex,s] of r.teamFlows[id].entries()) {
    dispatch(r,id,s.type==="code"?"submitCode":"finishQuestions",{roundIndex,...(s.type==="code"?{code:s.code}:{answers:{}})});
    dispatch(r,id,"continue",{roundIndex});
  }
};

test("host can exclude absent slots to start automatically without fake joins or scores",()=>{
  const r=room(),[a,b,c]=r.teams.map(t=>t.id);join(r,a);
  toggle(r,b,false);assert.equal(r.phase,"lobby");toggle(r,c,false);
  assert.equal(r.phase,"playing");assert.equal(r.members[b].joined,false);
  assert.equal(r.members[c].joined,false);assert.equal(r.scores[a],0);
  assert.equal(view(r,"host").teams.filter(t=>t.active).length,1);
  const before=structuredClone(r);toggle(r,b,false);assert.deepEqual(r,before);
  assert.throws(()=>toggle(r,a,false),/хотя бы одна/);assert.deepEqual(r,before);
});

test("participation changes require the host, a real team and a boolean",()=>{
  const r=room(),id=r.teams[0].id,before=structuredClone(r);
  for(const [role,data] of [[id,{team:id,active:false}],["host",{team:"foreign",active:false}],["host",{team:id,active:0}]])
    assert.throws(()=>dispatch(r,role,"setTeamActive",data));
  assert.deepEqual(r,before);
  assert.throws(()=>host(r,"finishGame"),/Сначала подключите/);
});

test("withdrawn phones cannot act, rejoin or receive thanks; restoring preserves their saved game",()=>{
  const r=room(),[a,b,c]=r.teams.map(t=>t.id),sessions=r.teams.map(t=>join(r,t.id));
  submit(r,b);const saved=structuredClone(r.runs[b]),points=r.scores[b];
  toggle(r,b,false);
  assert.equal(authorize(r,sessions[1].token),b);
  assert.equal(view(r,b).teams.find(t=>t.id===b).active,false);
  assert.throws(()=>join(r,b),/отключён/);
  assert.throws(()=>dispatch(r,b,"continue",{roundIndex:0}),/отключил/);
  assert.throws(()=>dispatch(r,a,"thank",{roundIndex:0,helper:b}),/не участвует/);
  assert.deepEqual(r.runs[b],saved);assert.equal(r.scores[b],points);
  toggle(r,b,true);dispatch(r,b,"continue",{roundIndex:0});
  assert.equal(r.runs[b].stageIndex,1);assert.equal(r.scores[b],points);
  assert.equal(r.runs[c].stageIndex,0);
});

test("a dropped final team cannot hold the shared finale hostage and is not ranked",()=>{
  const r=room(2),[a,b]=r.teams.map(t=>t.id);join(r,a);join(r,b);
  submit(r,b);const saved=structuredClone(r.runs[b]),score=r.scores[b];
  finish(r,a);assert.equal(r.phase,"playing");toggle(r,b,false);
  assert.equal(r.phase,"finished");assert.deepEqual(r.runs[b],saved);assert.equal(r.scores[b],score);
  const finale=view(r,"host").finale;
  assert.equal(finale.completed,1);assert.equal(finale.activeTeams,1);
  assert.equal(finale.standings.find(t=>t.id===a).rank,1);
  assert.equal(finale.standings.find(t=>t.id===b).rank,null);
  assert.deepEqual(view(r,a).finale,view(r,b).finale);
  assert.throws(()=>toggle(r,b,true),/закончилась/);
});

test("host finish preserves real scores and results, shows a shared finale and cannot restart",()=>{
  const r=room(2),[a,b]=r.teams.map(t=>t.id);join(r,a);join(r,b);submit(r,a);
  const scores=structuredClone(r.scores),runs=structuredClone(r.runs),events=structuredClone(r.scoreEvents);
  assert.throws(()=>dispatch(r,a,"finishGame"),/Только ведущий/);
  host(r,"finishGame");assert.equal(r.phase,"finished");
  assert.deepEqual(r.scores,scores);assert.deepEqual(r.runs,runs);assert.deepEqual(r.scoreEvents,events);
  const finale=view(r,a).finale;assert.equal(finale.reason,"host");assert.equal(finale.completed,0);
  assert.deepEqual(finale.allVideoIds,[1,2,3,4,5,6,7,8]);assert.deepEqual(finale,view(r,b).finale);
  const ended=structuredClone(r);host(r,"finishGame");assert.deepEqual(r,ended);
  assert.throws(()=>dispatch(r,a,"continue",{roundIndex:0}));assert.throws(()=>join(r,b));
  assert.throws(()=>host(r,"start"));assert.deepEqual(r,ended);
});
