import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
import {createRoom,joinRoom,view,flowConfig} from "../server/game-engine.mjs";

class Element {
  constructor(tag="div"){this.tagName=tag;this.children=[];this.listeners={};this.attributes={};this.dataset={};this.style={setProperty(){}};this.classList={add(){},remove(){}};}
  append(...els){this.children.push(...els);}replaceChildren(...els){this.children=els;}
  setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];delete this[k];}
  addEventListener(k,v){this.listeners[k]=v;}
  all(){return [this,...this.children.flatMap(e=>e.all())];}
  async click(){if(!this.disabled)return this.listeners.click?.();}
  showModal(){this.open=true;}close(){if(this.open){this.open=false;this.listeners.close?.();}}
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const json=data=>({ok:true,status:200,json:async()=>data});
async function browser(r,role,intercept) {
  const root=new Element(),nodes=new Map(["room-app","room-message","room-code","room-role","room-reward","leave-room","invite-dialog","invite-image","invite-loading","invite-title","invite-link","copy-invite"].map(id=>[id,id==="room-app"?root:new Element()]));
  const saved={code:r.code,role,token:role==="host"?r.hostToken:r.members[role].token},store=new Map([["halloween-room-session-v1",JSON.stringify(saved)]]);
  const document={createElement:t=>new Element(t),getElementById:id=>nodes.get(id)||root.all().find(e=>e.id===id),addEventListener(){}};
  const window={location:{search:"?room="+r.code,origin:"https://test.local"},history:{replaceState(){}},confirm:()=>true,matchMedia:()=>({matches:true}),
    setTimeout:()=>1,clearTimeout(){},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}};
  const fetch=(path,options)=>{
    const pending=intercept(path,options);if(pending)return pending;
    return Promise.resolve(json(path==="/api/config"?flowConfig():view(r,role)));
  };
  const urls={revoked:[],createObjectURL:()=>"blob:qr",revokeObjectURL:value=>urls.revoked.push(value)};
  const context=vm.createContext({window,document,fetch,URL:class extends URL{static createObjectURL=urls.createObjectURL;static revokeObjectURL=urls.revokeObjectURL;},URLSearchParams,AbortController});
  for(const name of ["room-ui","flow-ui","room-client"])await vm.runInContext(await readFile(new URL("../dist/assets/"+name+".js",import.meta.url),"utf8"),context);
  return {root,nodes,store,window,urls};
}

test("an action resolving or failing after leaving cannot redraw the old room or its error",async()=>{
  for(const fail of [false,true]) {
    const r=createRoom("123456",Date.now(),undefined,1),id=r.teams[0].id;joinRoom(r,id,r.members[id].invite);
    const response=deferred(),b=await browser(r,id,path=>path.endsWith("/action")?response.promise:null);
    const pending=b.root.all().find(e=>e.textContent==="Отправить ответы").click();
    await b.nodes.get("leave-room").click();
    assert.ok(b.root.all().some(e=>e.textContent==="Тайна погасшего фонаря"));
    if(fail)response.reject(Error("STALE ERROR"));else response.resolve(json(view(r,id)));
    await pending;
    assert.equal(b.store.has("halloween-room-session-v1"),false);
    assert.ok(b.root.all().some(e=>e.textContent==="Тайна погасшего фонаря"));
    assert.equal(b.root.all().some(e=>e.tagName==="textarea"),false);
    assert.notEqual(b.nodes.get("room-message").textContent,"STALE ERROR");
    assert.equal(b.nodes.get("leave-room").hidden,true);
  }
});

test("switching QR hides and clears the old image until the correct response arrives; leaving cancels it",async()=>{
  const r=createRoom("123456",Date.now(),undefined,2),requests=[];
  const b=await browser(r,"host",path=>{if(!path.includes("/qr/"))return;const d=deferred();requests.push(d);return d.promise;});
  const buttons=b.root.all().filter(e=>e.textContent==="Показать QR"),image=b.nodes.get("invite-image");
  const first=buttons[0].click();requests[0].resolve({ok:true,blob:async()=>({})});await first;
  assert.equal(image.src,"blob:qr");assert.equal(image.hidden,false);
  const second=buttons[1].click();assert.equal(image.hidden,true);assert.equal(image.src,undefined);
  assert.equal(b.nodes.get("invite-title").textContent,r.teams[1].name);
  assert.deepEqual(b.urls.revoked,["blob:qr"]);
  await b.nodes.get("leave-room").click();assert.equal(b.nodes.get("invite-dialog").open,false);
  requests[1].resolve({ok:true,blob:async()=>({})});await second;
  assert.equal(image.hidden,true);assert.equal(image.src,undefined);
  const css=await readFile(new URL("../dist/assets/styles.css",import.meta.url),"utf8");
  assert.match(css,/\.quest-qr-dialog > img\[hidden\]\s*\{\s*display: none;/);
});

test("a room creation finishing after leaving cannot reconnect the phone against its new screen",async()=>{
  const r=createRoom("123456",Date.now(),undefined,1),id=r.teams[0].id;joinRoom(r,id,r.members[id].invite);
  const {dispatch}=await import("../server/game-engine.mjs");dispatch(r,"host","finishGame");
  const creation=deferred(),b=await browser(r,"host",path=>path==="/api/rooms"?creation.promise:null);
  await b.root.all().find(e=>e.textContent==="Новая игра").click();
  const pending=b.root.all().find(e=>e.textContent==="Создать игру ведущего").click();
  await b.nodes.get("leave-room").click();
  creation.resolve(json({code:"654321",role:"host",token:"another-room-token"}));await pending;
  assert.equal(b.store.has("halloween-room-session-v1"),false);
  assert.ok(b.root.all().some(e=>e.textContent==="Тайна погасшего фонаря"));
  assert.equal(b.nodes.get("room-code").textContent,"");
});
