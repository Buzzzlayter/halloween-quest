import {spawn,spawnSync} from "node:child_process";
import {stat} from "node:fs/promises";
import {isIP} from "node:net";
import {fileURLToPath,pathToFileURL} from "node:url";
import path from "node:path";
import {registerControl} from "./server-control.mjs";

const root=fileURLToPath(new URL("../",import.meta.url));
export function validPublicIPv4(value) {
  if(isIP(value)!==4)return false;
  const [a,b,c]=value.split(".").map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||
    (a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||
    (a===192&&b===0&&c===2)||(a===198&&(b===18||b===19||b===51&&c===100))||
    (a===203&&b===0&&c===113));
}

export async function startPublic(ip=process.argv[2]||process.env.QUEST_PUBLIC_IP) {
  if(!validPublicIPv4(ip||""))throw Error("Укажите публичный IPv4: npm run public -- ВАШ_IP");
  const caddy=process.env.HALLOWEEN_CADDY||path.join(root,".cache","caddy-2.11.7","caddy.exe");
  await stat(caddy).catch(()=>{throw Error("Caddy не найден. Установите Caddy согласно PUBLIC-SERVER.md или задайте HALLOWEEN_CADDY.");});
  await stat(path.join(root,"publish","play.html"));
  const config=path.join(root,"server","Caddyfile.public"),origin="https://"+ip;
  const shared={...process.env,QUEST_PUBLIC_IP:ip};
  const validation=spawnSync(caddy,["validate","--config",config,"--adapter","caddyfile"],{cwd:root,env:shared,stdio:"inherit",windowsHide:true});
  if(validation.error||validation.status!==0)throw Error("Caddy не принял конфигурацию. Нужна версия с поддержкой ACME profile.");
  let app,proxy,stopping=false,started=false;
  async function stop(code=0){if(stopping)return;stopping=true;process.exitCode=code;proxy?.kill();app?.kill();await closeControl();}
  const closeControl=await registerControl("public",()=>stop());
  app=spawn(process.execPath,[path.join(root,"server","node-server.mjs")],{cwd:root,
    env:{...shared,BIND_HOST:"127.0.0.1",PORT:"3081",PUBLIC_ORIGIN:origin,NODE_ENV:"production"},stdio:["ignore","pipe","inherit"],windowsHide:true});
  for(const signal of ["SIGINT","SIGTERM"])process.once(signal,()=>stop());
  app.on("error",error=>{console.error("Сервер: "+error.message);stop(1);});
  app.on("exit",code=>{if(!stopping){console.error("Игровой сервер остановлен.");stop(code||1);}});
  app.stdout.on("data",chunk=>{
    process.stdout.write(chunk);
    if(started||!chunk.toString().includes("listening on port"))return;
    started=true;
    console.log("Запускается HTTPS. Проверка сертификата возможна только при доступности портов 80 и 443 из интернета.");
    proxy=spawn(caddy,["run","--config",config,"--adapter","caddyfile"],{cwd:root,env:shared,stdio:"inherit",windowsHide:true});
    proxy.on("error",error=>{console.error("Caddy: "+error.message);stop(1);});
    proxy.on("exit",code=>{if(!stopping){console.error("HTTPS-сервер остановлен.");stop(code||1);}});
    console.log(`Адрес после выпуска сертификата: ${origin}/play.html`);
    console.log("Пока сертификат не получен и доступ с телефона не проверен, сервер не готов для игры.");
    console.log("Не закрывайте окно. Ctrl+C остановит оба процесса.");
  });
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
  startPublic().catch(error=>{console.error("Не удалось подготовить сервер: "+error.message);process.exitCode=1;});
