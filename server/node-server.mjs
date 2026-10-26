import http from "node:http";
import {createReadStream} from "node:fs";
import {stat} from "node:fs/promises";
import {fileURLToPath,pathToFileURL} from "node:url";
import path from "node:path";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {createGzip} from "node:zlib";
import qrcode from "qrcode-generator";
import {createGameApi} from "./node-api.mjs";
import {SqliteRoomStore} from "./sqlite-store.mjs";
import {homedir} from "node:os";

const defaultDir=fileURLToPath(new URL("../publish/",import.meta.url));
const types={".html":"text/html; charset=utf-8",".mp4":"video/mp4",".svg":"image/svg+xml"};
export function parseRange(header,size) {
  if(!header)return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!match||(!match[1]&&!match[2])||!size)return false;
  let start,end;
  if(!match[1]){const count=Number(match[2]);if(!Number.isSafeInteger(count)||count<=0)return false;start=Math.max(0,size-count);end=size-1;}
  else {start=Number(match[1]);end=match[2]?Number(match[2]):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||start>end)return false;
  return {start,end:Math.min(end,size-1)};
}
export function createQuestServer({store,publicDir=defaultDir,publicOrigin,production=false,clock}={}) {
  if(!store)throw Error("Room store is required; in-memory production storage is not supported.");
  if(publicOrigin) {
    const configured=new URL(publicOrigin);
    if(configured.username||configured.password||configured.pathname!=="/"||configured.search||configured.hash||!["http:","https:"].includes(configured.protocol))
      throw Error("PUBLIC_ORIGIN должен содержать только адрес сайта без пути.");
    if(production&&configured.protocol!=="https:")throw Error("Для PUBLIC_ORIGIN в production нужен HTTPS.");
    publicOrigin=configured.origin;
  }
  publicDir=path.resolve(publicDir);
  const api=createGameApi({store,...(clock?{clock}:{})});
  return http.createServer({requestTimeout:20000,headersTimeout:10000},async(req,res)=>{
    res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Referrer-Policy","no-referrer");res.setHeader("X-Frame-Options","DENY");
    try {
      // Use the configured external origin; never trust arbitrary forwarded hosts.
      const origin=publicOrigin||new URL((production?"https://":"http://")+(req.headers.host||"localhost")).origin;
      const target=new URL(req.url,origin);
      if(target.origin!==origin){res.writeHead(400);res.end();return;}
      if(target.pathname==="/healthz"&&["GET","HEAD"].includes(req.method)) {
        try {await store.check();res.writeHead(200,{"Cache-Control":"no-store"});res.end(req.method==="HEAD"?undefined:"ok");}
        catch {res.writeHead(503,{"Cache-Control":"no-store"});res.end("Database is not ready");}return;
      }
      if(target.pathname.startsWith("/api/")) {
        const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(", "):value);
        const request=new Request(target,{method:req.method,headers,...(["GET","HEAD"].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:"half"})});
        const response=await api(request);res.writeHead(response.status,Object.fromEntries(response.headers));
        if(response.body&&req.method!=="HEAD")await pipeline(Readable.fromWeb(response.body),res);else res.end();return;
      }
      if(!["GET","HEAD"].includes(req.method)){res.writeHead(405,{Allow:"GET, HEAD"});res.end();return;}
      let decoded;try{decoded=decodeURIComponent(target.pathname);}catch{res.writeHead(400);res.end();return;}
      if(decoded.includes("\\")||decoded.includes("\0")||decoded.split("/").some(p=>p.startsWith("."))){res.writeHead(404);res.end();return;}
      // Public card QR codes are generated for this host, not workers.dev.
      const qrMatch=decoded.match(/^\/qr\/task-(\d{2})\.svg$/);
      if(qrMatch) {
        const {flowConfig}=await import("./game-engine.mjs");
        const id=Number(qrMatch[1]);if(id<1||id>flowConfig().maxTeams){res.writeHead(404);res.end();return;}
        const qr=qrcode(0,"M");qr.addData(new URL("/?id="+id,origin).href);qr.make();
        const body=qr.createSvgTag({cellSize:8,margin:32,scalable:true});
        res.writeHead(200,{"Content-Type":types[".svg"],"Cache-Control":"no-store","Content-Length":Buffer.byteLength(body)});
        res.end(req.method==="HEAD"?undefined:body);return;
      }
      const file=path.resolve(publicDir,"."+(decoded==="/"?"/index.html":decoded)),ext=path.extname(file);
      if(!file.startsWith(publicDir+path.sep)||!types[ext]){res.writeHead(404);res.end();return;}
      let info;try{info=await stat(file);}catch{res.writeHead(404);res.end();return;}
      if(!info.isFile()){res.writeHead(404);res.end();return;}
      res.setHeader("Content-Type",types[ext]);res.setHeader("Accept-Ranges","bytes");
      res.setHeader("Cache-Control",ext===".mp4"?"public, max-age=31536000, immutable":"no-cache");
      const range=parseRange(req.headers.range,info.size);
      if(range===false){res.writeHead(416,{"Content-Range":"bytes */"+info.size});res.end();return;}
      if(range){res.writeHead(206,{"Content-Range":`bytes ${range.start}-${range.end}/${info.size}`,"Content-Length":range.end-range.start+1});}
      else if(ext===".html"&&/(?:^|[,\s])gzip(?:[,\s;]|$)/i.test(req.headers["accept-encoding"]||"")) {
        res.setHeader("Content-Encoding","gzip");res.setHeader("Vary","Accept-Encoding");
        if(req.method==="HEAD"){res.end();return;}
        await pipeline(createReadStream(file),createGzip(),res);return;
      }else res.setHeader("Content-Length",info.size);
      if(req.method==="HEAD"){res.end();return;}
      await pipeline(createReadStream(file,range||{}),res);
    }catch {
      if(res.headersSent){res.destroy();return;}
      res.writeHead(500,{"Content-Type":"text/plain; charset=utf-8"});res.end("Не удалось обработать запрос.");
    }
  });
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  try {
    const filename=path.resolve(process.env.SQLITE_FILE||path.join(process.env.LOCALAPPDATA||path.join(homedir(),".local","share"),"HalloweenQuest","rooms.sqlite"));
    const relative=path.relative(defaultDir,filename);
    if(!relative||(!relative.startsWith(".."+path.sep)&&relative!==".."&&!path.isAbsolute(relative)))throw Error("Нельзя хранить базу внутри publish/.");
    const store=new SqliteRoomStore(filename);
    const port=Number(process.env.PORT||3000);if(!Number.isInteger(port)||port<1||port>65535)throw Error("Проверьте PORT.");
    await store.check();await stat(path.join(defaultDir,"play.html"));
    const server=createQuestServer({store,publicOrigin:process.env.PUBLIC_ORIGIN,production:process.env.NODE_ENV==="production"});
    server.on("error",error=>{console.error("Server failed: "+error.message);store.close?.();process.exitCode=1;});
    server.listen(port,process.env.BIND_HOST||"127.0.0.1",()=>console.log("Halloween quest listening on port "+port+"; storage: sqlite"));
    for(const signal of ["SIGTERM","SIGINT"])process.once(signal,()=>server.close(()=>{store.close?.();process.exit(0);}));
  }catch(error){console.error("Startup failed: "+error.message);process.exitCode=1;}
}
