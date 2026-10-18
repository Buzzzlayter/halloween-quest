import assert from "node:assert/strict";
import {setTimeout as delay} from "node:timers/promises";
import {request} from "./flow-api-helpers.mjs";
const base=process.argv[2];
if(!base||!/^https?:\/\//.test(base))throw new Error("Pass an explicit local or production URL");
let host;
try {
  host=await (await request(base,"/api/rooms",null,{teamCount:3})).json();
  const path="/api/rooms/"+host.code;
  const hostState=await (await request(base,path+"/state",host)).json();
  const sessions={};
  for(const team of hostState.teams)sessions[team.id]=await (await request(base,path+"/join",null,{team:team.id,invite:hostState.invites[team.id]})).json();
  await request(base,path+"/action",host,{action:"start"});
  for(const [index,team] of hostState.teams.entries()) {
    const [a,b]=hostState.guides[team.id][0].questions;
    const rightA=a.answers[0].variants[0],rightB=b.answers[0].variants[0];
    const answers=index===0?{[a.id]:rightA,[b.id]:"не знаем"}:index===1?{}:{[a.id]:rightA,[b.id]:rightB};
    const body={action:"finishQuestions",roundIndex:0,answers};
    const state=await (await request(base,path+"/action",sessions[team.id],body)).json();
    const summary=state.run.summary;
    assert.equal(state.run.cleared,true);
    assert.equal(summary.correct,[1,0,2][index]);assert.equal(summary.incorrect,[1,0,0][index]);
    assert.equal(summary.skipped,[0,2,0][index]);assert.equal(summary.points,[100,0,400][index]);
    assert.equal(state.teams.find(t=>t.id===team.id).score,[100,0,400][index]);
    assert.deepEqual(state.run.videos,[1]);
    const retry=await (await request(base,path+"/action",sessions[team.id],{...body,answers:{[a.id]:rightA,[b.id]:rightB}})).json();
    assert.deepEqual(retry.run.summary,summary);
    const next=await (await request(base,path+"/action",sessions[team.id],{action:"continue",roundIndex:0})).json();
    assert.equal(next.roundIndex,1);assert.equal(next.stage.type,"code");
    const code=hostState.guides[team.id][1].code;
    const wrong=await (await request(base,path+"/action",sessions[team.id],{action:"submitCode",roundIndex:1,code:code==="0000"?"0001":"0000"})).json();
    assert.equal(wrong.run.cleared,false);assert.deepEqual(wrong.run.stageVideos,[]);
    assert.equal(wrong.run.videos.includes(2),false);
    assert.equal(wrong.teams.find(t=>t.id===team.id).score,[100,0,400][index]);
    await request(base,path+"/action",sessions[team.id],body,409);
    const refreshed=await (await request(base,path+"/state",sessions[team.id])).json();
    assert.deepEqual(refreshed.run.stageVideos,[]);
    await delay(1100); // Respect the server's one-second retry cooldown.
    const correct=await (await request(base,path+"/action",sessions[team.id],{action:"submitCode",roundIndex:1,code})).json();
    assert.equal(correct.run.cleared,true);assert.deepEqual(correct.run.stageVideos,[2]);
    assert.equal(correct.teams.find(t=>t.id===team.id).score,[100,0,400][index]+500);
  }
  console.log("PASS: question submissions always show videos; wrong codes reveal no video and cannot advance or award points.");
} finally {
  if(host)await request(base,"/api/rooms/"+host.code+"/action",host,{action:"close"});
}
