import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import TEAM_ART from "../server/team-art.json" with {type:"json"};
import {createRoom} from "./fixtures/fixed-room.mjs";
import {createRoom as createTimedRoom,joinRoom,act,dispatch,view,flowConfig,authorize} from "../server/game-engine.mjs";
const createDealtRoom=(...args)=>{const room=createTimedRoom(...args);delete room.codePolicy;delete room.codeTimers;return room;};
const read=name=>readFile(new URL("../dist/assets/"+name+".js",import.meta.url),"utf8");
class Element {
  constructor(tag="div"){this.tagName=tag;this.children=[];this.listeners={};this.attributes={};this.dataset={};this.paused=true;this.style={setProperty(){}};this.classList={add(){},remove(){}};}
  append(...els){this.children.push(...els);}replaceChildren(...els){this.children=els;}
  setAttribute(k,v){this.attributes[k]=v;}addEventListener(k,v){this.listeners[k]=v;}
  all(){return [this,...this.children.flatMap(e=>e.all())];}
  async click(){if(!this.disabled)await this.listeners.click?.();}
  play(){this.paused=false;this.listeners.play?.();return Promise.resolve();}pause(){this.paused=true;this.listeners.pause?.();}
}
async function ui(room) {
  const root=new Element(),window={confirm:()=>true,matchMedia:()=>({matches:true}),HALLOWEEN_MEDIA:Array.from({length:8},(_,i)=>({id:i+1,video:"quest-"+(i+1)+".mp4",poster:"poster.png",title:"Ролик "+(i+1),art:"art-"+(i+1)+".webp",teamIds:Object.keys(TEAM_ART).filter(team=>TEAM_ART[team]===i+1)}))};
  const document={createElement:tag=>new Element(tag),getElementById:id=>root.all().find(el=>el.id===id)};
  const context=vm.createContext({window,document});vm.runInContext(await read("room-ui"),context);vm.runInContext(await read("flow-ui"),context);
  return {root,window,document};
}
const start=()=>{const r=createRoom("123456",Date.now(),undefined,2);for(const role of r.teams.map(t=>t.id))joinRoom(r,role,r.members[role].invite);act(r,"host","start");return r;};
test("question form sends each phone's own answers, unlocks a sound-on video with one control and advances only itself",async()=>{
  const r=start(),role=r.teams[0].id,{root,window}=await ui(r),draft={items:[]};let lastAction;
  const render=()=>window.RoomUI.render(root,view(r,role),handlers,draft);
  const handlers={redraw:render,invite(){},newGame(){},act(name,data={}){lastAction=name;act(r,role,name,{roundIndex:r.runs[role].stageIndex,...data});render();}};
  render();
  assert.equal(root.all().some(e=>e.tagName==="video"),false);
  const inputs=root.all().filter(e=>e.tagName==="textarea");
  inputs[0].value="совы летучая мышь";inputs[0].listeners.input();
  inputs[1].value="фонарик, свеча, фонари";inputs[1].listeners.input();
  await root.all().find(e=>e.textContent==="Отправить ответы").click();
  assert.equal(lastAction,"finishQuestions");
  assert.deepEqual(view(r,role).run.accepted,{night:2,light:2});
  const video=root.all().find(e=>e.tagName==="video");
  assert.ok(video);assert.equal(video.muted,false);assert.equal(video.defaultMuted,false);
  assert.equal(root.all().filter(e=>e.className==="flow-video-control").length,1);
  const note=root.all().find(e=>e.className==="flow-video-note");
  assert.equal(note.hidden,true);
  assert.equal(root.all().some(e=>e.textContent?.includes("Если ролик не запустился со звуком")),false);
  await video.play();render();
  assert.equal(root.all().find(e=>e.tagName==="video"),video);
  assert.equal(video.paused,false);
  video.listeners.error();
  assert.equal(note.hidden,false);assert.match(note.textContent,/Ролик не загрузился/);
  assert.equal(root.all().some(e=>e.textContent==="Мои подсказки"),false);
  assert.ok(root.all().findIndex(e=>e.tagName==="video")<root.all().findIndex(e=>e.textContent==="К следующему этапу →"));
  assert.ok(root.all().some(e=>e.textContent==="Дальше: "+r.flow[1].title));
  await root.all().find(e=>e.textContent==="К следующему этапу →").click();
  assert.equal(r.runs[role].stageIndex,1);assert.equal(r.runs[r.teams[1].id].stageIndex,0);
  assert.ok(root.all().some(e=>e.textContent==="Проверить код"));
});

test("active rooms keep saved input but no longer demand one answer per line",async()=>{
  const r=start(),role=r.teams[0].id,{root,window}=await ui(r);
  r.flow[0].prompt="Советуйтесь всей командой. Пишите короткие ответы, каждый с новой строки.";
  r.flow[0].questions[1].prompt="Назовите два предмета, каждый с новой строки.";
  act(r,role,"submitQuestions",{roundIndex:0,answers:{night:["сова"],light:["фонарь"]}});
  window.RoomUI.render(root,view(r,role),{act(){},redraw(){},invite(){},newGame(){}},{});
  assert.equal(root.all().some(e=>e.textContent?.includes("каждый с новой строки")),false);
  const fields=root.all().filter(e=>e.tagName==="textarea");
  assert.equal(fields[0].value,"сова");assert.equal(fields[1].value,"фонарь");
  assert.equal(fields[1].placeholder,"Короткий ответ");
});
test("thanks UI credits another team, replaces the button after use, and host sees relevant counts",async()=>{
  const r=start(),a=r.teams[0].id,b=r.teams[1].id,{root,window}=await ui(r),draft={};
  const render=()=>window.RoomUI.render(root,view(r,a),handlers,draft);
  const handlers={redraw:render,invite(){},newGame(){},act(name,data){act(r,a,name,{roundIndex:0,...data});render();}};
  render();const helper=r.teams[1];
  await root.all().find(e=>e.textContent===helper.name+" +100").click();
  assert.equal(r.scores[b],100);assert.equal(r.scores[a],0);
  assert.ok(root.all().some(e=>e.textContent?.includes("уже поблагодарили")));
  act(r,a,"submitQuestions",{roundIndex:0,answers:{night:["сова"],light:["свеча","фонарь"]}});
  window.RoomUI.render(root,view(r,"host"),{act(){},redraw(){},invite(){},newGame(){}},{});
  assert.ok(root.all().some(e=>e.textContent?.includes("ответов: 3")));
  assert.ok(root.all().some(e=>e.textContent==="Настроить очки"));
});
test("host shows short solutions beside team answers and new current questions without a separate answer section",async()=>{
  const r=createRoom("123456",Date.now(),undefined,1),role=r.teams[0].id,{root,window}=await ui(r);
  const handlers={act(){},redraw(){},invite(){},newGame(){}};
  function renderHost() {
    window.RoomUI.render(root,view(r,"host"),handlers,{});
    assert.equal(root.all().some(e=>e.id==="flow-guide-host"||e.textContent==="Ответы для ведущего"),false);
    return root.all();
  }
  function checkTeam() {
    const state=view(r,role);
    assert.equal("guide" in state,false);
    window.RoomUI.render(root,state,handlers,{});
    assert.equal(root.all().some(e=>e.className==="flow-submitted"),false);
  }
  assert.equal(renderHost().some(e=>e.className==="flow-submitted"),false);
  joinRoom(r,role,r.members[role].invite);act(r,"host","start");
  assert.ok(renderHost().some(e=>e.textContent==="Нет ответа (летучая мышь; сова)"));
  act(r,role,"submitQuestions",{roundIndex:0,answers:{night:["слон"],light:["камень"]}});
  assert.ok(renderHost().some(e=>e.textContent==="слон (летучая мышь; сова)"));
  act(r,role,"submitQuestions",{roundIndex:0,answers:{night:["сова"],light:["свеча","фонарь"]}});
  const updated=renderHost();
  assert.ok(updated.some(e=>e.textContent==="сова (летучая мышь; сова)"));
  assert.equal(updated.some(e=>e.textContent==="слон (летучая мышь; сова)"),false);
  act(r,role,"continue",{roundIndex:0});
  assert.ok(renderHost().some(e=>e.textContent==="Нет ответа (1310)"));
  for(let index=1;index<=3;index++) {
    act(r,role,"submitCode",{roundIndex:index,code:r.flow[index].code});
    act(r,role,"continue",{roundIndex:index});
  }
  assert.ok(renderHost().some(e=>e.textContent==="Нет ответа (луна)"));
  assert.ok(renderHost().some(e=>e.textContent===r.flow[4].questions[0].prompt));
  act(r,role,"submitQuestions",{roundIndex:4,answers:{orb:["месяц"]}});
  assert.ok(renderHost().some(e=>e.textContent==="месяц (луна)"));
  checkTeam();
  act(r,role,"submitQuestions",{roundIndex:4,answers:Object.fromEntries(r.flow[4].questions.map(q=>[q.id,[q.answers[0].variants[0]]]))});
  assert.ok(renderHost().some(e=>e.textContent==="зелье (зелье)"));
  act(r,role,"continue",{roundIndex:4});
  assert.ok(renderHost().some(e=>e.textContent==="Итоговый рейтинг"));
  checkTeam();
});
test("host ranking sorts by score, shares places on ties and refreshes leadership after peer thanks",async()=>{
  const r=createRoom("123456",Date.now(),undefined,4);
  for(const team of r.teams)joinRoom(r,team.id,r.members[team.id].invite);
  act(r,"host","start");
  const {root,window}=await ui(r),invites=[];
  const render=()=>window.RoomUI.render(root,view(r,"host"),{act(){},redraw(){},invite:id=>invites.push(id),newGame(){}},{});
  const rows=()=>root.all().find(e=>e.className==="host-ranking").children;
  const original=r.teams.map(t=>t.id),[a,b,c,d]=original;
  render();
  assert.equal(rows().length,4);assert.ok(rows().every(row=>row.dataset.rank==="0"));
  assert.ok(root.all().some(e=>e.textContent==="Очков пока нет — лидер ещё не определён"));
  assert.equal(root.all().some(e=>e.className==="room-roster"),false);
  for(const role of [a,b])act(r,role,"submitQuestions",{roundIndex:0,answers:{night:"сова"}});
  render();
  assert.deepEqual(rows().map(e=>e.dataset.team),[a,b,c,d]);
  assert.deepEqual(rows().map(e=>e.dataset.rank),["1","1","3","3"]);
  assert.equal(rows().filter(e=>e.className.includes("--leader")).length,2);
  assert.ok(root.all().some(e=>e.textContent?.startsWith("Общее 1-е место:")));
  act(r,c,"thank",{roundIndex:0,helper:d});
  act(r,a,"thank",{roundIndex:0,helper:d});
  render();
  assert.deepEqual(rows().map(e=>e.dataset.team),[d,a,b,c]);
  assert.deepEqual(rows().map(e=>e.dataset.rank),["1","2","2","4"]);
  assert.equal(rows().filter(e=>e.className.includes("--leader")).length,1);
  assert.ok(root.all().some(e=>e.textContent?.startsWith("Лидер: "+r.teams[3].name)));
  await rows()[0].all().find(e=>e.className==="host-rank-team").click();
  assert.deepEqual(invites,[d]);
  assert.deepEqual(r.teams.map(t=>t.id),original);
  window.RoomUI.render(root,view(r,a),{act(){},redraw(){},invite(){},newGame(){}},{});
  assert.equal(root.all().some(e=>e.className==="host-ranking"),false);
  assert.ok(root.all().some(e=>e.className==="room-roster"));
});

test("host progress includes partial answers, caps synonyms and distinguishes all tasks cleared from finishing",async()=>{
  const r=createRoom("123456",Date.now(),undefined,1),role=r.teams[0].id;
  joinRoom(r,role,r.members[role].invite);act(r,"host","start");
  const {root,window}=await ui(r);
  const render=()=>window.RoomUI.render(root,view(r,"host"),{act(){},redraw(){},invite(){},newGame(){}},{});
  const meter=()=>root.all().find(e=>e.tagName==="progress");
  render();assert.equal(meter().value,0);assert.equal(meter().max,5);
  assert.ok(root.all().some(e=>e.textContent==="Одна команда · без соперников"));
  act(r,role,"submitQuestions",{roundIndex:0,answers:{night:"сова летучая мышь"}});
  render();assert.equal(meter().value,1/3);
  assert.ok(root.all().some(e=>e.textContent==="0 / 5 этапов · 6%"));
  act(r,role,"submitQuestions",{roundIndex:0,answers:{light:"свеча фонарь"}});
  render();assert.equal(meter().value,1);
  assert.ok(root.all().some(e=>e.textContent==="1 / 5 этапов · 20%"));
  assert.ok(root.all().some(e=>e.textContent==="Этап выполнен · переход дальше"));
  act(r,role,"continue",{roundIndex:0});
  render();assert.equal(meter().value,1);
  assert.ok(root.all().some(e=>e.textContent==="Этап 2 / 5 · "+r.flow[1].title));
  for(let index=1;index<=3;index++) {
    act(r,role,"submitCode",{roundIndex:index,code:r.flow[index].code});act(r,role,"continue",{roundIndex:index});
  }
  act(r,role,"submitQuestions",{roundIndex:4,answers:{orb:"луна"}});
  render();assert.equal(meter().value,4.25);
  assert.ok(root.all().some(e=>e.textContent==="4 / 5 этапов · 85%"));
  act(r,role,"submitQuestions",{roundIndex:4,answers:Object.fromEntries(r.flow[4].questions.map(q=>[q.id,q.answers[0].variants[0]]))});
  render();assert.equal(meter().value,5);
  assert.ok(root.all().some(e=>e.textContent==="Все задания выполнены · ждём завершения"));
  assert.ok(root.all().some(e=>e.textContent?.startsWith("Финишировали: 0 / 1")));
  act(r,role,"continue",{roundIndex:4});
  render();assert.ok(root.all().some(e=>e.textContent==="Итоговый рейтинг"));
  assert.ok(root.all().some(e=>e.textContent?.startsWith("Финишировали: 1 / 1")));
});

test("host ranking expands to every supported room size without mutating roster or promoting zero scores",async()=>{
  const {root,window}=await ui();
  for(let count=1;count<=8;count++) {
    const r=createRoom("123456",Date.now(),undefined,count);
    for(const team of r.teams)joinRoom(r,team.id,r.members[team.id].invite);
    act(r,"host","start");
    window.RoomUI.render(root,view(r,"host"),{act(){},redraw(){},invite(){},newGame(){}},{});
    const rows=root.all().find(e=>e.className==="host-ranking").children;
    assert.equal(rows.length,count);
    assert.deepEqual(rows.map(e=>e.dataset.team),r.teams.map(t=>t.id));
    assert.ok(rows.every(e=>!e.className.includes("--leader")));
  }
});

test("new host bank lists all possibilities and shows each team's own assigned questions, answers and progress",async()=>{
  const r=createDealtRoom("123456",Date.now(),undefined,8),{root,window}=await ui(r);
  const handlers={act(){},redraw(){},invite(){},newGame(){}};
  window.RoomUI.render(root,view(r,"host"),handlers,{});
  const bank=root.all().find(e=>e.id==="flow-task-bank");
  assert.ok(bank);assert.ok(bank.all().some(e=>e.textContent==="Банк заданий · 12"));
  assert.equal(bank.all().filter(e=>e.tagName==="li").length,12);
  assert.equal(bank.all().some(e=>e.textContent==="В резерве"),false);
  for(const task of view(r,"host").taskCatalog) {
    const item=bank.all().find(e=>e.tagName==="li"&&e.all().some(child=>child.textContent===task.prompt));
    assert.ok(item.all().some(e=>e.textContent==="Ответ: "+task.answer));
    assert.equal(item.all().some(e=>r.teams.some(team=>team.name===e.textContent)),false);
  }
  for(const team of r.teams)joinRoom(r,team.id,r.members[team.id].invite);
  act(r,"host","start");
  window.RoomUI.render(root,view(r,"host"),handlers,{});
  for(const team of r.teams) {
    const section=root.all().find(e=>e.id==="flow-review-"+team.id);
    for(const q of r.teamFlows[team.id][0].questions) {
      assert.ok(section.all().some(e=>e.textContent===q.prompt));
      assert.ok(section.all().some(e=>e.textContent==="Нет ответа ("+q.answers[0].variants[0]+")"));
    }
  }
  const role=r.teams[0].id,q=r.teamFlows[role][0].questions[0];
  act(r,role,"submitQuestions",{roundIndex:0,answers:{[q.id]:q.answers[0].variants[0]}});
  window.RoomUI.render(root,view(r,"host"),handlers,{});
  const row=root.all().find(e=>e.dataset.team===role);
  assert.equal(row.all().find(e=>e.tagName==="progress").value,1);
  assert.equal(view(r,role).run.summary.correct,1);
  window.RoomUI.render(root,view(r,role),handlers,{});
  assert.equal(root.all().some(e=>e.id==="flow-task-bank"),false);
  const groups=root.all().filter(e=>e.className==="flow-hint-group");
  assert.equal(groups.length,0);
  assert.equal("hints" in view(r,role),false);
});

test("Send answers accepts an empty form, displays final counts and removes editing controls",async()=>{
  const r=createDealtRoom("123456",Date.now(),undefined,1),role=r.teams[0].id,{root,window}=await ui(r);
  joinRoom(r,role,r.members[role].invite);act(r,"host","start");
  const handlers={invite(){},newGame(){},redraw:render,act(name,data){act(r,role,name,{roundIndex:r.runs[role].stageIndex,...data});render();}};
  function render(){window.RoomUI.render(root,view(r,role),handlers,{});}
  render();
  assert.equal(root.all().filter(e=>e.tagName==="textarea").length,6);
  assert.equal(root.all().filter(e=>e.attributes.role==="radiogroup").length,0);
  assert.equal(root.all().filter(e=>e.type==="radio").length,0);
  const send=root.all().find(e=>e.textContent==="Отправить ответы");
  assert.ok(send);assert.equal(send.disabled,false);
  assert.ok(root.all().some(e=>e.textContent==="Отправка завершает этап. Исправить ответы после отправки нельзя."));
  await send.click();
  assert.equal(root.all().some(e=>e.tagName==="textarea"||e.textContent==="Отправить ответы"),false);
  assert.ok(root.all().some(e=>e.textContent==="Правильно: 0 из 6"));
  assert.ok(root.all().some(e=>e.textContent==="Не засчитано: 6. Неверно: 0 · пропущено: 6."));
  assert.ok(root.all().some(e=>e.textContent==="Начислено при отправке: +0 очков."));
  assert.equal(root.all().some(e=>e.tagName==="video"),true);
  await root.all().find(e=>e.textContent==="К следующему этапу →").click();
  assert.ok(root.all().some(e=>e.textContent==="Проверить код"));
  const field=root.all().find(e=>e.className==="flow-code");
  field.value=r.teamFlows[role][1].code==="0000"?"0001":"0000";field.listeners.input();
  await root.all().find(e=>e.textContent==="Проверить код").click();
  assert.equal(r.runs[role].cleared,false);assert.equal(r.scores[role],0);
  assert.equal(root.all().some(e=>e.tagName==="video"),false);
  assert.equal(root.all().some(e=>e.textContent==="К следующему этапу →"),false);
  act(r,role,"submitCode",{roundIndex:1,code:r.teamFlows[role][1].code},r.runs[role].lastCodeAttempt+1000);
  render();
  assert.equal(root.all().some(e=>e.tagName==="video"),true);
  assert.ok(root.all().some(e=>e.textContent==="К следующему этапу →"));
});

test("typed answers persist across redraw and teams submit independently",async()=>{
  const r=createDealtRoom("123456",Date.now(),undefined,2),[first,second]=r.teams.map(team=>team.id),{root,window}=await ui(r),draft={};
  for(const role of [first,second])joinRoom(r,role,r.members[role].invite);
  let role=first;
  const handlers={invite(){},newGame(){},redraw:render,act(name,data){act(r,role,name,{roundIndex:r.runs[role].stageIndex,...data});render();}};
  function render(){window.RoomUI.render(root,view(r,role),handlers,draft);}
  render();
  const input=()=>root.all().find(e=>e.tagName==="textarea");
  assert.ok(input());input().value="  кНИГА! ";input().listeners.input();render();
  assert.equal(input().value,"  кНИГА! ");
  role=second;render();assert.equal(input().value,"");
  input().value="Телевизор";input().listeners.input();
  await root.all().find(e=>e.textContent==="Отправить ответы").click();
  assert.equal(view(r,second).run.summary.incorrect,1);assert.equal(view(r,second).run.summary.skipped,5);
  assert.equal(view(r,first).run.cleared,false);
  role=first;render();assert.equal(input().value,"  кНИГА! ");
  await root.all().find(e=>e.textContent==="Отправить ответы").click();
  assert.equal(view(r,first).run.summary.correct,1);assert.equal(view(r,first).run.summary.skipped,5);
  assert.equal(r.scores[first],100);assert.equal(r.scores[second],0);
});

test("timed code UI waits for teams, lets host set minutes, then accepts a blank answer",async()=>{
  const r=createTimedRoom("123456",Date.now(),undefined,2),[a,b]=r.teams.map(t=>t.id),{root,window}=await ui(r),draft={};
  for(const id of [a,b])joinRoom(r,id,r.members[id].invite);
  const send=(id,name,data={})=>act(r,id,name,{roundIndex:r.runs[id]?.stageIndex||0,...data});
  send(a,"finishQuestions",{answers:{}});send(a,"continue");
  let role="host";
  const handlers={invite(){},newGame(){},redraw:render,act(name,data){send(role,name,data);render();}};
  function render(){window.RoomUI.render(root,view(r,role),handlers,draft);}
  render();assert.equal(root.all().find(e=>e.textContent==="Запустить таймер").disabled,true);
  send(b,"finishQuestions",{answers:{}});send(b,"continue");render();
  const minutes=root.all().find(e=>e.id==="timer-minutes-1");minutes.value="3";minutes.listeners.input();
  await root.all().find(e=>e.textContent==="Запустить таймер").click();
  assert.equal(r.codeTimers[1].minutes,3);
  assert.equal(root.all().some(e=>e.textContent?.includes(r.teamFlows[a][1].code)),false);
  role=a;render();assert.equal(root.all().some(e=>e.textContent==="Отправить код"),false);
  r.codeTimers[1].endsAt=Date.now()-1;role="host";render();
  assert.ok(root.all().some(e=>e.textContent?.includes(r.teamFlows[a][1].code)));
  role=a;render();assert.ok(root.all().some(e=>e.textContent==="Отправить код"));
  await root.all().find(e=>e.textContent==="Отправить код").click();
  assert.equal(view(r,a).run.codeOutcome,"incorrect");assert.ok(root.all().some(e=>e.textContent==="К следующему этапу →"));
  assert.equal(root.all().some(e=>e.tagName==="video"),false);
});

test("client hint sections never render in lobby, play, submitted stages or finish, even with stale hint data",async()=>{
  const r=createDealtRoom("123456",Date.now(),undefined,1),role=r.teams[0].id,{root,window}=await ui(r);
  const render=()=>{
    const state=view(r,role);assert.equal("hints" in state,false);
    state.hints=[{id:"stale",title:"PRIVATE HINT",text:"PRIVATE HINT"}];
    window.RoomUI.render(root,state,{act(){},redraw(){},invite(){},newGame(){}},{});
    assert.equal(root.all().some(e=>e.textContent==="Мои подсказки"||e.textContent==="PRIVATE HINT"||e.className==="flow-hints"),false);
  };
  render();joinRoom(r,role,r.members[role].invite);act(r,"host","start");
  for(const [index,stage] of r.teamFlows[role].entries()) {
    render();
    if(stage.type==="code") {
      assert.ok(root.all().some(e=>e.textContent==="Получите кодовое слово у ведущего и введите его."));
      const input=root.all().find(e=>e.className==="flow-code");
      assert.equal(input.inputMode,"text");assert.equal(input.placeholder,"Слово от ведущего");
      assert.ok(root.all().some(e=>e.textContent==="Кодовое слово"));
    }
    act(r,role,stage.type==="questions"?"finishQuestions":"submitCode",{roundIndex:index,...(stage.type==="questions"?{answers:{}}:{code:stage.code})});
    render();act(r,role,"continue",{roundIndex:index});
  }
  render();assert.equal(r.phase,"finished");
});

test("one-slot creation and a separate team client complete real joining and answer/code actions without test UI",async()=>{
  const roomUI=await read("room-ui"),flowUI=await read("flow-ui"),client=await read("room-client");
  let room,posted;
  const actions=[];
  const fetch=async(path,options)=> {
    let data;
    if(path==="/api/config")data=flowConfig();
    else if(path==="/api/rooms"){posted=JSON.parse(options.body);room=createRoom("123456",Date.now(),undefined,posted.teamCount,{scoring:posted.scoring});data={code:room.code,role:"host",token:room.hostToken};}
    else if(path.endsWith("/join")){const body=JSON.parse(options.body);data=joinRoom(room,body.team,body.invite);}
    else {
      const role=authorize(room,options.headers.Authorization.slice(7));
      if(path.endsWith("/action")){const body=JSON.parse(options.body);assert.equal("asTeam" in body,false);actions.push({role,action:body.action});dispatch(room,role,body.action,body);}
      data=view(room,role);
    }
    return {ok:true,status:200,json:async()=>data};
  };
  async function browser(search="",saved) {
    const root=new Element(),ids=new Map(["room-app","room-message","room-code","room-role","room-reward","leave-room","invite-dialog","invite-image","invite-loading","invite-title","invite-link","copy-invite"].map(id=>[id,id==="room-app"?root:new Element()]));
    const store=new Map(saved);
    const document={hidden:false,createElement:t=>new Element(t),addEventListener(){},getElementById:id=>ids.get(id)||root.all().find(e=>e.id===id)};
    const window={confirm:()=>true,matchMedia:()=>({matches:true}),location:{search,origin:"http://test.local"},history:{replaceState(){}},setTimeout:()=>1,clearTimeout(){},
      localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}};
    const context=vm.createContext({window,document,fetch,URL,URLSearchParams,AbortController});
    vm.runInContext(roomUI,context);vm.runInContext(flowUI,context);await vm.runInContext(client,context);
    return {root,document,window,store};
  }
  const host=await browser();
  const picker=host.document.getElementById("room-size");
  assert.deepEqual(picker.children.map(e=>e.value),["1","2","3","4","5","6","7","8"]);
  picker.value="1";host.document.getElementById("setup-score-answer").value="175";
  await host.root.all().find(e=>e.textContent==="Создать игру ведущего").click();
  assert.equal(posted.teamCount,1);assert.equal(posted.scoring.answer,175);
  assert.equal(host.root.all().some(e=>e.type==="checkbox"),false);
  assert.equal(host.root.all().some(e=>e.textContent==="Все в сборе — начать"),false);
  assert.ok(host.root.all().some(e=>e.textContent==="Игра начнётся автоматически, когда подключатся все участвующие команды. Активных слотов: 1."));
  const a=room.teams[0];
  const team=await browser("?room="+room.code+"&team="+a.id+"&invite="+room.members[a.id].invite);
  assert.equal(JSON.parse(team.store.get("halloween-room-session-v1")).role,a.id);
  // Refresh the host's state through an ordinary host action, as polling does in a browser.
  await host.root.all().find(e=>e.textContent==="Сохранить очки").click();
  assert.equal(host.root.all().some(e=>e.textContent==="Все в сборе — начать"),false);
  assert.ok(team.root.all().some(e=>e.tagName==="textarea"));
  assert.equal(actions.some(e=>e.action==="start"),false);
  assert.equal(room.phase,"playing");
  // Reopening this team's saved session must retain its own role.
  team.window.RoomUI.render(team.root,view(room,a.id),{act(){},redraw(){},invite(){},newGame(){}},{});
  assert.equal(team.root.all().some(e=>e.textContent==="Поблагодарить за подсказку"),false);
  // Reopening the client retains the automatically started game.
  const playing=await browser("?room="+room.code,team.store);
  const inputs=playing.root.all().filter(e=>e.tagName==="textarea");
  inputs[0].value="сова";inputs[0].listeners.input();inputs[1].value="свеча\nфонарь";inputs[1].listeners.input();
  await playing.root.all().find(e=>e.textContent==="Отправить ответы").click();
  await playing.root.all().find(e=>e.textContent==="К следующему этапу →").click();
  const code=playing.root.all().find(e=>e.className==="flow-code");code.value="1310";code.listeners.input();
  await playing.root.all().find(e=>e.textContent==="Проверить код").click();
  assert.equal(room.runs[a.id].cleared,true);
  assert.ok(actions.some(e=>e.role===a.id&&e.action==="submitCode"));
  assert.equal(actions.some(e=>e.action==="setTestMode"),false);
  for(let index=2;index<=3;index++) {
    await playing.root.all().find(e=>e.textContent==="К следующему этапу →").click();
    const field=playing.root.all().find(e=>e.className==="flow-code");
    field.value=room.flow[index].code;field.listeners.input();
    await playing.root.all().find(e=>e.textContent==="Проверить код").click();
  }
  await playing.root.all().find(e=>e.textContent==="К следующему этапу →").click();
  const finalInputs=playing.root.all().filter(e=>e.tagName==="textarea");
  assert.equal(finalInputs.length,4);
  finalInputs.forEach((input,index)=>{input.value=room.flow[4].questions[index].answers[0].variants[0];input.listeners.input();});
  await playing.root.all().find(e=>e.textContent==="Отправить ответы").click();
  while(playing.root.all().some(e=>e.textContent==="Следующий ролик →"))await playing.root.all().find(e=>e.textContent==="Следующий ролик →").click();
  await playing.root.all().find(e=>e.textContent==="Завершить игру").click();
  assert.equal(room.phase,"finished");
  assert.ok(playing.root.all().some(e=>e.textContent==="Игра завершена!"));
});

test("story context and character labels precede questions, solutions render only after final submission",async()=>{
  const r=createDealtRoom("123456",Date.now(),undefined,1),role=r.teams[0].id,{root,window}=await ui(r);
  joinRoom(r,role,r.members[role].invite);act(r,"host","start");
  const handlers={act(){},redraw(){},invite(){},newGame(){}};
  const render=()=>window.RoomUI.render(root,view(r,role),handlers,{});
  render();
  assert.ok(root.all().some(e=>e.className==="flow-story"&&e.textContent===r.teamFlows[role][0].story));
  assert.equal(root.all().filter(e=>e.className==="flow-scene-title").length,4);
  assert.equal(root.all().some(e=>e.textContent==="Разбор загадок"),false);
  act(r,role,"finishQuestions",{roundIndex:0,answers:{}});
  render();
  assert.ok(root.all().some(e=>e.textContent==="Разбор загадок"));
  const resolution=root.all().find(e=>e.id==="flow-resolution-welcome");
  for(const q of r.teamFlows[role][0].questions)assert.ok(resolution.all().some(e=>e.textContent===q.explanation));
  assert.ok(root.all().some(e=>e.className==="flow-story"&&e.textContent===r.teamFlows[role][0].epilogue));
  assert.equal(root.all().some(e=>e.tagName==="textarea"),false);
});

test("existing reward-first rooms still place videos after results",async()=>{
  for(const blank of [false,true]) {
    const r=createDealtRoom("123456",Date.now(),undefined,1),role=r.teams[0].id,{root,window}=await ui(r);
    for(const stage of r.teamFlows[role])delete stage.videoTiming;
    for(const q of r.teamFlows[role][0].questions)q.videoId=1;
    joinRoom(r,role,r.members[role].invite);
    const handlers={act(){},redraw(){},invite(){},newGame(){}},draft={};
    for(const [index,stage] of r.teamFlows[role].entries()) {
      act(r,role,stage.type==="code"?"submitCode":"finishQuestions",{roundIndex:index,...(stage.type==="code"?{code:stage.code}:{answers:blank?{}:Object.fromEntries(stage.questions.map(q=>[q.id,q.answers[0].variants[0]]))})});
      window.RoomUI.render(root,view(r,role),handlers,draft);
      const elements=root.all(),video=elements.findIndex(e=>e.tagName==="video");
      const result=elements.findIndex(e=>e.className===(stage.type==="questions"?"flow-results":"room-success"));
      const label=index===r.teamFlows[role].length-1?"Следующий ролик →":"К следующему этапу →";
      const next=elements.findIndex(e=>e.textContent===label);
      assert.ok(result>=0&&video>result&&next>video);
      const panel=elements.find(e=>e.className==="room-panel");
      const wrapper=panel.children.findIndex(e=>e.className==="flow-video-wrap");
      assert.equal(panel.children[wrapper+1].textContent,label);
      act(r,role,"continue",{roundIndex:index});
    }
  }
});

test("both video layouts use natural height and fit the entire frame instead of a square crop",async()=>{
  const css=await readFile(new URL("../dist/assets/styles.css",import.meta.url),"utf8");
  for(const selector of [".flow-video",".task-video"]) {
    const rule=css.slice(css.indexOf(selector+" {")).split("}")[0];
    assert.match(rule,/width: 100%/);assert.match(rule,/height: auto/);
    assert.match(rule,/object-fit: contain/);
    assert.doesNotMatch(rule,/aspect-ratio: 1|height: clamp|object-fit: cover/);
  }
  assert.doesNotMatch(await read("task-page"),/task.videoAspect/);
});

test("new rooms show all eight videos after stage completion",async()=>{
  const r=createDealtRoom("123456",Date.now(),undefined,1),role=r.teams[0].id,{root,window}=await ui(r),draft={},seen=[];
  joinRoom(r,role,r.members[role].invite);
  const render=()=>window.RoomUI.render(root,view(r,role),handlers,draft);
  const handlers={act(){},redraw:render,invite(){},newGame(){}};
  for(const [index,stage] of r.teamFlows[role].entries()) {
    render();
    assert.equal(root.all().filter(e=>e.tagName==="video").length,0);
    act(r,role,stage.type==="code"?"submitCode":"finishQuestions",{roundIndex:index,...(stage.type==="code"?{code:stage.code}:{answers:{}})});
    render();
    const videoIds=view(r,role).run.stageVideos;
    for(const id of videoIds) {
      const title=(window.HALLOWEEN_MEDIA||[]).find(m=>m.id===id)?.title;
      if(videoIds.length>1)await root.all().find(e=>e.tagName==="button"&&e.textContent===title).click();
      const video=root.all().find(e=>e.tagName==="video");
      assert.equal(video.src,"quest-"+id+".mp4");assert.equal(video.loop,false);assert.equal(video.muted,false);seen.push(id);
      render();assert.equal(root.all().find(e=>e.tagName==="video"),video);
    }
    assert.ok(root.all().some(e=>e.textContent===(index===4?"Завершить игру":"К следующему этапу →")));
    act(r,role,"continue",{roundIndex:index});
  }
  assert.deepEqual(seen,[1,2,3,4,5,6,7,8]);
  assert.deepEqual([...new Set(seen)],[1,2,3,4,5,6,7,8]);
});

test("legacy preview videos retain playback on polling and only one may play at a time",async()=>{
  const r=createDealtRoom("123456",Date.now(),undefined,1),role=r.teams[0].id,{root,window}=await ui(r),draft={};
  joinRoom(r,role,r.members[role].invite);
  for(let index=0;index<4;index++) {
    const stage=r.teamFlows[role][index];
    act(r,role,stage.type==="code"?"submitCode":"finishQuestions",{roundIndex:index,...(stage.type==="code"?{code:stage.code}:{answers:{}})});
    act(r,role,"continue",{roundIndex:index});
  }
  r.teamFlows[role][4].videoTiming="before-task";
  const render=()=>window.RoomUI.render(root,view(r,role),{act(){},redraw:render,invite(){},newGame(){}},draft);
  render();const videos=root.all().filter(e=>e.tagName==="video");
  assert.equal(videos.length,4);assert.ok(videos.slice(1).every(v=>v.autoplay===false));
  await videos[0].play();await videos[2].play();
  assert.equal(videos[0].paused,true);assert.equal(videos[2].paused,false);
  render();assert.equal(root.all().filter(e=>e.tagName==="video")[2],videos[2]);assert.equal(videos[2].paused,false);
  window.FlowUI.stopMedia();assert.ok(videos.every(v=>v.paused));
});

test("existing reward-first rooms cannot skip unseen final clips",async()=>{
  const r=createDealtRoom("123456",Date.now(),undefined,1),role=r.teams[0].id,{root,window}=await ui(r),draft={};
  for(const stage of r.teamFlows[role])delete stage.videoTiming;
  joinRoom(r,role,r.members[role].invite);
  for(const [index,stage] of r.teamFlows[role].entries()) {
    act(r,role,stage.type==="code"?"submitCode":"finishQuestions",{roundIndex:index,...(stage.type==="code"?{code:stage.code}:{answers:{}})});
    if(index<4)act(r,role,"continue",{roundIndex:index});
  }
  const render=()=>window.RoomUI.render(root,view(r,role),handlers,draft);
  const handlers={act(){},redraw:render,invite(){},newGame(){}};
  render();await root.all().find(e=>e.textContent==="Ролик 8").click();
  assert.equal(root.all().some(e=>e.textContent==="Завершить игру"),false);
  await root.all().find(e=>e.textContent==="Следующий ролик →").click();
  assert.equal(root.all().find(e=>e.tagName==="video").src,"quest-6.mp4");
  await root.all().find(e=>e.textContent==="Следующий ролик →").click();
  assert.equal(root.all().find(e=>e.tagName==="video").src,"quest-7.mp4");
  assert.ok(root.all().some(e=>e.textContent==="Завершить игру"));
});

test("waiting teams automatically receive the shared final videos and ranking after the last team finishes",async()=>{
  const r=createDealtRoom("123456",Date.now(),undefined,2),[first,last]=r.teams.map(t=>t.id),{root,window}=await ui(r);
  for(const t of r.teams)joinRoom(r,t.id,r.members[t.id].invite);
  const finish=role=>{
    for(const [index,stage] of r.teamFlows[role].entries()) {
      act(r,role,stage.type==="code"?"submitCode":"finishQuestions",{roundIndex:index,...(stage.type==="code"?{code:stage.code}:{answers:{}})});
      act(r,role,"continue",{roundIndex:index});
    }
  };
  finish(first);
  const draft={},handlers={act(){},redraw:render,invite(){throw Error("Final ranking must not expose invites to teams");},newGame(){}};
  let role=first;
  function render(){window.RoomUI.render(root,view(r,role),handlers,draft);}
  render();
  assert.ok(root.all().some(e=>e.textContent?.includes("Ждём остальные команды")));
  assert.equal(root.all().some(e=>e.textContent==="Итоговый рейтинг"),false);
  finish(last);
  for(role of ["host",first,last]) {
    render();
    assert.ok(root.all().some(e=>e.textContent==="Игра завершена!"));
    assert.ok(root.all().some(e=>e.textContent==="Финальные ролики"));
    const ranking=root.all().find(e=>e.className==="host-ranking");
    assert.equal(ranking.children.length,2);
    assert.deepEqual(ranking.children.map(e=>e.dataset.rank),["1","1"]);
    assert.equal(root.all().some(e=>e.className==="flow-team-review"||e.className==="flow-question"),false);
    assert.equal(root.all().some(e=>e.textContent==="Новая игра"),role==="host");
  }
  role=first;render();
  assert.equal(root.all().find(e=>e.tagName==="video").src,"quest-5.mp4");
  await root.all().find(e=>e.textContent==="Все ролики игры · 8").click();
  assert.equal(root.all().find(e=>e.tagName==="video").src,"quest-1.mp4");
  for(let id=1;id<=8;id++)assert.ok(root.all().some(e=>e.textContent==="Ролик "+id));
});

test("all eight team portraits use the matching existing artwork in lobby, play, rewards and final ranking",async()=>{
  const r=createDealtRoom("123456",Date.now(),undefined,8),{root,window}=await ui(r);
  const handlers={act(){},redraw(){},invite(){},newGame(){}};
  const render=role=>window.RoomUI.render(root,view(r,role),handlers,{});
  render("host");
  assert.equal(root.all().filter(e=>e.className==="invite-card").length,8);
  for(const [index,team] of r.teams.entries()) {
    assert.equal(team.artId,TEAM_ART[team.id]);
    const card=root.all().filter(e=>e.className==="invite-card")[index];
    const image=card.all().find(e=>e.tagName==="img");
    assert.equal(image.src,"art-"+TEAM_ART[team.id]+".webp");assert.equal(image.alt,"");
    assert.equal(image.attributes["aria-hidden"],"true");
    joinRoom(r,team.id,r.members[team.id].invite);
  }
  render("host");
  for(const row of root.all().find(e=>e.className==="host-ranking").children)assert.equal(row.all().find(e=>e.tagName==="img").src,"art-"+TEAM_ART[row.dataset.team]+".webp");
  const first=r.teams[0].id;render(first);
  assert.equal(root.all().find(e=>e.className==="room-roster").all().filter(e=>e.tagName==="img").length,8);
  const toast=new Element();
  window.RoomUI.showReward(toast,[{team:first,points:100,label:"Ответ",id:1}],view(r,first).teams,first);
  assert.equal(toast.all().find(e=>e.tagName==="img").src,"art-6.webp");
  for(const team of r.teams) {
    for(const [index,stage] of r.teamFlows[team.id].entries()) {
      act(r,team.id,stage.type==="code"?"submitCode":"finishQuestions",{roundIndex:index,...(stage.type==="code"?{code:stage.code}:{answers:{}})});
      act(r,team.id,"continue",{roundIndex:index});
    }
    if(team.id===first) {
      render(first);assert.equal(root.all().find(e=>e.className==="room-end-art").src,"art-6.webp");
    }
  }
  for(const role of ["host",...r.teams.map(t=>t.id)]) {
    render(role);
    const rows=root.all().find(e=>e.className==="host-ranking").children;
    for(const row of rows)assert.equal(row.all().find(e=>e.tagName==="img").src,"art-"+TEAM_ART[row.dataset.team]+".webp");
    assert.equal(root.all().some(e=>/[🎃🦇👻🪄🕯👁🔮🔑]/u.test(e.textContent||"")),false);
  }
});

test("already-created rooms without artId still resolve all portraits through media metadata",async()=>{
  const {window}=await ui();
  for(const [id,artId] of Object.entries(TEAM_ART)) {
    const image=window.RoomUI.teamArt({id,name:"Команда",icon:"🎃"});
    assert.equal(image.tagName,"img");assert.equal(image.src,"art-"+artId+".webp");
  }
  assert.equal(window.RoomUI.teamArt({id:"unknown",name:"Новая команда"}).textContent,"Н");
});

test("host can withdraw a slot with confirmation and its paused phone loses all action controls",async()=>{
  const r=createDealtRoom("123456",Date.now(),undefined,2),[a,b]=r.teams.map(t=>t.id),{root,window}=await ui(r);
  const render=role=>window.RoomUI.render(root,view(r,role),handlers,{});
  const handlers={act(name,data){dispatch(r,"host",name,data);render("host");},redraw(){},invite(){},newGame(){}};
  render("host");window.confirm=()=>false;
  await root.all().find(e=>e.textContent==="Отключить участие").click();
  assert.equal(r.members[a].active,undefined);
  window.confirm=()=>true;await root.all().find(e=>e.textContent==="Отключить участие").click();
  assert.equal(r.members[a].active,false);
  assert.ok(root.all().find(e=>e.textContent==="Отключить участие").disabled);
  render(a);assert.ok(root.all().some(e=>e.textContent==="Участие команды приостановлено"));
  assert.equal(root.all().some(e=>e.tagName==="textarea"||e.textContent==="Отправить ответы"),false);
  joinRoom(r,b,r.members[b].invite);render("host");
  assert.equal(r.phase,"playing");
  const row=root.all().find(e=>e.dataset.team===a);
  assert.equal(row.dataset.rank,"0");
  assert.ok(row.all().some(e=>e.textContent==="Не участвует · очки сохранены"));
  await root.all().find(e=>e.textContent==="Завершить с итогами").click();
  assert.equal(r.phase,"finished");
  render(a);assert.ok(root.all().some(e=>e.textContent==="Итоговый рейтинг"));
  assert.ok(root.all().some(e=>e.textContent==="Финишировали: 0 / 1"));
  const inactive=root.all().find(e=>e.dataset.team===a);
  assert.ok(inactive.all().some(e=>e.className==="host-rank-place"&&e.textContent==="—"));
  assert.equal(root.all().some(e=>e.textContent==="Завершить с итогами"),false);
});

test("leaving the game pauses its detached video and discards the media cache",async()=>{
  const r=createDealtRoom("123456",Date.now(),undefined,1),id=r.teams[0].id,{root,window}=await ui(r);
  joinRoom(r,id,r.members[id].invite);
  act(r,id,"finishQuestions",{roundIndex:0,answers:{}});
  const render=()=>window.RoomUI.render(root,view(r,id),{act(){},redraw(){},invite(){},newGame(){}},{});
  render();const video=root.all().find(e=>e.tagName==="video");await video.play();
  window.FlowUI.stopMedia();assert.equal(video.paused,true);
  render();assert.notEqual(root.all().find(e=>e.tagName==="video"),video);
});
