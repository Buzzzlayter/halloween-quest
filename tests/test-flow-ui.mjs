import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {createRoom,joinRoom,act,dispatch,view,flowConfig,authorize} from "../server/game-engine.mjs";
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
  const root=new Element(),window={confirm:()=>true,matchMedia:()=>({matches:true}),HALLOWEEN_MEDIA:Array.from({length:8},(_,i)=>({id:i+1,video:"quest-"+(i+1)+".mp4",poster:"poster.png",title:"Ролик"}))};
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
  await root.all().find(e=>e.textContent==="Проверить ответы").click();
  assert.equal(lastAction,"submitQuestions");
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
  assert.ok(root.all().some(e=>e.textContent==="Мои подсказки"));
  assert.ok(root.all().findIndex(e=>e.textContent==="К следующему этапу →")<root.all().findIndex(e=>e.tagName==="video"));
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
  assert.match(fields[1].placeholder,/через запятую/);
});
test("thanks UI credits another team, replaces the button after use, and host sees relevant counts",async()=>{
  const r=start(),a=r.teams[0].id,b=r.teams[1].id,{root,window}=await ui(r),draft={};
  const render=()=>window.RoomUI.render(root,view(r,a),handlers,draft);
  const handlers={redraw:render,invite(){},newGame(){},act(name,data){act(r,a,name,{roundIndex:0,...data});render();}};
  render();const helper=r.teams[1];
  await root.all().find(e=>e.textContent===helper.icon+" "+helper.name+" +100").click();
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
  act(r,role,"continue",{roundIndex:4});
  assert.ok(renderHost().some(e=>e.textContent==="зелье (зелье)"));
  checkTeam();
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
  assert.equal(host.root.all().find(e=>e.textContent==="Все в сборе — начать").disabled,true);
  const a=room.teams[0];
  const team=await browser("?room="+room.code+"&team="+a.id+"&invite="+room.members[a.id].invite);
  assert.equal(JSON.parse(team.store.get("halloween-room-session-v1")).role,a.id);
  // Refresh the host's state through an ordinary host action, as polling does in a browser.
  await host.root.all().find(e=>e.textContent==="Сохранить очки").click();
  await host.root.all().find(e=>e.textContent==="Все в сборе — начать").click();
  assert.equal(room.phase,"playing");
  // Reopening this team's saved session must retain its own role.
  team.window.RoomUI.render(team.root,view(room,a.id),{act(){},redraw(){},invite(){},newGame(){}},{});
  assert.equal(team.root.all().some(e=>e.textContent==="Поблагодарить за подсказку"),false);
  // Reload the client on its team URL to pick up the host's start (normal polling on phones).
  const playing=await browser("?room="+room.code,team.store);
  const inputs=playing.root.all().filter(e=>e.tagName==="textarea");
  inputs[0].value="сова";inputs[0].listeners.input();inputs[1].value="свеча\nфонарь";inputs[1].listeners.input();
  await playing.root.all().find(e=>e.textContent==="Проверить ответы").click();
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
  await playing.root.all().find(e=>e.textContent==="Проверить ответы").click();
  await playing.root.all().find(e=>e.textContent==="Завершить игру").click();
  assert.equal(room.phase,"finished");
  assert.ok(playing.root.all().some(e=>e.textContent==="Ваша команда завершила игру!"));
});
