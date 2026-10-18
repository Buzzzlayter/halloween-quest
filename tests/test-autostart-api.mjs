import assert from "node:assert/strict";
import {request} from "./flow-api-helpers.mjs";
const base=process.argv[2]||"http://127.0.0.1:8787";
for(const count of [1,2,8]) {
  let host;
  try {
    host=await(await request(base,"/api/rooms",null,{teamCount:count})).json();
    const path="/api/rooms/"+host.code;
    const state=async auth=>(await request(base,path+"/state",auth)).json();
    const initial=await state(host),teams=initial.teams;
    assert.equal(initial.phase,"lobby");
    const join=async team=>(await request(base,path+"/join",null,{team:team.id,invite:initial.invites[team.id]})).json();
    const earlier=await Promise.all(teams.slice(0,-1).map(join));
    assert.equal((await state(host)).phase,"lobby");
    if(earlier.length) {
      await join(teams[0]);
      assert.equal((await state(host)).phase,"lobby");
      assert.equal((await state(host)).teams.filter(t=>t.joined).length,count-1);
    }
    const last=teams.at(-1);
    await request(base,path+"/join",null,{team:last.id,invite:"invalid-invite"},403);
    assert.equal((await state(host)).phase,"lobby");
    const final=await join(last),sessions=[...earlier,final];
    for(const auth of [host,...sessions]) {
      const started=await state(auth);
      assert.equal(started.phase,"playing");
      assert.equal(started.teams.filter(t=>t.joined).length,count);
      if(auth!==host)assert.equal(started.stage.type,"questions");
    }
    const first=sessions[0];
    await request(base,path+"/action",first,{action:"finishQuestions",roundIndex:0,answers:{}});
    await request(base,path+"/action",first,{action:"continue",roundIndex:0});
    await join(teams[0]);
    const rejoined=await state(first);
    assert.equal(rejoined.run.stageIndex,1);
    assert.equal(rejoined.phase,"playing");
    console.log("PASS: "+count+" slots auto-start on last valid join; no host start; parallel joins and reconnect preserve progression.");
  } finally {
    if(host)await request(base,"/api/rooms/"+host.code+"/action",host,{action:"close"});
  }
}
