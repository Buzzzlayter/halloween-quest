import test from "node:test";
import assert from "node:assert/strict";
import {createRoom,joinRoom,act,view} from "../server/game-engine.mjs";
const make=()=>{
  const r=createRoom("123456",Date.now(),undefined,1),role=r.teams[0].id;
  delete r.codePolicy;delete r.codeTimers; // Exercise existing pre-timer rooms.
  joinRoom(r,role,r.members[role].invite);act(r,"host","start");
  return {r,role,questions:r.teamFlows[role][0].questions};
};
test("final submission accepts wrong, missing and entirely empty fields and reports accurate counts",()=>{
  for(const kind of ["empty","wrong","mixed-wrong","mixed-empty","correct"]) {
    const {r,role,questions}=make(),[a,b]=questions;
    const answer=q=>q.answers[0].variants[0];
    const answers=kind==="empty"?{}:kind==="wrong"?{[a.id]:"!!! неизвестно",[b.id]:"не знаем"}
      :kind==="mixed-wrong"?{[a.id]:answer(a),[b.id]:"не знаем"}:kind==="mixed-empty"?{[a.id]:answer(a),[b.id]:" \n "}
      :Object.fromEntries(questions.map(q=>[q.id,answer(q)]));
    act(r,role,"finishQuestions",{roundIndex:0,answers});
    const state=view(r,role),summary=state.run.summary;
    const correct=kind==="correct"?6:kind.startsWith("mixed")?1:0;
    const incorrect=kind==="wrong"?2:kind==="mixed-wrong"?1:0;
    const skipped=6-correct-incorrect;
    assert.equal(summary.correct,correct);assert.equal(summary.incorrect,incorrect);assert.equal(summary.skipped,skipped);
    assert.equal(summary.total,6);assert.equal(summary.notCorrect,6-correct);
    assert.equal(summary.points,correct*100+(correct===6?200:0));
    assert.equal(r.scores[role],summary.points);assert.equal(state.run.cleared,true);
    assert.deepEqual(state.run.videos,[1]);
    assert.deepEqual(view(r,"host").runs[role].results.welcome,summary);
    act(r,role,"continue",{roundIndex:0});assert.equal(view(r,role).stage.type,"code");
  }
});
test("final results are immutable across retries, alternative action names, refresh and serialization",()=>{
  const {r,role,questions:[a,b]}=make();
  act(r,role,"submitQuestions",{roundIndex:0,answers:{[a.id]:a.answers[0].variants[0]}});
  const restored=JSON.parse(JSON.stringify(r)),saved=view(restored,role).run.summary;
  assert.equal(saved.correct,1);assert.equal(saved.skipped,5);
  for(const action of ["finishQuestions","submitQuestions"])act(restored,role,action,{roundIndex:0,answers:{[a.id]:a.answers[0].variants[0],[b.id]:b.answers[0].variants[0]}});
  assert.deepEqual(view(restored,role).run.summary,saved);assert.equal(restored.scores[role],100);
  assert.equal(restored.runs[role].history.filter(id=>id==="welcome").length,1);
  act(restored,role,"continue",{roundIndex:0});
  assert.throws(()=>act(restored,role,"finishQuestions",{roundIndex:0,answers:{}}),e=>e.status===409);
});
test("malformed or foreign-question payloads fail without consuming the single submission",()=>{
  for(const answers of [null,{foreign:"ответ"},{},]) {
    const {r,role,questions:[a,b]}=make();
    if(answers&&Object.keys(answers).length===0)answers[a.id]=123;
    assert.throws(()=>act(r,role,"finishQuestions",{roundIndex:0,answers}),e=>e.status===400);
    assert.equal(r.runs[role].cleared,false);assert.equal(r.runs[role].results,undefined);assert.equal(r.scores[role],0);
    act(r,role,"finishQuestions",{roundIndex:0,answers:{[a.id]:a.answers[0].variants[0],[b.id]:b.answers[0].variants[0]}});
    assert.equal(view(r,role).run.summary.correct,2);
  }
});
test("configured points apply only to correct answers and cannot be changed after final submission",()=>{
  const {r,role,questions:[a,b]}=make();
  act(r,"host","setScoring",{scoring:{answer:7,stage:13}});
  act(r,role,"finishQuestions",{roundIndex:0,answers:{[a.id]:a.answers[0].variants[0]}});
  assert.equal(r.scores[role],7);assert.equal(view(r,role).run.summary.points,7);
  act(r,"host","setScoring",{scoring:{answer:1000,stage:2000}});
  act(r,role,"finishQuestions",{roundIndex:0,answers:{[a.id]:a.answers[0].variants[0],[b.id]:b.answers[0].variants[0]}});
  assert.equal(r.scores[role],7);assert.equal(view(r,role).run.summary.points,7);
});
test("all missed questions still show every video and allow finishing without awarding failed-stage points",()=>{
  const {r,role}=make();
  for(const [index,stage] of r.teamFlows[role].entries()) {
    act(r,role,stage.type==="questions"?"finishQuestions":"submitCode",{roundIndex:index,...(stage.type==="questions"?{answers:{}}:{code:stage.code})});
    act(r,role,"continue",{roundIndex:index});
  }
  assert.equal(r.phase,"finished");assert.equal(r.scores[role],1500);
  assert.deepEqual(r.runs[role].videos,[1,2,3,4,5,6,7,8]);
  assert.equal(view(r,role).run.summary.correct,0);assert.equal(view(r,role).run.summary.skipped,6);
});
test("old failed-stage snapshots also expose their videos without changing results, points or persisted state",()=>{
  const {r,role}=make();
  r.teamFlows[role][0].questions=r.teamFlows[role][0].questions.slice(0,2); // Existing two-question room.
  act(r,role,"finishQuestions",{roundIndex:0,answers:{}});
  r.runs[role].videos=[]; // Previous release kept failed submissions without a video.
  const before=JSON.stringify(r);
  assert.deepEqual(view(r,role).run.stageVideos,[1]);
  assert.equal(JSON.stringify(r),before);assert.equal(r.scores[role],0);
  assert.equal(view(r,role).run.summary.skipped,2);
});
test("wrong code does not award points, reveal its video or allow advancing",()=>{
  const {r,role}=make();
  act(r,role,"finishQuestions",{roundIndex:0,answers:{}});act(r,role,"continue",{roundIndex:0});
  const stage=r.teamFlows[role][1],wrong=stage.code==="0000"?"0001":"0000";
  act(r,role,"submitCode",{roundIndex:1,code:wrong},10000);
  assert.deepEqual(view(r,role).run.stageVideos,[]);
  assert.equal(r.runs[role].videos.includes(2),true);
  assert.equal(r.runs[role].cleared,false);assert.equal(r.scores[role],0);
  assert.throws(()=>act(r,role,"continue",{roundIndex:1}),e=>e.status===409);
  act(r,role,"submitCode",{roundIndex:1,code:stage.code},11000);
  assert.equal(r.runs[role].cleared,true);assert.equal(r.scores[role],500);
  assert.deepEqual(view(r,role).run.stageVideos,[2]);
});

test("all code stages hide videos from old wrong-attempt snapshots until the code is correct",()=>{
  const {r,role}=make();
  for(const q of r.teamFlows[role][0].questions)q.videoId=1; // Old room only watched the ghost at first.
  for(const stage of r.teamFlows[role])delete stage.videoTiming;
  act(r,role,"finishQuestions",{roundIndex:0,answers:{}});act(r,role,"continue",{roundIndex:0});
  for(let index=1;index<=3;index++) {
    const stage=r.teamFlows[role][index],id=stage.videoIds[0],now=index*10000;
    const wrong=stage.code==="0000"?"0001":"0000";
    act(r,role,"submitCode",{roundIndex:index,code:wrong},now);
    assert.deepEqual(view(r,role).run.stageVideos,[]);
    r.runs[role].videos.push(id); // Persisted before code-only rewards were introduced.
    const restored=JSON.parse(JSON.stringify(r)),saved=JSON.stringify(restored);
    assert.deepEqual(view(restored,role).run.stageVideos,[]);
    assert.equal(view(restored,role).run.videos.includes(id),false);
    assert.equal(JSON.stringify(restored),saved);
    act(r,role,"submitCode",{roundIndex:index,code:stage.code},now+1000);
    assert.deepEqual(view(r,role).run.stageVideos,[id]);
    assert.equal(view(r,role).run.cleared,true);
    act(r,role,"continue",{roundIndex:index});
  }
  assert.deepEqual(view(r,role).run.videos,[1,2,3,4]);
});
