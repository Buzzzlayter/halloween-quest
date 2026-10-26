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
  const questions=state.guides[role][0].questions,[first,second]=questions;
  const a=first.answers[0].variants[0],b=second.answers[0].variants[0];
  const team=await (await request(base,path+"/join",null,{team:role,invite:state.invites[role]})).json();
  await request(base,path+"/action",host,{action:"start"});
  const action=async answers=>(await request(base,path+"/action",team,{action:"submitQuestions",roundIndex:0,answers})).json();
  const answers=Object.fromEntries(questions.map(q=>[q.id,q.answers[0].variants[0]]));
  state=await action({...answers,[first.id]:a+", "+a,[second.id]:"Ответ: "+b+"; "+b+"!"});
  assert.deepEqual(state.run.accepted,Object.fromEntries(questions.map(q=>[q.id,1])));assert.equal(state.run.cleared,true);
  assert.equal(state.run.summary.correct,6);assert.equal(state.run.summary.notCorrect,0);
  assert.equal(state.teams[0].score,800);assert.deepEqual(state.run.videos,[1]);
  assert.equal("guide" in state,false);
  await action({[first.id]:"\n"+a.toUpperCase()+"\n",[second.id]:b});
  state=await (await request(base,path+"/action",team,{action:"continue",roundIndex:0})).json();
  assert.equal(state.stage.type,"code");assert.equal(state.roundIndex,1);assert.equal(state.teams[0].score,800);
  console.log("PASS: typed answers accept formatting; retry does not award twice.");
} finally {
  if(host)await request(base,"/api/rooms/"+host.code+"/action",host,{action:"close"});
}
