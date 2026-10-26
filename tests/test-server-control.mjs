import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readdir,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {registerControl,stopManaged} from "../scripts/server-control.mjs";

test("stop commands authenticate and target only their own server mode",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"quest-control-test-"));let local=0,pub=0,closeLocal,closePublic;
  try {
    closeLocal=await registerControl("local",()=>{local++;closeLocal();},dir);
    closePublic=await registerControl("public",()=>{pub++;closePublic();},dir);
    const file=(await readdir(dir)).find(name=>name.startsWith("local-")),data=JSON.parse(await readFile(path.join(dir,file),"utf8"));
    const denied=await fetch(`http://127.0.0.1:${data.port}/stop`,{method:"POST",headers:{"x-quest-stop":"wrong"}});
    assert.equal(denied.status,403);assert.equal(local,0);
    assert.equal(await stopManaged("local",dir),1);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(local,1);assert.equal(pub,0);
    assert.equal(await stopManaged("public",dir),1);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(pub,1);
  } finally {await closeLocal?.();await closePublic?.();await rm(dir,{recursive:true,force:true});}
});
