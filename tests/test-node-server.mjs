import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import qrcode from "qrcode-generator";
import {GameError} from "../server/game-engine.mjs";
import {createGameApi} from "../server/node-api.mjs";
import {createQuestServer,parseRange} from "../server/node-server.mjs";
import {runFlow} from "./flow-api-helpers.mjs";

// Fault-injection store for API error handling. Real persistence is tested separately.
class Database {
  rows=new Map();failWrite=false;loseResponse=false;calls=[];
  store(){return {
    check:async()=>{},
    get:async code=>structuredClone(this.rows.get(code)||null),
    insert:async room=>{if(this.rows.has(room.code))return false;this.rows.set(room.code,{revision:0,snapshot:structuredClone(room)});return true;},
    compareAndSwap:async(code,revision,room)=>{
      if(this.failWrite){this.failWrite=false;throw new GameError("Save failed",503);}
      if(this.rows.get(code)?.revision!==revision)return false;
      this.rows.set(code,{revision:revision+1,snapshot:structuredClone(room)});
      if(this.loseResponse){this.loseResponse=false;throw new GameError("Save acknowledgement lost",503);}
      return true;
    },
    removeExpired:async now=>{for(const [code,row] of this.rows)if(row.snapshot.expiresAt<now)this.rows.delete(code);}
  };}
}
function api(db,options={}) {
  const handle=createGameApi({store:db.store(),...options});
  return async(command,body,auth,headers={})=>{
    const response=await handle(new Request("https://quest.example"+command,{
      method:body===undefined?"GET":"POST",headers:{...(auth?{Authorization:"Bearer "+auth.token}:{}),...headers},
      ...(body===undefined?{}:{body:typeof body==="string"?body:JSON.stringify(body)})
    }));
    return {status:response.status,data:response.headers.get("content-type")?.includes("json")?await response.json():await response.text()};
  };
}
async function room(db,count=2) {
  const call=api(db),created=await call("/api/rooms",{teamCount:count});assert.equal(created.status,200);
  const host=created.data,route="/api/rooms/"+host.code;
  const state=(await call(route+"/state",undefined,host)).data;
  return {call,host,route,state};
}

test("Node server requires an explicit store",()=>{
  assert.throws(()=>createQuestServer(),/store is required/);
});

test("parallel team joins survive across independent Node instances and duplicate answers award only once",async()=>{
  const db=new Database(),{call,host,route,state}=await room(db,8);
  const joins=await Promise.all(state.teams.map((team,index)=>(index%2?api(db):call)(route+"/join",{team:team.id,invite:state.invites[team.id]})));
  assert.ok(joins.every(r=>r.status===200));
  const started=(await api(db)(route+"/state",undefined,host)).data;
  assert.equal(started.phase,"playing");assert.equal(started.teams.filter(t=>t.joined).length,8);
  const team=joins[0].data,questions=started.guides[team.role][0].questions;
  const answers=Object.fromEntries(questions.map(q=>[q.id,q.answers[0].variants[0]]));
  const submitted=await Promise.all(Array.from({length:5},()=>api(db)(route+"/action",{action:"finishQuestions",roundIndex:0,answers},team)));
  assert.ok(submitted.every(r=>r.status===200));
  const latest=(await api(db)(route+"/state",undefined,team)).data;
  assert.equal(latest.run.summary.correct,6);assert.equal(latest.teams.find(t=>t.id===team.role).score,800);
  assert.equal("guides" in latest,false);assert.equal("invites" in latest,false);
});

test("failed saves and lost acknowledgements preserve committed state and hide provider details",async()=>{
  const db=new Database(),{call,host,route,state}=await room(db,1),id=state.teams[0].id;
  const team=(await call(route+"/join",{team:id,invite:state.invites[id]})).data;
  const answers=Object.fromEntries(state.guides[id][0].questions.map(q=>[q.id,q.answers[0].variants[0]]));
  const submit={action:"finishQuestions",roundIndex:0,answers};
  db.failWrite=true;
  const failed=await call(route+"/action",submit,team);
  assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(failed.data),/test-service-role-key|secret-provider-error/);
  assert.equal((await call(route+"/state",undefined,team)).data.run.cleared,false);
  db.loseResponse=true;assert.equal((await call(route+"/action",submit,team)).status,503);
  assert.equal((await call(route+"/state",undefined,team)).data.run.cleared,true);
  assert.equal((await api(db)(route+"/action",submit,team)).status,200);
  const restored=(await api(db)(route+"/state",undefined,host)).data;
  assert.equal(restored.teams[0].score,800);
});

test("new API keeps authorization, host recovery, malformed payload, expiry and origin boundaries",async()=>{
  const db=new Database(),{call,host,route,state}=await room(db,2),id=state.teams[0].id;
  assert.equal((await call(route+"/state")).status,401);
  assert.equal((await call("/api/rooms",{teamCount:9})).status,400);
  assert.equal((await call("/api/rooms",{teamCount:1},null,{Origin:"https://foreign.example"})).status,403);
  for(const body of ["[]","null","{oops"] )assert.equal((await call("/api/rooms",body)).status,400);
  assert.equal((await call("/api/rooms",JSON.stringify({text:"x".repeat(33000)}))).status,413);
  assert.equal((await call(route+"/join",{team:id,invite:"wrong"})).status,403);
  const team=(await call(route+"/join",{team:id,invite:state.invites[id]})).data;
  assert.equal((await call(route+"/qr/"+id,undefined,team)).status,403);
  await call(route+"/action",{action:"setTeamActive",team:state.teams[1].id,active:false},host);
  assert.equal((await call(route+"/state",undefined,team)).data.phase,"playing");
  const ended=await call(route+"/action",{action:"finishGame"},host);assert.equal(ended.data.finale.reason,"host");
  const expires=db.rows.get(host.code).snapshot.expiresAt;
  assert.equal((await api(db,{clock:()=>expires+1})(route+"/state",undefined,host)).status,410);
});

test("range parsing supports mobile MP4 playback and rejects out-of-file or malformed ranges",()=>{
  assert.deepEqual(parseRange("bytes=2-4",10),{start:2,end:4});
  assert.deepEqual(parseRange("bytes=8-",10),{start:8,end:9});
  assert.deepEqual(parseRange("bytes=-3",10),{start:7,end:9});
  assert.deepEqual(parseRange("bytes=0-99",10),{start:0,end:9});
  for(const range of ["bytes=10-","bytes=5-2","bytes=-0","bytes=1-2,4-5","bytes=-"])assert.equal(parseRange(range,10),false);
});

test("Node HTTP serves only public files, new-host QR and byte ranges; full 1/8-team flows work unchanged",async()=>{
  const db=new Database(),directory=await mkdtemp(path.join(tmpdir(),"halloween-node-test-"));
  let now=Date.now();const server=createQuestServer({store:db.store(),publicDir:directory,clock:()=>now});
  try {
    await writeFile(path.join(directory,"index.html"),"<!doctype html><h1>Quest</h1>");
    await writeFile(path.join(directory,"play.html"),"<!doctype html><h1>Play</h1>");
    await writeFile(path.join(directory,"test.mp4"),Buffer.from("0123456789"));
    await writeFile(path.join(directory,".env"),"PRIVATE-SENTINEL");
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    const page=await fetch(base+"/");assert.match(await page.text(),/<h1>Quest/);assert.equal(page.headers.get("content-encoding"),"gzip");
    assert.equal((await fetch(base+"/healthz")).status,200);
    const oversized=await fetch(base+"/api/rooms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:"x".repeat(33000)}),signal:AbortSignal.timeout(3000)});
    assert.equal(oversized.status,413);
    for(const name of ["/.env","/server/task-bank.json","/rooms.sqlite","/node_modules/qrcode-generator/package.json","/%2eenv"])
      assert.equal((await fetch(base+name)).status,404,name);
    const fragment=await fetch(base+"/test.mp4",{headers:{Range:"bytes=2-4"}});
    assert.equal(fragment.status,206);assert.equal(await fragment.text(),"234");assert.equal(fragment.headers.get("content-range"),"bytes 2-4/10");
    const suffix=await fetch(base+"/test.mp4",{headers:{Range:"bytes=-2"}});assert.equal(await suffix.text(),"89");
    const head=await fetch(base+"/test.mp4",{method:"HEAD"});assert.equal(head.headers.get("content-length"),"10");assert.equal(await head.text(),"");
    assert.equal((await fetch(base+"/test.mp4",{headers:{Range:"bytes=50-"}})).status,416);
    const qr=qrcode(0,"M");qr.addData(base+"/?id=1");qr.make();
    assert.equal(await(await fetch(base+"/qr/task-01.svg")).text(),qr.createSvgTag({cellSize:8,margin:32,scalable:true}));
    await runFlow(base,1,ms=>{now+=ms;});await runFlow(base,8,ms=>{now+=ms;});
    const api=createGameApi({store:db.store()}),data=[...db.rows.values()][0].snapshot;
    assert.equal((await api(new Request("http://local/api/rooms/"+data.code+"/state",{headers:{Authorization:"Bearer "+data.hostToken}}))).status,200);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    await rm(directory,{recursive:true,force:true});
  }
});
