import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {registerControl} from "./server-control.mjs";

const root=fileURLToPath(new URL("../",import.meta.url));
const origin="http://127.0.0.1:3000",url=origin+"/play.html";
let app,stopping=false;
async function stop(code=0) {if(stopping)return;stopping=true;process.exitCode=code;app?.kill();await closeControl();}
const closeControl=await registerControl("local",()=>stop());
app=spawn(process.execPath,[path.join(root,"server/node-server.mjs")],{
  cwd:root,env:{...process.env,BIND_HOST:"127.0.0.1",PORT:"3000",PUBLIC_ORIGIN:origin,NODE_ENV:"development"},
  stdio:["ignore","pipe","inherit"],windowsHide:true
});
let started=false,output="";
app.stdout.on("data",chunk=>{
  process.stdout.write(chunk);output+=chunk.toString();
  if(started||!output.includes("listening on port 3000"))return;
  started=true;
  console.log("\nЛокальная игра: "+url);
  console.log("Оставьте окно открытым. Ctrl+C остановит сервер.");
  if(process.platform==="win32"&&process.env.HALLOWEEN_NO_BROWSER!=="1") {
    const browser=spawn("explorer.exe",[url],{stdio:"ignore",windowsHide:true});
    browser.on("error",()=>console.error("Не удалось открыть браузер автоматически. Откройте адрес выше вручную."));
  }
});
app.on("error",error=>{console.error("Ошибка запуска сервера: "+error.message);stop(1);});
app.on("exit",code=>{if(!stopping)stop(code||1);});
for(const signal of ["SIGINT","SIGTERM"])process.once(signal,()=>stop());
