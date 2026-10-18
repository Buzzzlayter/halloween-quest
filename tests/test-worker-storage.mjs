import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
import * as engine from "../server/game-engine.mjs";
import {teamsFor} from "../server/room-scenario.mjs";

async function harness() {
  let saved,failPut=false,failAlarm=false;
  const storage={get:async()=>structuredClone(saved),put:async(k,v)=>{
    if(failPut){failPut=false;throw Error("storage unavailable");}saved=structuredClone(v);
  },setAlarm:async()=>{if(failAlarm){failAlarm=false;throw Error("alarm unavailable");}},deleteAll:async()=>{saved=undefined;}};
  const context=vm.createContext({DurableObject:class{},...engine,teamsFor,structuredClone,Request,Response,URL,Date,Uint8Array,Uint32Array,TextDecoder,crypto,console:{error(){}}});
  let source=await readFile(new URL("../server/worker.mjs",import.meta.url),"utf8");
  source=source.replace(/^import .*;\r?$/gm,"").replace("export class QuestRoom","class QuestRoom").replace("export default","globalThis.worker =");
  vm.runInContext(source+"\nglobalThis.RoomClass=QuestRoom;",context);
  const make=()=>new context.RoomClass({storage,blockConcurrencyWhile:fn=>fn()},{});
  let object=make();
  return {
    get room(){return object.room;},get saved(){return structuredClone(saved);},
    failPut(){failPut=true;},failAlarm(){failAlarm=true;},reload(){object=make();},
    async call(command,body,token) {
      const response=await object.fetch(new Request("https://test.local/api/rooms/123456/"+command,{
        method:body===undefined?"GET":"POST",headers:{...(token?{Authorization:"Bearer "+token}:{}),...(body===undefined?{}:{"Content-Type":"application/json"})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})
      }));return {status:response.status,data:await response.json()};
    }
  };
}
async function started(count=1) {
  const h=await harness();assert.equal((await h.call("create",{code:"123456",teamCount:count})).status,200);
  for(const t of h.room.teams)assert.equal((await h.call("join",{team:t.id,invite:h.room.members[t.id].invite})).status,200);
  return h;
}
const answers=(r,id)=>Object.fromEntries(r.teamFlows[id][0].questions.map(q=>[q.id,q.answers[0].variants[0]]));

test("failed create or alarm never installs an unsaved room and a retry succeeds",async()=>{
  for(const failure of ["failPut","failAlarm"]) {
    const h=await harness();h[failure]();
    assert.equal((await h.call("create",{code:"123456",teamCount:1})).status,500);
    assert.equal(h.room,undefined);assert.equal(h.saved,undefined);
    assert.equal((await h.call("create",{code:"123456",teamCount:1})).status,200);
    assert.equal(h.room.phase,"lobby");
  }
});

test("a failed final join cannot autostart only in memory or burn the invitation",async()=>{
  const h=await harness();await h.call("create",{code:"123456",teamCount:1});
  const id=h.room.teams[0].id,body={team:id,invite:h.room.members[id].invite},before=h.saved;
  h.failPut();assert.equal((await h.call("join",body)).status,500);
  assert.deepEqual(h.room,before);assert.deepEqual(h.saved,before);
  assert.equal((await h.call("join",body)).status,200);assert.equal(h.room.phase,"playing");
});

test("failed answer persistence leaves no phantom score; retry and reload award exactly once",async()=>{
  const h=await started(),id=h.room.teams[0].id,token=h.room.members[id].token,before=h.saved;
  const body={action:"finishQuestions",roundIndex:0,answers:answers(h.room,id)};
  h.failPut();assert.equal((await h.call("action",body,token)).status,500);
  assert.deepEqual(h.room,before);assert.deepEqual(h.saved,before);
  const responses=await Promise.all([h.call("action",body,token),h.call("action",body,token)]);
  assert.ok(responses.every(r=>r.status===200));assert.equal(h.room.scores[id],400);
  const committed=h.saved;h.reload();
  assert.equal((await h.call("state",undefined,token)).data.teams[0].score,400);
  assert.deepEqual(h.room,committed);
});

test("failed finish or participation persistence does not split client state from storage",async()=>{
  const h=await started(2),id=h.room.teams[1].id,token=h.room.hostToken;
  for(const body of [{action:"setTeamActive",team:id,active:false},{action:"finishGame"}]) {
    const before=h.saved;h.failPut();
    assert.equal((await h.call("action",body,token)).status,500);
    assert.deepEqual(h.room,before);assert.deepEqual(h.saved,before);
  }
  assert.equal((await h.call("action",{action:"finishGame"},token)).status,200);
  assert.equal(h.saved.phase,"finished");
});
