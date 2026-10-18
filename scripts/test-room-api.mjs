// Creates one disposable test room, simulates five phones and closes it.
// Explicit URL required; credentials/invite links are never printed.
import assert from "node:assert/strict";
import { ROUNDS, TEAMS } from "../server/scenario.mjs";
const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base)) throw new Error("Pass an explicit local or production URL");
const roles = TEAMS.map(team => team.id);
let host, sessions = {}, current = 0;
async function request(path, session, body, expected = 200, extraHeaders = {}) {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? "GET" : "POST", redirect: "follow",
    headers: { ...(session ? {Authorization:"Bearer "+session.token}:{}), ...(body === undefined ? {} : {"Content-Type":"application/json"}), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000)
  });
  assert.equal(response.status, expected, "HTTP contract: "+path.replace(/\d{6}/g,"ROOM"));
  return response;
}
const state = async session => (await request("/api/rooms/"+host.code+"/state",session)).json();
const act = async (role, action, data={}, expected=200) => (await request("/api/rooms/"+host.code+"/action",sessions[role],{action,roundIndex:current,...data},expected)).json();
try {
  assert.equal((await (await request("/api/health")).json()).game,"shared-clues-v1");
  host = await (await request("/api/rooms",null,{})).json(); sessions.host=host;
  await request("/api/rooms/"+host.code+"/state",null,undefined,401);
  await request("/api/rooms/"+host.code+"/create",null,{},404);
  const lobby=await state(host);
  await act("host","start",{},409);
  await request("/api/rooms/"+host.code+"/join",null,{team:"bats",invite:lobby.invites.ghosts},403);
  for (const role of roles) sessions[role]=await (await request("/api/rooms/"+host.code+"/join",null,{team:role,invite:lobby.invites[role]})).json();
  await act("bats","setTestMode",{enabled:true},403);
  await act("bats","ready",{asTeam:"pumpkins"},403);
  await act("host","ready",{asTeam:"pumpkins"},403);
  const qr=await request("/api/rooms/"+host.code+"/qr/pumpkins",host);
  assert.match(qr.headers.get("content-type"),/image\/svg\+xml/);
  assert.match(await qr.text(),/<svg/); assert.equal(qr.headers.get("cache-control"),"no-store");
  await request("/api/rooms/"+host.code+"/qr/bats",sessions.bats,undefined,403);
  await request("/api/rooms/"+host.code+"/action",host,{action:"start",roundIndex:0},403,{Origin:"https://not-the-game.example"});
  await act("host","start");
  await act("bats","helpBonus",{team:"bats"},403);
  await act("host","helpBonus",{team:"bats"});
  await act("host","helpBonus",{team:"bats"});
  assert.equal((await state(host)).teams.find(t=>t.id==="bats").score,100);
  for (const round of ROUNDS) {
    for (const role of roles) {
      const s=await state(sessions[role]); assert.deepEqual(s.clue,round.clues[role]);
      assert.equal("guide" in s,false); assert.equal("invites" in s,false); assert.equal("solution" in s.round,false);
    }
    await Promise.all(roles.map(role=>act(role,"ready")));
    if (round.memory) for (const role of roles) assert.equal((await state(sessions[role])).clue,null);
    await act("host","propose",{items:round.solution},403);
    let proposed=await act(round.captain,"propose",{items:round.solution});
    const id=proposed.proposal.id;
    await Promise.all(roles.filter(role=>role!==round.captain).map(role=>act(role,"vote",{proposalId:id,approve:true})));
    let s=await state(host);
    if (round.activationOrder) {
      assert.equal(s.phase,"ritual");
      await act("host","activate",{},403);
      for (const role of round.activationOrder) {
        await act(roles.find(other=>other!==role),"activate",{},409);
        await act(role,"activate");
      }
    }
    s=await state(host); assert.equal(s.phase,"solved"); assert.equal(s.sparks.length,current+1);
    const snapshot=await state(sessions.bats); assert.equal(snapshot.sparks.length,s.sparks.length);
    assert.deepEqual(snapshot.teams.map(t=>t.score),s.teams.map(t=>t.score));
    assert.ok(snapshot.scoreEvents.some(event=>event.kind==="solved" && event.points===200));
    await act("host","next"); current=Math.min(current+1,ROUNDS.length-1);
  }
  const end=await state(host); assert.equal(end.phase,"finished"); assert.equal(end.sparks.length,8);
  for (const team of end.teams) assert.equal(team.score,team.id==="bats"?3000:2900);
  for (const role of roles) assert.equal((await state(sessions[role])).phase,"finished");
  console.log("PASS: five independent sessions, all 8 rounds, concurrent readiness/votes, private clues, memory, rituals, QR and role/origin guards.");
} finally {
  if (host) await act("host","close");
}
