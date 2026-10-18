import assert from "node:assert/strict";
import test from "node:test";
import { createRoom, joinRoom, authorize, act, dispatch, view, GameError } from "../server/game-engine.mjs";
import { ROUNDS, TEAMS } from "../server/scenario.mjs";
const roles = TEAMS.map(team => team.id);
const room = () => {
  const r = createRoom("123456");
  for (const role of roles) joinRoom(r, role, r.members[role].invite);
  return r;
};
const action = (r, role, name, data = {}) => act(r, role, name, { roundIndex: r.roundIndex, ...data });
const ready = r => roles.forEach(role => action(r, role, "ready"));
function propose(r, items = ROUNDS[r.roundIndex].solution) {
  action(r, ROUNDS[r.roundIndex].captain, "propose", { items }); return r.proposal.id;
}
const agree = r => { for (const role of roles.filter(role => role !== ROUNDS[r.roundIndex].captain)) action(r, role, "vote", { proposalId: r.proposal.id, approve: true }); };
const blocked = fn => assert.throws(fn, GameError);

test("test mode is host-only, reversible in lobby and never marks real devices connected", () => {
  const r = createRoom("123456");
  const send = (role, name, data={}) => dispatch(r, role, name, {roundIndex:r.roundIndex,...data});
  assert.equal(view(r,"host").testMode,false);
  assert.equal("previews" in view(r,"host"),false);
  blocked(() => send("host","ready",{asTeam:"bats"}));
  blocked(() => send("bats","setTestMode",{enabled:true}));
  blocked(() => send("host","setTestMode",{enabled:"true"}));
  send("host","setTestMode",{enabled:true});
  assert.equal(view(r,"host").testMode,true);
  assert.equal(Object.keys(view(r,"host").previews).length,4);
  for (const team of view(r,"host").teams) assert.equal(team.joined,false);
  send("host","setTestMode",{enabled:false});
  blocked(() => send("host","start"));
  blocked(() => send("host","ready",{asTeam:"bats"}));
  send("host","setTestMode",{enabled:true}); send("host","start");
  blocked(() => send("host","setTestMode",{enabled:false}));
  blocked(() => send("host","ready",{asTeam:"host"}));
  const joined = joinRoom(r,"bats",r.members.bats.invite);
  assert.equal(authorize(r,joined.token),"bats");
  blocked(() => send("bats","ready",{asTeam:"pumpkins"}));
  assert.equal("previews" in view(r,"bats"),false);
});

test("one host token can rehearse all eight rounds through simulated roles without separate team logins", () => {
  const r=createRoom("123456");
  const send = (name,data={}) => dispatch(r,"host",name,{roundIndex:r.roundIndex,...data});
  send("setTestMode",{enabled:true}); send("start");
  for (const round of ROUNDS) {
    for (const role of roles) {
      assert.deepEqual(view(r,"host").previews[role].clue,round.clues[role]);
      send("ready",{asTeam:role});
    }
    send("propose",{asTeam:round.captain,items:round.solution});
    const id=r.proposal.id;
    for (const role of roles.filter(id=>id!==round.captain)) send("vote",{asTeam:role,proposalId:id,approve:true});
    if (round.activationOrder) for (const role of round.activationOrder) send("activate",{asTeam:role});
    assert.equal(r.phase,"solved"); send("next");
  }
  assert.equal(r.phase,"finished"); assert.equal(r.sparks.length,8);
  assert.ok(roles.every(role=>r.members[role].joined===false));
});

test("five authenticated roles complete all eight rounds; only host advances, sparks never duplicate", () => {
  const r = room(); action(r, "host", "start");
  const captains = {};
  for (const round of ROUNDS) {
    assert.equal(view(r, "host").round.id, round.id);
    captains[round.captain] = (captains[round.captain] || 0) + 1;
    blocked(() => action(r, "host", "next"));
    ready(r); propose(r); agree(r);
    if (round.activationOrder) {
      assert.equal(r.phase, "ritual"); assert.equal(r.sparks.length, round.id - 1);
      blocked(() => action(r, "host", "activate"));
      for (const role of round.activationOrder) {
        const other = roles.find(id => id !== role);
        blocked(() => action(r, other, "activate")); action(r, role, "activate");
      }
    }
    assert.equal(r.phase, "solved"); assert.equal(r.sparks.length, round.id);
    blocked(() => action(r, roles[0], "next")); blocked(() => action(r, roles[0], "ready"));
    action(r, "host", "next");
  }
  assert.equal(r.phase, "finished"); assert.equal(r.sparks.length, 8);
  assert.deepEqual(Object.values(captains), [2, 2, 2, 2]);
  blocked(() => action(r, "host", "next"));
});

test("missing teams, stolen role claims and invalid credentials cannot start or inspect the game", () => {
  const r = createRoom("123456");
  blocked(() => authorize(r, undefined)); blocked(() => authorize(r, r.members.bats.token));
  blocked(() => joinRoom(r, "bats", r.members.ghosts.invite));
  blocked(() => action(r, "host", "start"));
  for (const role of roles) {
    const joined = joinRoom(r, role, r.members[role].invite);
    assert.equal(authorize(r, joined.token), role);
  }
  assert.equal(authorize(r, r.hostToken), "host");
  blocked(() => action(r, "bats", "start"));
  action(r, "host", "start");
  for (const role of roles) {
    const state = view(r, role), serialized = JSON.stringify(state);
    assert.deepEqual(state.clue, ROUNDS[0].clues[role]);
    for (const key of ["guide","invites","members","hostToken"]) assert.equal(key in state, false);
    assert.equal("solution" in state.round, false);
    for (const other of roles.filter(id => id !== role)) {
      assert.equal(serialized.includes(ROUNDS[0].clues[other].text), false);
      assert.equal(serialized.includes(r.members[other].token), false);
    }
  }
  assert.ok(view(r, "host").guide.solution);
});

test("all four readiness signals and distinct team votes are required; retries and veto do not award sparks", () => {
  const r = room(); action(r, "host", "start");
  blocked(() => propose(r)); roles.slice(0, 3).forEach(role => action(r, role, "ready"));
  blocked(() => propose(r)); action(r, roles[3], "ready");
  blocked(() => action(r, "host", "propose", { items: ["g4"] }));
  blocked(() => action(r, "bats", "propose", { items: ["g4"] }));
  blocked(() => propose(r, ["unknown"]));
  const id = propose(r, ["g1"]);
  action(r, "pumpkins", "vote", { proposalId: id, approve: true });
  const v = r.version;
  action(r, "pumpkins", "vote", { proposalId: id, approve: true });
  assert.equal(r.version, v); assert.equal(r.phase, "vote");
  blocked(() => action(r, "host", "vote", { proposalId: id, approve: true }));
  agree(r);
  assert.equal(r.phase, "discussion"); assert.equal(r.attempts, 1); assert.deepEqual(r.sparks, []);
  ready(r); const second = propose(r);
  blocked(() => action(r, "bats", "vote", { proposalId: id, approve: true }));
  action(r, "bats", "vote", { proposalId: second, approve: false });
  assert.equal(r.phase, "discussion"); assert.equal(r.proposal, null);
  assert.deepEqual(r.ready, {}); assert.deepEqual(r.sparks, []);
  ready(r); propose(r); agree(r);
  assert.deepEqual(r.sparks, [1]); action(r, "host", "next");
  blocked(() => act(r, "bats", "ready", { roundIndex: 0 }));
});

test("memory clue is redacted by server after ready, including after refresh; host can reopen without solving", () => {
  const r = room(); r.roundIndex = 2; r.phase = "briefing";
  assert.ok(view(r, "pumpkins").clue);
  action(r, "pumpkins", "ready");
  assert.equal(view(r, "pumpkins").clue, null);
  assert.equal(view(JSON.parse(JSON.stringify(r)), "pumpkins").clue, null);
  assert.ok(view(r, "bats").clue);
  blocked(() => action(r, "pumpkins", "reopen"));
  action(r, "host", "reopen"); assert.ok(view(r, "pumpkins").clue);
  assert.deepEqual(r.sparks, []);
});

test("closed rooms reject actions and joins; two rooms stay isolated", () => {
  const a = room(), b = room();
  action(a, "host", "start"); assert.equal(b.phase, "lobby");
  blocked(() => authorize(b, a.hostToken));
  action(a, "host", "close"); assert.equal(view(a, "bats").phase, "closed");
  blocked(() => action(a, "host", "start"));
  blocked(() => joinRoom(a, "bats", a.members.bats.invite));
  assert.equal(b.phase, "lobby");
});

test("visual choices require all four clues and have exactly one solution; recipe constraints are uniquely solvable", () => {
  for (const round of ROUNDS) {
    assert.equal(round.solution.length, round.slots);
    assert.deepEqual(Object.keys(round.clues).sort(), [...roles].sort());
    for (const id of round.solution) assert.ok(round.options.some(option => option.id === id));
    if (round.checks) {
      const matching = checks => round.options.filter(option => checks.every(([index, badge]) => option.badges[index] === badge));
      assert.deepEqual(matching(round.checks).map(option => option.id), round.solution);
      for (let i = 0; i < 4; i++) assert.ok(matching(round.checks.filter((_, index) => index !== i)).length > 1, "Every clue must rule out a plausible choice");
    }
    if (round.constraints) {
      const permutations = (prefix, rest) => prefix.length === round.slots ? [prefix] : rest.flatMap(id => permutations([...prefix,id],rest.filter(other => other !== id)));
      const solutions = permutations([], round.options.map(option => option.id)).filter(items => round.constraints.every(c => c.not ? !items.includes(c.not) : c.before ? items.indexOf(c.before[0]) < items.indexOf(c.before[1]) : items[c.at] === c.value));
      assert.deepEqual(solutions, [round.solution]);
    }
  }
});
