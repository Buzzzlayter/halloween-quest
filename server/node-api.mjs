import {randomInt} from "node:crypto";
import qrcode from "qrcode-generator";
import {GameError, createRoom, validateTeamCount, validateScoring, flowConfig, joinRoom, authorize, dispatch, view} from "./game-engine.mjs";
import {teamsFor} from "./room-scenario.mjs";

const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{
  "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"
}});
async function readJson(request) {
  if (!request.body) return {};
  const reader=request.body.getReader(), chunks=[];let size=0;
  while (true) {
    const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>32768){await reader.cancel();throw new GameError("Слишком большой запрос.",413);}
    chunks.push(value);
  }
  try {
    const data=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(!data||typeof data!=="object"||Array.isArray(data))throw Error();
    return data;
  }catch{throw new GameError("Не удалось прочитать запрос.",400);}
}

export function createGameApi({store, clock=Date.now, pickCode=()=>String(randomInt(100000,1000000))}) {
  // All processes read the database. No room/score cache is authoritative.
  async function load(code) {
    const row=await store.get(code);
    if(!row)throw new GameError("Комната не найдена. Попросите новый QR у ведущего.",404);
    if(clock()>row.snapshot.expiresAt)throw new GameError("Время комнаты истекло. Создайте новую игру.",410);
    return row;
  }
  async function update(code, mutate) {
    for(let attempt=0;attempt<12;attempt++) {
      const {revision,snapshot}=await load(code),next=structuredClone(snapshot);
      const result=mutate(next);
      // Atomic revision check prevents lost joins and duplicate score awards
      // across replicas, cold starts and requests arriving at the same time.
      if(await store.compareAndSwap(code,revision,next))return result;
    }
    throw new GameError("Комната сейчас обновляется. Повторите действие через секунду.",409);
  }
  return async request=>{
    try {
      const url=new URL(request.url),token=request.headers.get("Authorization")?.replace(/^Bearer /,"");
      if(request.method==="POST"&&request.headers.has("Origin")&&request.headers.get("Origin")!==url.origin)
        throw new GameError("Откройте игру на её основном сайте.",403);
      if(url.pathname==="/api/health"&&request.method==="GET")
        return json({ok:true,game:"quest-flow-v2",runtime:"node",storage:store.kind||"custom",legacyRooms:true});
      if(url.pathname==="/api/config"&&request.method==="GET")return json(flowConfig());
      if(url.pathname==="/api/rooms"&&request.method==="POST") {
        const data=await readJson(request),count=validateTeamCount(data.teamCount),scoring=validateScoring(data.scoring);
        await store.removeExpired(clock());
        for(let attempt=0;attempt<5;attempt++) {
          const room=createRoom(pickCode(),clock(),undefined,count,{scoring});
          if(await store.insert(room))return json({code:room.code,role:"host",token:room.hostToken});
        }
        throw new GameError("Не удалось создать комнату. Попробуйте ещё раз.",503);
      }
      const match=url.pathname.match(/^\/api\/rooms\/(\d{6})\/(state|join|action|qr\/([a-z][a-z0-9-]{0,63}))$/);
      if(!match)throw new GameError("Адрес игры не найден.",404);
      const [,code,command,team]=match;
      if(command==="join"&&request.method==="POST") {
        const data=await readJson(request);
        return json(await update(code,room=>joinRoom(room,data.team,data.invite,clock())));
      }
      if(command==="action"&&request.method==="POST") {
        const data=await readJson(request);
        return json(await update(code,room=>{
          const role=authorize(room,token);
          dispatch(room,role,data.action,data,clock());return view(room,role);
        }));
      }
      const {snapshot:room}=await load(code),role=authorize(room,token);
      if(command==="state"&&request.method==="GET")return json(view(room,role));
      if(team&&request.method==="GET") {
        if(role!=="host")throw new GameError("QR-приглашения открывает ведущий.",403);
        if(!teamsFor(room).some(t=>t.id===team))throw new GameError("Команда не найдена в этой комнате.",404);
        const target=new URL("/play.html",url.origin);
        target.searchParams.set("room",code);target.searchParams.set("team",team);target.searchParams.set("invite",room.members[team].invite);
        const qr=qrcode(0,"M");qr.addData(target.href);qr.make();
        return new Response(qr.createSvgTag({cellSize:8,margin:32,scalable:true}),{headers:{
          "Content-Type":"image/svg+xml", "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"
        }});
      }
      throw new GameError("Действие не найдено.",404);
    }catch(error) {
      if(error instanceof GameError)return json({error:error.message},error.status);
      // Don't log request bodies, tokens or third-party errors containing secrets.
      return json({error:"Не удалось обновить игру. Попробуйте ещё раз."},500);
    }
  };
}
