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
  const team=await (await request(base,path+"/join",null,{team:role,invite:state.invites[role]})).json();
  await request(base,path+"/action",host,{action:"start"});
  const action=async answers=>(await request(base,path+"/action",team,{action:"submitQuestions",roundIndex:0,answers})).json();
  state=await action({night:["совы","летучая мышь"],light:["фонарь"]});
  assert.equal(state.run.cleared,false);assert.equal(state.teams[0].score,300);
  assert.match(state.run.result,/не хватает ответов: 1/);
  state=await action({night:["совы летучая мышь"],light:["фонарик, свеча, фонари"]});
  assert.deepEqual(state.run.accepted,{night:2,light:2});assert.equal(state.run.cleared,true);
  assert.equal(state.teams[0].score,600);assert.deepEqual(state.run.videos,[1]);
  assert.equal("guide" in state,false);
  await action({night:"СОВЫ и летучая мышь",light:"фонарик; свеча; фонари"});
  state=await (await request(base,path+"/action",team,{action:"continue",roundIndex:0})).json();
  assert.equal(state.stage.type,"code");assert.equal(state.roundIndex,1);assert.equal(state.teams[0].score,600);
  console.log("PASS: screenshot inputs unlock video and next stage; existing progress and unique points are preserved.");
} finally {
  if(host)await request(base,"/api/rooms/"+host.code+"/action",host,{action:"close"});
}
