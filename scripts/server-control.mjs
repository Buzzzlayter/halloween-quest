import http from "node:http";
import {randomBytes,timingSafeEqual} from "node:crypto";
import {mkdir,writeFile,unlink,readdir,readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";

const directory=fileURLToPath(new URL("../.cache/server-control/",import.meta.url));
const modes=new Set(["local","public"]);
export async function registerControl(mode,onStop,baseDirectory=directory) {
  if(!modes.has(mode))throw Error("Неизвестный режим сервера.");
  await mkdir(baseDirectory,{recursive:true});
  const token=randomBytes(32).toString("hex"),filename=path.join(baseDirectory,`${mode}-${process.pid}-${randomBytes(8).toString("hex")}.json`);
  const server=http.createServer((req,res)=>{
    const provided=Buffer.from(String(req.headers["x-quest-stop"]||"")),expected=Buffer.from(token);
    if(req.method!=="POST"||req.url!=="/stop"||provided.length!==expected.length||!timingSafeEqual(provided,expected)) {
      res.writeHead(403);res.end();return;
    }
    res.writeHead(200,{"Content-Type":"text/plain"});res.end("stopping");setImmediate(onStop);
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  try {await writeFile(filename,JSON.stringify({mode,port:server.address().port,token}),{flag:"wx",mode:0o600});}
  catch(error){server.close();throw error;}
  let closed=false;
  return async()=>{if(closed)return;closed=true;server.close();await unlink(filename).catch(error=>{if(error.code!=="ENOENT")console.error("Не удалось удалить файл управления: "+error.message);});};
}

export async function stopManaged(mode,baseDirectory=directory) {
  if(!modes.has(mode))throw Error("Режим остановки: local или public.");
  const files=await readdir(baseDirectory).catch(error=>{if(error.code==="ENOENT")return [];throw error;});
  let stopped=0;
  for(const name of files.filter(name=>new RegExp(`^${mode}-[0-9]+-[a-f0-9]{16}\\.json$`).test(name))) {
    let data;try {data=JSON.parse(await readFile(path.join(baseDirectory,name),"utf8"));}catch {continue;}
    if(data.mode!==mode||!Number.isInteger(data.port)||data.port<1||data.port>65535||!/^[a-f0-9]{64}$/.test(data.token||""))continue;
    try {
      const response=await fetch(`http://127.0.0.1:${data.port}/stop`,{method:"POST",headers:{"x-quest-stop":data.token},signal:AbortSignal.timeout(1500)});
      if(response.ok&&(await response.text())==="stopping")stopped++;
    }catch {}
  }
  return stopped;
}
