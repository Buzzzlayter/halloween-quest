import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "dist");
const output = path.join(root, "publish");
const tasksCode = await readFile(path.join(source, "assets/tasks.js"), "utf8");
const context = { window: {} };
vm.runInNewContext(tasksCode, context);
const tasks = context.window.HALLOWEEN_TASKS;
if (!Array.isArray(tasks) || !tasks.length) throw new Error("No tasks found");
const ids = new Set();
for (const task of tasks) {
  if (!Number.isInteger(task.id) || task.id < 1 || ids.has(task.id)) {
    throw new Error(`Invalid or duplicate task ID: ${task.id}`);
  }
  ids.add(task.id);
  if (!task.image || task.image.startsWith("data:")) continue;
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
const embeddedTasks = `window.HALLOWEEN_TASKS = ${JSON.stringify(tasks)};`;
let html = await readFile(path.join(source, "index.html"), "utf8");
const css = await readFile(path.join(source, "assets/styles.css"), "utf8");
html = html.replace('<link rel="stylesheet" href="assets/styles.css" />', () => `<style>\n${css}\n</style>`);
for (const name of ["tasks", "task-page"]) {
  const js = name === "tasks" ? embeddedTasks : await readFile(path.join(source, `assets/${name}.js`), "utf8");
  html = html.replace(`<script src="assets/${name}.js"></script>`, () => `<script>\n${js.replace(/<\/script/gi, "<\\/script")}\n</script>`);
}
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "index.html"), html, "utf8");
console.log(`Ready to upload: ${path.join(output, "index.html")}`);
console.log(`${tasks.length} tasks; single HTML size: ${Math.round(Buffer.byteLength(html) / 1024)} KB`);
