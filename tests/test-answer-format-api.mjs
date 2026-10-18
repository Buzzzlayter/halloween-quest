import assert from "node:assert/strict";
import {request} from "./flow-api-helpers.mjs";
const base=process.argv[2];
if(!base||!/^https?:\/\//.test(base))throw new Error("Pass an explicit local or production URL");
let host;
try {
  host=await (await request(base,"/api/rooms",null,{teamCount:1})).json();
  const path="/api/rooms/"+host.code;
  let state=await (await request(base,path+"/state",host)).json();
  const role=state.teams[0].id;
  const [first,second]=state.guides[role][0].questions;
  const a=first.answers[0].variants[0],b=second.answers[0].variants[0];
  const team=await (await request(base,path+"/join",null,{team:role,invite:state.invites[role]})).json();
  await request(base,path+"/action",host,{action:"start"});
  const action=async answers=>(await request(base,path+"/action",team,{action:"submitQuestions",roundIndex:0,answers})).json();
  state=await action({[first.id]:a+", "+a,[second.id]:"Ответ: "+b+"; "+b+"!"});
  assert.deepEqual(state.run.accepted,{[first.id]:1,[second.id]:1});assert.equal(state.run.cleared,true);
  assert.equal(state.run.summary.correct,2);assert.equal(state.run.summary.notCorrect,0);
  assert.equal(state.teams[0].score,400);assert.deepEqual(state.run.videos,[1]);
  assert.equal("guide" in state,false);
  await action({[first.id]:"\n"+a.toUpperCase()+"\n",[second.id]:b});
  state=await (await request(base,path+"/action",team,{action:"continue",roundIndex:0})).json();
  assert.equal(state.stage.type,"code");assert.equal(state.roundIndex,1);assert.equal(state.teams[0].score,400);
  console.log("PASS: free-format bank answers unlock video and next stage without duplicate points.");
} finally {
  if(host)await request(base,"/api/rooms/"+host.code+"/action",host,{action:"close"});
}
