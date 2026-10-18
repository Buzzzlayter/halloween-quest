// Contract and interaction checks; not a browser/layout test.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { ROUNDS } from "../server/scenario.mjs";
import { createRoom, joinRoom, act, dispatch, view } from "../server/game-engine.mjs";
const read = file => readFile(new URL("../" + file, import.meta.url), "utf8");
const content = { window: {} }; vm.runInNewContext(await read("dist/assets/tasks.js"), content);

test("host checkbox enables rehearsal start and role tabs drive genuine team controls on one screen", async () => {
  const window={}, document={createElement:tag=>new Element(tag)};
  vm.runInNewContext(await read("dist/assets/room-ui.js"),{window,document});
  const r=createRoom("123456"),root=new Element(),draft={items:[]};
  const redraw=()=>window.RoomUI.render(root,view(r,"host"),handlers,draft);
  const handlers={redraw,invite(){},newGame(){},act(name,data={}) {
    const asTeam=draft.testRole && draft.testRole!=="host" ? draft.testRole : undefined;
    dispatch(r,"host",name,{roundIndex:r.roundIndex,...data,asTeam}); redraw();
  }};
  redraw();
  assert.equal(root.all().find(el=>el.textContent==="Все в сборе — начать").disabled,true);
  const check=root.all().find(el=>el.type==="checkbox");
  assert.equal(check.checked,false); check.checked=true; await check.listeners.change();
  assert.equal(root.all().find(el=>el.textContent==="Начать тест").disabled,false);
  await root.all().find(el=>el.textContent==="Начать тест").click();
  for (const role of ["pumpkins","bats","ghosts","mages"]) {
    const team=view(r,"host").teams.find(t=>t.id===role);
    await root.all().find(el=>el.tagName==="button" && el.textContent===team.icon+" "+team.name).click();
    assert.equal(draft.testRole,role);
    await root.all().find(el=>el.textContent==="Поделились подсказкой — готовы").click();
  }
  assert.equal(r.phase,"answer");
  await root.all().find(el=>el.tagName==="button" && el.textContent==="👻 Привидения").click();
  const choice=root.all().find(el=>el.className==="picture-choice" && el.attributes["aria-label"].startsWith("Четвёртый дух"));
  await choice.click();
  await root.all().find(el=>el.textContent==="Предложить командам").click();
  assert.equal(r.phase,"vote");
  for (const role of ["pumpkins","bats","mages"]) {
    const team=view(r,"host").teams.find(t=>t.id===role);
    await root.all().find(el=>el.tagName==="button" && el.textContent===team.icon+" "+team.name).click();
    await root.all().find(el=>el.textContent==="Согласны").click();
  }
  assert.equal(r.phase,"solved");
  await root.all().find(el=>el.tagName==="button" && el.textContent==="🎩 Ведущий").click();
  await root.all().find(el=>el.textContent==="Обсудили — следующий этап").click();
  assert.equal(r.roundIndex,1);
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
  assert.equal(tasks.filter(t=>t.video).length,7);
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
