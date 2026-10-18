// Contract and interaction checks; not a browser/layout test.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { ROUNDS } from "../server/scenario.mjs";
import { createRoom, joinRoom, act, dispatch, view } from "../server/legacy-engine.mjs";
const read = file => readFile(new URL("../" + file, import.meta.url), "utf8");
const content = { window: {} }; vm.runInNewContext(await read("dist/assets/tasks.js"), content);

test("creation screen sends the selected team count to the server and renders exactly those slots", async () => {
  const client=await read("dist/assets/room-client.js"),ui=await read("dist/assets/room-ui.js");
  for(const count of [1,2,8]) {
    const ids=["room-app","room-message","room-code","room-role","room-reward","leave-room","invite-dialog","invite-image","invite-loading","invite-title","invite-link","copy-invite"];
    const nodes=new Map(ids.map(id=>[id,new Element()]));
    const root=nodes.get("room-app"),storage=new Map();let created,posted;
    const document={hidden:false,createElement:tag=>new Element(tag),addEventListener(){},
      getElementById:id=>nodes.get(id)||root.all().find(el=>el.id===id)};
    const window={location:{search:"",origin:"http://example.test"},history:{replaceState(){}},confirm:()=>true,
      setTimeout:()=>1,clearTimeout(){},localStorage:{getItem:key=>storage.get(key),setItem:(key,val)=>storage.set(key,val),removeItem:key=>storage.delete(key)}};
    const fetch=async(path,options)=>{
      let data;
      if(path==="/api/config")data={minTeams:1,maxTeams:8,defaultTeams:4};
      else if(path==="/api/rooms") {
        posted=JSON.parse(options.body);
        created=createRoom("123456",Date.now(),undefined,posted.teamCount);
        data={code:created.code,role:"host",token:created.hostToken};
      } else data=view(created,"host");
      return {ok:true,status:200,json:async()=>data};
    };
    const context=vm.createContext({window,document,fetch,URL,URLSearchParams,AbortController});
    vm.runInContext(ui,context);await vm.runInContext(client,context);
    document.getElementById("room-size").value=String(count);
    await root.all().find(el=>el.textContent==="Создать игру ведущего").click();
    assert.equal(posted.teamCount,count);
    assert.equal(root.all().filter(el=>el.className==="invite-card").length,count);
    assert.equal(JSON.parse(storage.get("halloween-room-session-v1")).role,"host");
  }
});

test("room setup derives the slot picker from server limits, including future added cards", async () => {
  const window={},document={createElement:tag=>new Element(tag)};
  vm.runInNewContext(await read("dist/assets/room-ui.js"),{window,document});
  const setup=window.RoomUI.roomSetup({minTeams:1,maxTeams:8,defaultTeams:4});
  const select=setup.all().find(el=>el.tagName==="select");
  assert.equal(select.name,"teamCount");assert.equal(select.value,"4");
  assert.deepEqual(select.children.map(el=>el.value),["1","2","3","4","5","6","7","8"]);
  const expanded=window.RoomUI.roomSetup({minTeams:1,maxTeams:9,defaultTeams:4});
  assert.equal(expanded.all().find(el=>el.tagName==="select").children.at(-1).value,"9");
});

test("legacy lobbies render only their selected slots without test controls", async () => {
  const window={},document={createElement:tag=>new Element(tag)};
  vm.runInNewContext(await read("dist/assets/room-ui.js"),{window,document});
  for(const count of [1,2,8]) {
    const r=createRoom("123456",Date.now(),undefined,count),root=new Element();
    const handlers={redraw(){},act(){},invite(){},newGame(){}};
    window.RoomUI.render(root,view(r,"host"),handlers,{items:[]});
    assert.equal(root.all().filter(el=>el.className==="invite-card").length,count);
    for(const team of r.teams)joinRoom(r,team.id,r.members[team.id].invite);
    act(r,"host","start",{roundIndex:0});
    window.RoomUI.render(root,view(r,"host"),handlers,{items:[]});
    assert.equal(root.all().some(el=>el.type==="checkbox"||el.className==="room-test-controls"),false);
    assert.equal(root.all().filter(el=>el.className==="room-roster-team").length,count);
  }
});

test("shared score cards, explicit reward reasons and host-only help are visible", async () => {
  const window={}, document={createElement:tag=>new Element(tag)};
  vm.runInNewContext(await read("dist/assets/room-ui.js"),{window,document});
  const r=createRoom("123456");
  for (const role of Object.keys(r.members)) joinRoom(r,role,r.members[role].invite);
  act(r,"host","start",{roundIndex:0});
  act(r,"bats","ready",{roundIndex:0});
  const root=new Element(), draft={items:[]};
  const handlers={redraw(){},invite(){},newGame(){},act(name,data) { dispatch(r,"host",name,{roundIndex:0,...data}); }};
  window.RoomUI.render(root,view(r,"host"),handlers,draft);
  assert.ok(root.all().some(el=>el.className==="team-score" && el.textContent==="50"));
  assert.ok(root.all().some(el=>el.textContent?.includes("Поделились подсказкой")));
  await root.all().find(el=>el.textContent==="🦇 Мыши +100").click();
  assert.equal(r.scores.bats,150);
  window.RoomUI.render(root,view(r,"host"),handlers,draft);
  assert.equal(root.all().find(el=>el.textContent==="🦇 Мыши ✓").disabled,true);
  window.RoomUI.render(root,view(r,"bats"),handlers,draft);
  assert.equal(root.all().some(el=>el.className?.includes("help-bonus")),false);
  const toast=new Element();
  window.RoomUI.showReward(toast,r.scoreEvents,view(r,"bats").teams,"bats");
  assert.equal(toast.hidden,false);
  assert.ok(toast.all().some(el=>el.textContent==="🦇 Мыши: +150"));
  assert.ok(toast.all().some(el=>el.textContent?.includes("отметил ведущий")));
});

test("legacy lobby has no test checkbox and waits for ordinary team connections", async () => {
  const window={},document={createElement:tag=>new Element(tag)};
  vm.runInNewContext(await read("dist/assets/room-ui.js"),{window,document});
  const r=createRoom("123456"),root=new Element(),handlers={redraw(){},invite(){},newGame(){},act(){}};
  window.RoomUI.render(root,view(r,"host"),handlers,{items:[]});
  assert.equal(root.all().some(el=>el.type==="checkbox"),false);
  assert.equal(root.all().find(el=>el.textContent==="Все в сборе — начать").disabled,true);
  for(const team of r.teams)joinRoom(r,team.id,r.members[team.id].invite);
  window.RoomUI.render(root,view(r,"host"),handlers,{items:[]});
  assert.equal(root.all().find(el=>el.textContent==="Все в сборе — начать").disabled,false);
});
class Element {
  constructor(tag="div") {
    this.tagName=tag; this.children=[]; this.listeners={}; this.attributes={}; this.dataset={}; this.paused=true;
    this.style={setProperty() {},removeProperty() {}};
    const classes=new Set(); this.classList={add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),contains:n=>classes.has(n)};
  }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children=items; }
  setAttribute(k,v) { this.attributes[k]=v; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(k,v) { this.listeners[k]=v; }
  async click() { if (!this.disabled) await this.listeners.click?.(); }
  all() { return [this,...this.children.flatMap(child=>child.all())]; }
  play() { this.paused=false; this.listeners.play?.(); return Promise.resolve(); }
  pause() { this.paused=true; this.listeners.pause?.(); }
}

test("public cards keep IDs/media and never ship private clues or solutions; no retired editor or movement controls", async () => {
  const tasks=content.window.HALLOWEEN_TASKS;
  assert.deepEqual(Array.from(tasks,t=>t.id),ROUNDS.map(r=>r.id));
  for (const task of tasks) {
    const round=ROUNDS.find(r=>r.id===task.id);
    assert.equal(task.title,round.title); assert.equal(task.text,round.goal); assert.ok(task.image);
    assert.equal("clues" in task,false); assert.equal("solution" in task,false);
  }
  assert.equal(tasks.filter(t=>t.video).length,8);
  for (const file of ["dist/index.html","dist/task/index.html","dist/play.html"]) {
    const html=await read(file);
    assert.doesNotMatch(html,/editor|task-steps|task-replay|gesture-art/);
  }
});

test("all public QR targets render a goal and media; video uses one play/pause control and sound enabled", async () => {
  const js=await read("dist/assets/task-page.js");
  for (const task of content.window.HALLOWEEN_TASKS) {
    const nodes=new Map(["animation","task-kicker","task-title","task-prompt","task-story"].map(id=>["#"+id,new Element()]));
    const document={body:new Element(),documentElement:new Element(),querySelector:s=>nodes.get(s),createElement:tag=>new Element(tag)};
    const window={...content.window, location:{search:"?id="+task.id},matchMedia:()=>({matches:true})};
    vm.runInNewContext(js,{window,document,URLSearchParams});
    assert.equal(nodes.get("#task-title").textContent,task.title);
    assert.equal(nodes.get("#task-prompt").textContent,task.text);
    const all=nodes.get("#animation").all();
    const video=all.find(el=>el.tagName==="video");
    if (task.video) {
      assert.equal(video.muted,false); assert.equal(video.defaultMuted,false);
      assert.equal(video.autoplay,false);
      assert.equal(all.filter(el=>el.tagName==="button").length,1);
      assert.equal(all.find(el=>el.tagName==="button").attributes["aria-label"],"Воспроизвести анимацию");
    } else assert.ok(all.find(el=>el.tagName==="img"));
  }
});

test("room UI exposes only its role's available actions and host can reopen a team QR midgame", async () => {
  const window={}; const document={createElement:tag=>new Element(tag)};
  vm.runInNewContext(await read("dist/assets/room-ui.js"),{window,document});
  const r=createRoom("123456");
  for (const role of Object.keys(r.members)) joinRoom(r,role,r.members[role].invite);
  act(r,"host","start",{roundIndex:0});
  const root=new Element(), actions=[], invites=[];
  const handlers={act:(...args)=>actions.push(args),redraw(){},invite:id=>invites.push(id),newGame(){}};
  window.RoomUI.render(root,view(r,"pumpkins"),handlers,{items:[]});
  let all=root.all();
  assert.equal(all.filter(el=>el.textContent==="Предложить командам").length,0);
  assert.ok(all.some(el=>el.textContent===ROUNDS[0].clues.pumpkins.text));
  assert.equal(all.some(el=>el.textContent===ROUNDS[0].clues.bats.text),false);
  await all.find(el=>el.textContent==="Поделились подсказкой — готовы").click();
  assert.deepEqual(actions,[["ready"]]);
  window.RoomUI.render(root,view(r,"host"),handlers,{items:[]});
  await root.all().find(el=>el.title==="Показать QR команды").click();
  assert.deepEqual(invites,["pumpkins"]);
  for (const role of Object.keys(r.members)) act(r,role,"ready",{roundIndex:0});
  window.RoomUI.render(root,view(r,"ghosts"),handlers,{items:[]});
  assert.ok(root.all().find(el=>el.textContent==="Предложить командам").disabled);
  const draft={items:[ROUNDS[0].solution[0]]};
  window.RoomUI.render(root,view(r,"ghosts"),handlers,draft);
  await root.all().find(el=>el.textContent==="Предложить командам").click();
  assert.equal(actions.at(-1)[0],"propose");
  assert.deepEqual(Array.from(actions.at(-1)[1].items),ROUNDS[0].solution);
});

test("host catalogue expands from data without adding checkboxes, editor or local progress", async () => {
  const nodes=new Map(["quest-list","quest-qr","qr-image","qr-pending","qr-title","qr-name","qr-open-task"].map(id=>[id,new Element()]));
  nodes.get("quest-qr").showModal=function(){this.open=true;};
  const document={body:{classList:{contains:()=>true}},getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag)};
  const extra={id:99,title:"Новый образ"};
  const window={HALLOWEEN_TASKS:[...content.window.HALLOWEEN_TASKS,extra],location:{hash:""},addEventListener(){}};
  vm.runInNewContext(await read("dist/assets/control-panel.js"),{window,document});
  assert.equal(nodes.get("quest-list").children.length,9);
  assert.equal(nodes.get("quest-list").all().some(el=>el.tagName==="input"),false);
  await nodes.get("quest-list").children.at(-1).children[1].click();
  assert.equal(nodes.get("qr-image").src,"qr/task-99.svg");
  assert.equal(nodes.get("quest-qr").open,true);
});
