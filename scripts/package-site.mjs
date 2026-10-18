import { readFile, mkdir, writeFile, stat, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import sharp from "sharp";
import qrcode from "qrcode-generator";
import { ROUNDS, TEAMS } from "../server/scenario.mjs";
import FLOW from "../server/quest-flow.json" with { type: "json" };

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "dist");
const output = path.join(root, "publish");
await mkdir(output, { recursive: true });
const tasksCode = await readFile(path.join(source, "assets/tasks.js"), "utf8");
const context = { window: {} };
vm.runInNewContext(tasksCode, context);
const tasks = context.window.HALLOWEEN_TASKS;
const game = context.window.HALLOWEEN_GAME;
if (!Array.isArray(tasks) || !tasks.length) throw new Error("No tasks found");
if (!game?.teams?.length) throw new Error("Game rules and teams are missing");
const teamIds = new Set(game.teams.map(team => team.id));
if (teamIds.size !== game.teams.length) throw new Error("Duplicate team IDs");
const ids = new Set();
for (const task of tasks) {
  if (!Number.isInteger(task.id) || task.id < 1 || ids.has(task.id)) {
    throw new Error(`Invalid or duplicate task ID: ${task.id}`);
  }
  ids.add(task.id);
  const round = ROUNDS.find(round => round.id === task.id);
  if (!round || round.title !== task.title || round.goal !== task.text) throw new Error(`Public task ${task.id} does not match the server scenario`);
  if (["solution", "clues", "steps"].some(key => key in task)) throw new Error("Private or obsolete task data in public bundle");
  if (task.video && !task.video.startsWith("https://")) {
    const videoSource = path.resolve(source, "task", task.video);
    if (!videoSource.startsWith(source + path.sep)) throw new Error(`Video must be inside dist: ${task.id}`);
    const videoBytes = await readFile(videoSource);
    const hash = createHash("sha256").update(videoBytes).digest("hex").slice(0, 12);
    const filename = `quest-${String(task.id).padStart(2, "0")}.${hash}.mp4`;
    await writeFile(path.join(output, filename), videoBytes);
    task.video = filename;
    console.log(`Prepared video ${filename}: ${Math.round(videoBytes.length / 1024)} KB`);
  }
  if (task.videoPoster && !task.videoPoster.startsWith("https://")) {
    const posterSource = path.resolve(source, "task", task.videoPoster);
    if (!posterSource.startsWith(source + path.sep)) throw new Error(`Poster must be inside dist: ${task.id}`);
    const posterOriginal = await readFile(posterSource);
    task.videoPosterHash = createHash("sha256").update(posterOriginal).digest("hex");
    const posterBytes = await sharp(posterOriginal).resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 80 }).toBuffer();
    task.videoPoster = `data:image/webp;base64,${posterBytes.toString("base64")}`;
  }
  if (!task.image || task.image.startsWith("data:") || task.image.startsWith("https://")) continue;
  const fileName = path.basename(task.image);
  const original = path.join(root, "artwork", fileName.replace(/\.webp$/, ".png"));
  const destination = path.join(source, "assets/images", fileName);
  const originalStat = await stat(original);
  const destinationStat = await stat(destination).catch(() => null);
  if (!destinationStat || destinationStat.mtimeMs < originalStat.mtimeMs) {
    await mkdir(path.dirname(destination), { recursive: true });
    await sharp(original).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, effort: 6 }).toFile(destination);
  }
  const bytes = await readFile(destination);
  task.image = `data:image/webp;base64,${bytes.toString("base64")}`;
  console.log(`Embedded ${fileName}: ${Math.round(bytes.length / 1024)} KB`);
}
if (tasks.length !== ROUNDS.length || TEAMS.length !== teamIds.size) throw new Error("Scenario/public content count mismatch");
const embeddedTasks = `window.HALLOWEEN_TASKS = ${JSON.stringify(tasks)};\nwindow.HALLOWEEN_GAME = ${JSON.stringify(game)};`;
const embeddedMedia = `window.HALLOWEEN_MEDIA = ${JSON.stringify(tasks.map(t=>({id:t.id,title:t.title,video:t.video,poster:t.videoPoster||t.image})))};`;
for(const stage of FLOW.stages) for(const id of [...(stage.videoIds||[]),...(stage.questions||[]).map(q=>q.videoId).filter(Boolean)]) {
  if(!tasks.some(t=>t.id===id&&t.video))throw new Error(`Missing reward video ${id}`);
}
let css = await readFile(path.join(source, "assets/styles.css"), "utf8");
const displayFont = await readFile(path.join(source, "assets/fonts/RuslanDisplay-Regular.ttf"));
const fontLicense = await readFile(path.join(source, "assets/fonts/OFL-Ruslan-Display.txt"), "utf8");
css = css.replace('url("./fonts/RuslanDisplay-Regular.ttf")', () => `url("data:font/ttf;base64,${displayFont.toString("base64")}")`);
css = `/* Ruslan Display font license\n${fontLicense.replace(/\*\//g, "* /")}\n*/\n${css}`;
async function bundlePage(filename) {
  let page = await readFile(path.join(source, filename), "utf8");
  page = page.replace('<link rel="stylesheet" href="assets/styles.css" />', () => `<style>\n${css}\n</style>`);
  for (const name of ["tasks", "media", "game-page", "control-panel", "task-page", "room-ui", "flow-ui", "room-client"]) {
    if (!page.includes(`<script src="assets/${name}.js"></script>`)) continue;
    const js = name === "tasks" ? embeddedTasks : name === "media" ? embeddedMedia : await readFile(path.join(source, `assets/${name}.js`), "utf8");
    page = page.replace(`<script src="assets/${name}.js"></script>`, () => `<script>\n${js.replace(/<\/script/gi, "<\\/script")}\n</script>`);
  }
  return page;
}
const html = await bundlePage("index.html");
await mkdir(output, { recursive: true });
await mkdir(path.join(output, "qr"), { recursive: true });
for (const task of tasks) {
  const qr = qrcode(0, "M");
  qr.addData(`https://halloween-quest.buzzzlayter.workers.dev/?id=${task.id}`); qr.make();
  await writeFile(path.join(output, "qr", `task-${String(task.id).padStart(2,"0")}.svg`), qr.createSvgTag({ cellSize: 8, margin: 32, scalable: true }));
}
await writeFile(path.join(output, "index.html"), html, "utf8");
await writeFile(path.join(output, "play.html"), await bundlePage("play.html"), "utf8");
// Retire the previously generated page even when publish already exists.
await rm(path.join(output, "editor.html"), { force: true });
// Text-only, standalone host copy: readable and printable without video or JavaScript.
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
const printTeams = game.teams.map(team => `<li><strong>${escapeHtml(team.icon)} ${escapeHtml(team.name)}.</strong> ${escapeHtml(team.role)}</li>`).join("\n");
const printCards = FLOW.stages.map((stage,index)=>`<section class="game-panel print-quest"><p class="task-kicker">Этап ${index+1} из ${FLOW.stages.length}</p><h2>${escapeHtml(stage.title)}</h2><p>${escapeHtml(stage.prompt)}</p>${(stage.questions||[]).map(q=>`<p>${escapeHtml(q.prompt)}</p>`).join("")}<p>${stage.type==="code"?"Код проверяется автоматически. Сам код доступен только ведущему в комнате.":"Ответы проверяются по допустимым вариантам. Число засчитанных ответов видно ведущему."}</p></section>`).join("\n");
const hostHtml = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>План ведущего — ${escapeHtml(game.title)}</title><style>${css}
@media print { body { color: #111; background: white; } body::before { display: none; }
.preview-shell { width: 100%; } .game-panel { background: white; border: 0; }
.print-quest { break-inside: avoid; } h1, h2, .task-kicker { color: #111; text-shadow: none; } }
</style></head><body class="preview-page"><main class="preview-shell">
<a href="./">← Ведущему</a><section class="game-panel"><h1>${escapeHtml(game.title)}</h1><p>${escapeHtml(game.duration)}</p>
<p>${escapeHtml(game.opening)}</p><h2>Подготовка</h2><p>От двух команд, по телефону на команду и телефон ведущего. Число слотов выбирается при создании комнаты; максимум равен числу карточек. Нужен интернет. Другой реквизит не нужен. Создайте общую игру и покажите каждой команде её QR. Подсказки и решения ведущего доступны только внутри комнаты.</p>
<h2>Объяснение детям</h2><ul>${game.rules.map(rule => `<li>${escapeHtml(rule)}</li>`).join("")}</ul><h2>Команды</h2><ul>${printTeams}</ul>
<p>Каждая команда проходит этапы независимо. Ведущий наблюдает за прогрессом и настраивает очки. Малышам помогают старшие. Демо-вопросы и коды заменяются в server/quest-flow.json. Двигайтесь только в безопасной части двора, на виду у взрослых.</p>
<p>${escapeHtml(game.finale)}</p></section>${printCards}</main></body></html>`;
await writeFile(path.join(output, "game-cards.html"), hostHtml, "utf8");
console.log(`Prepared ${tasks.length} public cards and synchronized play.html; room logic stays in the Worker.`);
