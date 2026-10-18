// Rehearse all rounds using only the host session; no team sessions are joined.
import assert from "node:assert/strict";
import { ROUNDS, TEAMS } from "../server/scenario.mjs";
const base=process.argv[2];
if (!base || !/^https?:\/\//.test(base)) throw new Error("Pass an explicit local or production URL");
let host,index=0;
async function request(path,body,expected=200) {
  const r=await fetch(new URL(path,base),{method:body===undefined?"GET":"POST",
    headers:{...(host?{Authorization:"Bearer "+host.token}:{}),...(body===undefined?{}:{"Content-Type":"application/json"})},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  assert.equal(r.status,expected); return r.json();
}
const act=(action,data={},expected=200)=>request("/api/rooms/"+host.code+"/action",{action,roundIndex:index,...data},expected);
try {
  host=await request("/api/rooms",{});
  await act("ready",{asTeam:"bats"},403);
  await act("start",{},409);
  let state=await act("setTestMode",{enabled:true});
  assert.equal(state.testMode,true); assert.ok(state.teams.every(t=>!t.joined));
  state=await act("start");
  await act("setTestMode",{enabled:false},409);
  for (const round of ROUNDS) {
    for (const team of TEAMS) {
      assert.deepEqual(state.previews[team.id].clue,round.clues[team.id]);
      state=await act("ready",{asTeam:team.id});
    }
    if (round.memory) for (const team of TEAMS) assert.equal(state.previews[team.id].clue,null);
    state=await act("propose",{asTeam:round.captain,items:round.solution});
    const proposalId=state.proposal.id;
    for (const team of TEAMS.filter(t=>t.id!==round.captain)) state=await act("vote",{asTeam:team.id,proposalId,approve:true});
    if (round.activationOrder) for (const role of round.activationOrder) state=await act("activate",{asTeam:role});
    assert.equal(state.phase,"solved");
    assert.equal(state.sparks.length,index+1);
    state=await act("next"); index=Math.min(index+1,ROUNDS.length-1);
  }
  assert.equal(state.phase,"finished"); assert.equal(state.sparks.length,8);
  assert.ok(state.teams.every(t=>!t.joined));
  console.log("PASS: host-only test checkbox, 4 simulated roles, all 8 rounds, no real team connections.");
} finally { if(host) await act("close"); }
