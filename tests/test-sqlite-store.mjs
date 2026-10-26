import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {SqliteRoomStore} from "../server/sqlite-store.mjs";
import {createQuestServer} from "../server/node-server.mjs";
import {createGameApi} from "../server/node-api.mjs";
import {runFlow} from "./flow-api-helpers.mjs";

test("SQLite persists state on reopen and atomically rejects duplicate inserts and stale writes",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"quest-sqlite-")),file=path.join(dir,"rooms.sqlite");
  let a,b;
  try {
    a=new SqliteRoomStore(file);b=new SqliteRoomStore(file);
    assert.throws(()=>new SqliteRoomStore(":memory:"),/persistent/);
    const room={code:"123456",expiresAt:5000,points:100};
    assert.equal(await a.insert(room),true);assert.equal(await b.insert(room),false);
    const reads=await Promise.all([a.get(room.code),b.get(room.code)]);
    const writes=await Promise.all([a.compareAndSwap(room.code,reads[0].revision,{...room,points:200}),b.compareAndSwap(room.code,reads[1].revision,{...room,points:300})]);
    assert.deepEqual(writes,[true,false]);
    const own=await b.get(room.code);own.snapshot.points=999;
    assert.equal((await a.get(room.code)).snapshot.points,200);
    b.close();b=null;a.close();a=new SqliteRoomStore(file);
    assert.deepEqual(await a.get(room.code),{revision:1,snapshot:{...room,points:200}});
    await a.removeExpired(4999);assert.ok(await a.get(room.code));
    await a.removeExpired(5001);assert.equal(await a.get(room.code),null);
    await a.check();
  } finally {b?.close();a?.close();await rm(dir,{recursive:true,force:true});}
});

test("SQLite serves complete 1 and 8 team games and never exposes its database",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"quest-sqlite-http-")),store=new SqliteRoomStore(path.join(dir,"rooms.sqlite"));
  let now=Date.now();const server=createQuestServer({store,clock:()=>now});
  try {
    await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
    const base="http://127.0.0.1:"+server.address().port;
    assert.equal((await (await fetch(base+"/api/health")).json()).storage,"sqlite");
    for(const resource of ["/.local-data/rooms.sqlite","/rooms.sqlite","/server/sqlite-store.mjs"])
      assert.equal((await fetch(base+resource)).status,404);
    await runFlow(base,1,ms=>{now+=ms;});await runFlow(base,8,ms=>{now+=ms;});
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();await rm(dir,{recursive:true,force:true});}
});

test("SQLite API saves parallel joins and awards duplicate submissions only once",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"quest-sqlite-api-")),store=new SqliteRoomStore(path.join(dir,"rooms.sqlite"));
  const handle=createGameApi({store});
  const call=async(route,body,token)=>{
    const response=await handle(new Request("https://quest.example"+route,{method:body?"POST":"GET",headers:token?{Authorization:"Bearer "+token}:{},body:body?JSON.stringify(body):undefined}));
    assert.equal(response.status,200);return response.json();
  };
  try {
    const host=await call("/api/rooms",{teamCount:8}),route="/api/rooms/"+host.code;
    const state=await call(route+"/state",null,host.token);
    const teams=await Promise.all(state.teams.map(t=>call(route+"/join",{team:t.id,invite:state.invites[t.id]})));
    const started=await call(route+"/state",null,host.token);
    assert.equal(started.phase,"playing");assert.equal(started.teams.filter(t=>t.joined).length,8);
    const team=teams[0],questions=started.guides[team.role][0].questions;
    const answers=Object.fromEntries(questions.map(q=>[q.id,q.answers[0].variants[0]]));
    await Promise.all(Array.from({length:5},()=>call(route+"/action",{action:"finishQuestions",roundIndex:0,answers},team.token)));
    const latest=await call(route+"/state",null,team.token);
    assert.equal(latest.teams.find(t=>t.id===team.role).score,800);
  } finally {store.close();await rm(dir,{recursive:true,force:true});}
});
