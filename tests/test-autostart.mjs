import test from "node:test";
import assert from "node:assert/strict";
import {createRoom,joinRoom,act,view,authorize} from "../server/game-engine.mjs";
import * as legacy from "../server/legacy-engine.mjs";

test("every supported room size starts on its last distinct valid join, without a host action",()=>{
  for(let count=1;count<=8;count++) {
    const room=createRoom("123456",1000,undefined,count);
    assert.equal(room.phase,"lobby");
    for(const [index,team] of [...room.teams].reverse().entries()) {
      const session=joinRoom(room,team.id,room.members[team.id].invite,2000+index);
      assert.equal(authorize(room,session.token),team.id);
      assert.equal(room.phase,index===count-1?"playing":"lobby");
      if(index<count-1)assert.equal(view(room,team.id).stage,null);
    }
    assert.equal(room.phaseStarted,2000+count-1);
    assert.ok(room.teams.every(t=>view(room,t.id).stage.type==="questions"));
    assert.ok(room.teams.every(t=>room.scores[t.id]===0&&room.runs[t.id].stageIndex===0));
    assert.deepEqual(room.scoreEvents,[]);
  }
});

test("invalid invitations and repeated joins cannot fill other slots or start early",()=>{
  const room=createRoom("123456",1000,undefined,3),[a,b,c]=room.teams;
  joinRoom(room,a.id,room.members[a.id].invite);
  for(let i=0;i<4;i++)joinRoom(room,a.id,room.members[a.id].invite);
  assert.equal(room.phase,"lobby");
  const saved=structuredClone(room);
  for(const [team,invite] of [[b.id,room.members[a.id].invite],["foreign","wrong"]]) {
    assert.throws(()=>joinRoom(room,team,invite),e=>e.status===403);
    assert.deepEqual(room,saved);
  }
  joinRoom(room,c.id,room.members[c.id].invite);assert.equal(room.phase,"lobby");
  joinRoom(room,b.id,room.members[b.id].invite);assert.equal(room.phase,"playing");
});

test("serialized lobby resumes and automatically starts when its remaining slot joins",()=>{
  const room=createRoom("123456",1000,undefined,2),[a,b]=room.teams;
  joinRoom(room,a.id,room.members[a.id].invite);
  const restored=JSON.parse(JSON.stringify(room)),assigned=structuredClone(restored.teamFlows);
  joinRoom(restored,b.id,restored.members[b.id].invite,3000);
  assert.equal(restored.phase,"playing");assert.equal(restored.phaseStarted,3000);
  assert.deepEqual(restored.teamFlows,assigned);
});

test("reconnecting and a stale host start never reset progression, scores or start time",()=>{
  const room=createRoom("123456",1000,undefined,1),team=room.teams[0].id;
  joinRoom(room,team,room.members[team].invite,2000);
  const stage=room.teamFlows[team][0];
  act(room,team,"finishQuestions",{roundIndex:0,answers:Object.fromEntries(stage.questions.map(q=>[q.id,q.answers[0].variants[0]]))});
  act(room,team,"continue",{roundIndex:0});
  const run=structuredClone(room.runs[team]),score=room.scores[team],awards=structuredClone(room.scoreAwards);
  joinRoom(room,team,room.members[team].invite,3000);
  const saved=structuredClone(room);
  act(room,"host","start",{},4000);assert.deepEqual(room,saved);
  assert.deepEqual(room.runs[team],run);assert.equal(room.scores[team],score);
  assert.deepEqual(room.scoreAwards,awards);assert.equal(room.phaseStarted,2000);
});

test("closed and finished rooms cannot restart on a join; legacy games retain their original lifecycle",()=>{
  for(const phase of ["closed","finished"]) {
    const room=createRoom("123456",1000,undefined,1),team=room.teams[0].id;
    room.phase=phase;const saved=structuredClone(room);
    assert.throws(()=>joinRoom(room,team,room.members[team].invite),e=>e.status===409);
    assert.deepEqual(room,saved);
  }
  const old=legacy.createRoom("123456",1000,undefined,1),team=old.teams[0].id;
  joinRoom(old,team,old.members[team].invite);
  assert.equal(old.phase,"lobby");
});
