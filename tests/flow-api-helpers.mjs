import assert from "node:assert/strict";
export async function request(base,path,auth,body,status=200) {
  const response=await fetch(new URL(path,base),{method:body===undefined?"GET":"POST",
    headers:{...(auth?{Authorization:"Bearer "+auth.token}:{}),...(body===undefined?{}:{"Content-Type":"application/json"})},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,status,"HTTP contract: "+path.replace(/\d{6}/g,"ROOM"));return response;
}
export async function runFlow(base,count,advanceTime=()=>new Promise(resolve=>setTimeout(resolve,60_100))) {
  let host;const sessions={};let hostState;
  const getState=async role=>(await request(base,"/api/rooms/"+host.code+"/state",sessions[role])).json();
  const teamState=getState;
  const action=async(role,name,data={},status=200)=>{
    const own=role==="host"?hostState:await teamState(role);
    const response=await request(base,"/api/rooms/"+host.code+"/action",sessions[role],
      {action:name,roundIndex:own.roundIndex,...data},status);
    const result=await response.json();
    if(status===200&&role==="host")hostState=result;
    return result;
  };
  try {
    host=await (await request(base,"/api/rooms",null,{teamCount:count})).json();sessions.host=host;
    hostState=await getState("host");
    assert.equal(hostState.engine,"quest-flow-v2");assert.equal(hostState.teamCount,count);
    const roles=hostState.teams.map(t=>t.id);
    await request(base,"/api/rooms/"+host.code+"/state",null,undefined,401);
    {
      await action("host","start",{},409);
      for(const [index,role] of roles.entries()) {
        sessions[role]=await (await request(base,"/api/rooms/"+host.code+"/join",null,{team:role,invite:hostState.invites[role]})).json();
        const state=await teamState(role);
        assert.equal(state.phase,index===roles.length-1?"playing":"lobby");
      }
      const qr=await request(base,"/api/rooms/"+host.code+"/qr/"+roles.at(-1),host);
      assert.match(qr.headers.get("content-type"),/image\/svg\+xml/);assert.match(await qr.text(),/<svg/);
      await request(base,"/api/rooms/"+host.code+"/qr/"+roles[0],sessions[roles[0]],undefined,403);
    }
    hostState=await getState("host");
    assert.equal(hostState.phase,"playing");
    assert.equal("testMode" in hostState,false);assert.equal("previews" in hostState,false);
    await action("host","setTestMode",{enabled:true},403);
    await action("host","submitQuestions",{asTeam:roles[0],answers:{}},403);
    const guides=hostState.guides||Object.fromEntries(roles.map(role=>[role,hostState.guide]));
    const assigned=roles.flatMap(role=>guides[role].flatMap(stage=>(stage.questions||[]).map(q=>q.id)));
    const codes=roles.flatMap(role=>guides[role].filter(s=>s.type==="code").map(s=>s.code));
    assert.equal(assigned.length,count*12);assert.equal(new Set(codes).size,codes.length);
    for(const role of roles) {
      const own=guides[role].flatMap(stage=>(stage.questions||[]).map(q=>q.id));
      assert.equal(new Set(own).size,12);
    }
    const [first,helper]=roles;
    await action(first,"thank",{helper:first},400);
    if(helper) {
      await action(first,"thank",{helper});
      await action(first,"thank",{helper});
    }
    for(let index=0;index<guides[first].length;index++) {
      if(guides[first][index].type==="code") {
        await action("host","startCodeTimer",{stageIndex:index,minutes:1});
        await action(first,"submitCode",{code:guides[first][index].code},409);
        await advanceTime(60_100);
      }
      for(const role of roles) {
        let own=await teamState(role);const stage=guides[role][index];
        assert.equal("guide" in own,false);assert.equal("runs" in own,false);
        assert.equal("guides" in own,false);assert.equal("taskCatalog" in own,false);
        assert.equal("hints" in own,false);
        if(stage.type==="questions") {
          assert.equal("answers" in own.stage.questions[0],false);
          assert.ok(own.stage.questions.every(q=>!("solution" in q)));
          assert.deepEqual(stage.questions.map(q=>q.videoId),stage.id==="welcome"?[1,1,2,3,4,4]:[5,5,6,6,7,8]);
          const answers=Object.fromEntries(stage.questions.map(q=>[q.id,q.answers.slice(0,q.required).map(a=>a.variants[0])]));
          own=await action(role,"submitQuestions",{answers});
        } else {
          assert.equal("code" in own.stage,false);
          own=await action(role,"submitCode",{code:stage.code});
        }
        assert.equal(own.run.cleared,true);assert.ok(own.run.stageVideos.length);
        assert.equal(own.stage.epilogue,stage.epilogue);
        if(stage.type==="questions")assert.deepEqual(own.stage.questions.map(q=>q.solution.explanation),stage.questions.map(q=>q.explanation));
        const score=own.teams.find(t=>t.id===role).score;
        // Resubmission cannot award the completed block again.
        if(stage.type==="code")own=await action(role,"submitCode",{code:stage.code});
        assert.equal(own.teams.find(t=>t.id===role).score,score);
        own=await action(role,"continue");
        if(index===4) {assert.equal(own.run.done,true);assert.equal(own.run.videos.length,8);}
        if(index===4&&role===first&&helper) {
        const waiting=await teamState(helper);
        assert.equal(waiting.roundIndex,4);assert.equal(waiting.run.done,false);
        assert.equal("finale" in own,false);assert.equal("finale" in waiting,false);
        }
      }
    }
    hostState=await getState("host");
    assert.equal(hostState.phase,"finished");
    assert.deepEqual(hostState.finale.videoIds,[5,6,7,8]);
    assert.deepEqual(hostState.finale.allVideoIds,[1,2,3,4,5,6,7,8]);
    for(const role of roles)assert.deepEqual((await teamState(role)).finale,hostState.finale);
    for(const team of hostState.teams) {
      assert.equal(team.score,team.id===helper?3200:3100);
      assert.equal(hostState.runs[team.id].relevant,12);assert.equal(hostState.runs[team.id].codes,3);
    }
    console.log("PASS: "+count+" teams, independent sessions, automatic questions/codes, all videos, points, no client hints"+(helper?", peer thanks.":"."));
  } finally { if(host)await request(base,"/api/rooms/"+host.code+"/action",host,{action:"close"}); }
}
