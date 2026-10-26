import {stopManaged} from "./server-control.mjs";
try {
  const mode=process.argv[2],count=await stopManaged(mode);
  console.log(count?`Запрошена остановка серверов: ${count}.`:`Запущенные серверы режима ${mode} не найдены.`);
} catch(error) {console.error("Ошибка остановки: "+error.message);process.exitCode=1;}
