import test from "node:test";
import assert from "node:assert/strict";
import FLOW from "./fixtures/legacy-flow.json" with { type:"json" };
import {createRoom} from "./fixtures/fixed-room.mjs";
import {joinRoom,authorize,act,dispatch,view,validateScoring,validateFlow,normalizeAnswer,GameError} from "../server/game-engine.mjs";
import * as legacy from "../server/legacy-engine.mjs";
const make=(count=2,scoring)=>{
  const r=createRoom("123456",Date.now(),undefined,count,{scoring});
  for(const role of r.teams.map(t=>t.id))joinRoom(r,role,r.members[role].invite);
  act(r,"host","start");return r;
};
const send=(r,role,name,data={},now)=>act(r,role,name,{roundIndex:r.runs[role]?.stageIndex||0,...data},now);
const right=stage=>Object.fromEntries(stage.questions.map(q=>[q.id,q.answers.slice(0,q.required).map(a=>a.variants[0])]));
const submitRight=(r,role)=>{
  const stage=r.flow[r.runs[role].stageIndex];
  send(r,role,stage.type==="code"?"submitCode":"submitQuestions",stage.type==="code"?{code:stage.code}:{answers:right(stage)});
};
test("editable flow configuration rejects duplicate IDs, impossible questions and ambiguous synonyms",()=>{
  assert.doesNotThrow(()=>validateFlow(FLOW.stages));
  const duplicate=structuredClone(FLOW.stages);duplicate[1].id=duplicate[0].id;assert.throws(()=>validateFlow(duplicate));
  const impossible=structuredClone(FLOW.stages);impossible[0].questions[0].required=5;assert.throws(()=>validateFlow(impossible));
  const ambiguous=structuredClone(FLOW.stages);ambiguous[0].questions[0].answers[1].variants.push("летучая мышь");assert.throws(()=>validateFlow(ambiguous));
});
test("default flow is questions / code / code / code / questions; slot limits are preserved",()=>{
  assert.deepEqual(FLOW.stages.map(s=>s.type),["questions","code","code","code","questions"]);
  for(let n=1;n<=8;n++)assert.equal(createRoom("123456",Date.now(),undefined,n).teams.length,n);
  assert.throws(()=>createRoom("123456",Date.now(),undefined,0),GameError);
});
test("each team progresses independently; media unlock only on accepted answers or correct codes",()=>{
  const r=make(),[a,b]=r.teams.map(t=>t.id);
  assert.deepEqual(view(r,a).run.videos,[]);
  send(r,a,"submitQuestions",{answers:{night:["слон"],light:["камень"]}});
  assert.equal(r.scores[a],0);assert.deepEqual(view(r,a).run.videos,[]);
  submitRight(r,a);assert.equal(r.runs[a].cleared,true);assert.deepEqual(view(r,a).run.stageVideos,[1]);
  send(r,a,"continue");
  assert.equal(view(r,a).roundIndex,1);assert.equal(view(r,b).roundIndex,0);
  assert.equal(view(r,b).run.cleared,false);
  const state=view(r,b);assert.equal("guide" in state,false);assert.equal("runs" in state,false);
  assert.equal("code" in state.stage,false);
  assert.equal(JSON.stringify(state).includes("1310"),false);
  assert.equal("answers" in state.stage.questions[0],false);
});
test("aliases/case/punctuation are normalized, unique relevant answers accumulate without reward farming",()=>{
  const r=make(),a=r.teams[0].id;
  assert.equal(normalizeAnswer("  Ёлка!!! "),"елка");
  send(r,a,"submitQuestions",{answers:{night:["СОВА!"],light:["Свеча","свечка"]}});
  assert.equal(view(r,a).run.accepted.night,1);assert.equal(view(r,a).run.accepted.light,1);
  assert.equal(r.scores[a],200);assert.equal(r.runs[a].cleared,false);
  send(r,a,"submitQuestions",{answers:{night:["сова"],light:["фонарик"]}});
  assert.equal(r.runs[a].cleared,true);assert.equal(r.scores[a],500);
  send(r,a,"submitQuestions",{answers:{night:["сова"],light:["фонарь"]}});
  assert.equal(r.scores[a],500);
  assert.throws(()=>send(r,a,"submitQuestions",{roundIndex:3,answers:{}}),GameError);
});
test("three consecutive codes validate server-side, have a retry cooldown and cannot be skipped",()=>{
  const r=make(),a=r.teams[0].id;
  assert.throws(()=>send(r,a,"continue"),GameError);
  submitRight(r,a);send(r,a,"continue");
  send(r,a,"submitCode",{code:"0000"},10000);
  assert.equal(r.runs[a].cleared,false);assert.equal(r.scores[a],500);
  assert.throws(()=>send(r,a,"submitCode",{code:"1310"},10500),e=>e.status===429);
  send(r,a,"submitCode",{code:"13 10"},11000);assert.equal(r.scores[a],1000);
  send(r,a,"submitCode",{code:"1310"},11001);assert.equal(r.scores[a],1000);
  send(r,a,"continue");submitRight(r,a);send(r,a,"continue");submitRight(r,a);send(r,a,"continue");
  assert.equal(r.runs[a].stageIndex,4);assert.deepEqual(r.runs[a].videos,[1,2,3,4]);
});

test("answers match independently of separators, spaces, case, bullets or surrounding words",()=>{
  const formats=[
    {night:["совы летучая мышь"],light:["фонарик, свеча, фонари"]},
    ...[",",";","\n","\r\n","\t"," и "," • ","/"," ","!!! "].map(separator=>({night:"СОВЫ"+separator+"летучая мышь",light:"фонарик"+separator+"свеча"+separator+"фонари"})),
    {night:"1. Совы\n\n2) Летучая мышь!",light:"• фонарик\n\n• свеча\n\n• фонари"},
    {night:"Я думаю, ночью летают совы и летучие мыши.",light:"Наш ответ: ФОНАРИК и свечка."},
    {night:["сова","сова","совы","летучая мышь"],light:["фонарь","фонарик","фонари","свечка","свеча"]},
    {night:"  СОВЫ\u00a0летучая\tмышь  ",light:"СвЕчА — ФОНАРИК"}
  ];
  for(const answers of formats) {
    const r=make(1),role=r.teams[0].id;
    send(r,role,"submitQuestions",{answers});
    assert.deepEqual(view(r,role).run.accepted,{night:2,light:2},JSON.stringify(answers));
    assert.equal(r.runs[role].cleared,true);assert.equal(r.scores[role],600);
    assert.deepEqual(r.runs[role].videos,[1]);
    send(r,role,"submitQuestions",{answers});assert.equal(r.scores[role],600);
    send(r,role,"continue");assert.equal(r.runs[role].stageIndex,1);
  }
});

test("synonyms remain one answer across retries and words inside unrelated words never match",()=>{
  const r=make(1),role=r.teams[0].id;
  send(r,role,"submitQuestions",{answers:{night:"соварь мышеловка",light:"подсвечник фонариковый"}});
  assert.deepEqual(view(r,role).run.accepted,{night:0,light:0});assert.equal(r.scores[role],0);
  send(r,role,"submitQuestions",{answers:{night:"сова",light:"фонарь фонарик фонари"}});
  assert.deepEqual(view(r,role).run.accepted,{night:1,light:1});assert.equal(r.scores[role],200);
  assert.equal(r.runs[role].cleared,false);
  assert.match(view(r,role).run.result,/не хватает ответов: 1/);
  send(r,role,"submitQuestions",{answers:{light:"фонарик, свеча, фонари"}});
  assert.equal(r.scores[role],500);assert.equal(r.runs[role].cleared,true);
});

test("the longest matching phrase takes priority and canonical answer caps still limit points",()=>{
  const r=make(1),role=r.teams[0].id,q=r.flow[0].questions[0];
  q.answers=[{id:"bat",variants:["летучая мышь"]},{id:"mouse",variants:["мышь"]}];
  send(r,role,"submitQuestions",{answers:{night:"летучая мышь"}});
  assert.deepEqual(r.runs[role].found.welcome.night,["bat"]);
  const light=r.flow[0].questions[1];light.maxAnswers=2;
  send(r,role,"submitQuestions",{answers:{light:"свеча фонарь факел"}});
  assert.equal(view(r,role).run.accepted.light,2);assert.equal(r.scores[role],500);
});

test("the screenshot's already-running room recovers without losing progress or duplicating points",()=>{
  const r=make(1),role=r.teams[0].id;
  send(r,role,"submitQuestions",{answers:{night:["совы","летучая мышь"],light:["фонарь"]}});
  assert.equal(r.scores[role],300);assert.equal(r.runs[role].cleared,false);
  const restored=JSON.parse(JSON.stringify(r));
  send(restored,role,"submitQuestions",{answers:{night:["совы летучая мышь"],light:["фонарик, свеча, фонари"]}});
  assert.deepEqual(view(restored,role).run.accepted,{night:2,light:2});
  assert.equal(restored.scores[role],600);assert.equal(restored.runs[role].cleared,true);
  assert.deepEqual(restored.runs[role].videos,[1]);
});

test("free-format input keeps payload bounds and validates the whole submission before awarding",()=>{
  for(const invalid of [null,12,{},[false],[{}],"x".repeat(481),Array(482).fill("")]) {
    const r=make(1),role=r.teams[0].id;
    assert.throws(()=>send(r,role,"submitQuestions",{answers:{night:"сова",light:invalid}}),e=>e.status===400);
    assert.equal(r.scores[role],0);assert.deepEqual(r.runs[role].found,{});
  }
  const r=make(1),role=r.teams[0].id;
  assert.throws(()=>send(r,role,"submitQuestions",{answers:{night:"  \n ",light:[]}}),e=>e.status===400);
});
test("final questions unlock individual videos; one team's finish does not finish or block others",()=>{
  const r=make(),[a,b]=r.teams.map(t=>t.id);
  for(let i=0;i<4;i++){submitRight(r,a);send(r,a,"continue");}
  send(r,a,"submitQuestions",{answers:{orb:["луна"]}});
  assert.ok(view(r,a).run.stageVideos.includes(5));assert.equal(r.runs[a].cleared,false);
  submitRight(r,a);assert.deepEqual(view(r,a).run.stageVideos,[5,6,7,8]);
  send(r,a,"continue");assert.equal(r.runs[a].done,true);assert.equal(r.phase,"playing");
  assert.equal(view(r,b).roundIndex,0);
  for(let i=0;i<5;i++){submitRight(r,b);send(r,b,"continue");}
  assert.equal(r.phase,"finished");assert.ok(Object.values(r.scores).every(score=>score===2600));
});
test("peer thanks awards only the helper once per sender/stage, never deducts or permits self-awards",()=>{
  const r=make(3),[a,b,c]=r.teams.map(t=>t.id);
  assert.throws(()=>send(r,a,"thank",{helper:a}),GameError);
  assert.throws(()=>send(r,a,"thank",{helper:"absent"}),GameError);
  send(r,a,"thank",{helper:b});assert.equal(r.scores[b],100);assert.equal(r.scores[a],0);
  send(r,a,"thank",{helper:b});assert.equal(r.scores[b],100);
  assert.throws(()=>send(r,a,"thank",{helper:c}),GameError);
  send(r,c,"thank",{helper:b});assert.equal(r.scores[b],200);
  const restored=JSON.parse(JSON.stringify(r));send(restored,a,"thank",{helper:b});assert.equal(restored.scores[b],200);
  submitRight(r,a);send(r,a,"continue");send(r,a,"thank",{helper:b});assert.equal(r.scores[b],300);
});
test("scoring is validated and host-configurable; changes affect future awards, not previous points",()=>{
  for(const scoring of [{answer:-1},{code:1.5},{thanks:"100"},{stage:10001},{unknown:1},null])assert.throws(()=>validateScoring(scoring),GameError);
  const r=make(2,{answer:7,code:11,stage:13,thanks:17}),[a,b]=r.teams.map(t=>t.id);
  assert.throws(()=>send(r,a,"setScoring",{scoring:{answer:1000}}),GameError);
  submitRight(r,a);assert.equal(r.scores[a],34);
  send(r,a,"thank",{helper:b});assert.equal(r.scores[b],17);
  send(r,"host","setScoring",{scoring:{code:50,stage:20}});
  send(r,a,"continue");submitRight(r,a);assert.equal(r.scores[a],104);
  assert.equal(r.scores[b],17);
});
test("all slot sizes finish through real team sessions without phantom teams or previews",()=>{
  for(let count=1;count<=8;count++) {
    const r=make(count);
    assert.equal("previews" in view(r,"host"),false);
    assert.equal("testMode" in view(r,"host"),false);
    for(const team of r.teams)for(let step=0;step<5;step++) {
      submitRight(r,team.id);send(r,team.id,"continue");
    }
    assert.equal(r.phase,"finished");assert.ok(r.teams.every(t=>r.scores[t.id]===2600));
  }
});
test("one team plays without client hints; ordinary joining is required and removed test bypasses are rejected",()=>{
  const r=createRoom("123456",Date.now(),undefined,1),role=r.teams[0].id;
  assert.throws(()=>dispatch(r,"host","setTestMode",{enabled:true}),GameError);
  // Even stored flags from older v2 rooms cannot bypass real joining.
  r.testMode=true;
  assert.throws(()=>dispatch(r,"host","start"),GameError);
  joinRoom(r,role,r.members[role].invite);dispatch(r,"host","start");
  assert.throws(()=>dispatch(r,"host","submitQuestions",{asTeam:role,roundIndex:0,answers:right(r.flow[0])}),e=>e.status===403);
  for(const stage of r.flow) {
    assert.equal("hints" in view(r,role),false);
    assert.throws(()=>send(r,role,"thank",{helper:role}),GameError);
    submitRight(r,role);send(r,role,"continue");
  }
  assert.equal(r.phase,"finished");assert.equal(r.scores[role],2600);
  assert.deepEqual(r.runs[role].videos,[1,2,3,4,5,6,7,8]);
});
test("legacy rooms remain playable and authorizations never expose another team's hint library",()=>{
  const old=legacy.createRoom("654321");assert.equal(view(old,"host").engine,undefined);
  const r=make(),[a,b]=r.teams.map(t=>t.id);
  assert.equal(authorize(r,r.members[a].token),a);
  assert.throws(()=>dispatch(r,a,"thank",{asTeam:b,helper:a,roundIndex:0}),GameError);
  const own=view(r,a),other=view(r,b);
  assert.equal("hints" in own,false);assert.equal("hints" in other,false);
  assert.equal("hints" in own.teams.find(t=>t.id===b),false);
  assert.throws(()=>send(r,a,"submitQuestions",{answers:{wrong:["value"]}}),GameError);
});
