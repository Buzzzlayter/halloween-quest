import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import { setTimeout as delay } from "node:timers/promises";

const production = "https://halloween-quest.buzzzlayter.workers.dev/";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function verify() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: node verify-deployment.mjs [project-directory] [--offline]");
    return;
  }
  const unknownFlags = args.filter(arg => arg.startsWith("--") && arg !== "--offline");
  const positional = args.filter(arg => !arg.startsWith("--"));
  if (unknownFlags.length || positional.length > 1) throw new Error("Invalid arguments; use --help");
  const root = path.resolve(positional[0] || process.cwd());
  const sourceCode = await readFile(path.join(root, "dist/assets/tasks.js"), "utf8");
  const sourceContext = { window: {} };
  vm.runInNewContext(sourceCode, sourceContext, { timeout: 1000 });
  const tasks = sourceContext.window.HALLOWEEN_TASKS;
  if (!Array.isArray(tasks) || !tasks.length) throw new Error("No source tasks found");
  const ids = tasks.map(task => task.id);
  if (ids.some(id => !Number.isInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    throw new Error("Task IDs must be unique positive integers");
  }

  const bundle = await readFile(path.join(root, "publish/index.html"));
  const html = bundle.toString("utf8");
  if (/<script\b[^>]*\bsrc\s*=/i.test(html) || /<link\b[^>]*\brel\s*=\s*["']stylesheet["']/i.test(html)) {
    throw new Error("Bundle still references external JavaScript or CSS");
  }
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  const taskScript = scripts.find(script => /^\s*window\.HALLOWEEN_TASKS\s*=/.test(script));
  if (!taskScript) throw new Error("Embedded task data not found in bundle");
  const builtContext = { window: {} };
  vm.runInNewContext(taskScript, builtContext, { timeout: 1000 });
  const builtTasks = builtContext.window.HALLOWEEN_TASKS;
  if (!Array.isArray(builtTasks) || builtTasks.length !== tasks.length) {
    throw new Error("Bundle has a different task count; rebuild before deploying");
  }
  const videoAssets = new Map();
  for (const [index, task] of tasks.entries()) {
    const built = builtTasks[index];
    for (const field of ["id", "kicker", "title", "description", "text", "animation", "accent", "imageAlt", "motion", "videoAspect"]) {
      if (built[field] !== task[field]) throw new Error(`Stale bundle: task ${task.id}, field ${field}`);
    }
    if (task.image && !task.image.startsWith("data:")) {
      const webp = await readFile(path.join(root, "dist/assets/images", path.basename(task.image)));
      if (built.image !== `data:image/webp;base64,${webp.toString("base64")}`) {
        throw new Error(`Stale or missing embedded image for task ${task.id}`);
      }
    } else if (built.image !== task.image) {
      throw new Error(`Image data differs for task ${task.id}`);
    }
    if (task.video) {
      if (!/^quest-\d+\.[a-f0-9]{12}\.mp4$/.test(built.video || "")) {
        throw new Error(`Missing versioned video URL for task ${task.id}`);
      }
      const sourceVideo = await readFile(path.resolve(root, "dist/task", task.video));
      const publishedVideo = await readFile(path.join(root, "publish", built.video));
      if (digest(sourceVideo) !== digest(publishedVideo)) throw new Error(`Stale video for task ${task.id}`);
      if (task.videoPoster) {
        const poster = await readFile(path.resolve(root, "dist/task", task.videoPoster));
        if (built.videoPosterHash !== digest(poster) || !built.videoPoster?.startsWith("data:image/webp;base64,")) {
          throw new Error(`Stale video poster for task ${task.id}`);
        }
      }
      videoAssets.set(built.video, { hash: digest(publishedVideo), bytes: publishedVideo });
    } else if (built.video) {
      throw new Error(`Unexpected video for task ${task.id}`);
    }
  }
  const expectedHash = digest(bundle);
  console.log(`Local bundle verified: ${tasks.length} tasks, ${videoAssets.size} video assets, SHA-256 ${expectedHash.slice(0, 12)}`);
  if (args.includes("--offline")) return;

  const urls = [new URL(production), ...ids.map(id => new URL(`?id=${id}`, production))];
  async function check(url, hash = expectedHash, contentType = "text/html") {
    let failure;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await delay(1500);
      try {
        const response = await fetch(url, {
          headers: { "Cache-Control": "no-cache" },
          signal: AbortSignal.timeout(20000)
        });
        if (new URL(response.url).origin !== new URL(production).origin) {
          await response.body?.cancel();
          throw new Error("Unexpected redirect to another origin");
        }
        if (response.status !== 200) {
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status}`);
        }
        if (response.headers.get("content-type")?.split(";")[0] !== contentType) {
          await response.body?.cancel();
          throw new Error(`Unexpected content type; expected ${contentType}`);
        }
        const actualHash = digest(Buffer.from(await response.arrayBuffer()));
        if (actualHash !== hash) throw new Error("Published file differs from the local build");
        return { url: url.href, ok: true };
      } catch (error) {
        failure = error.message;
      }
    }
    return { url: url.href, ok: false, failure };
  }
  const results = await Promise.all([
    ...urls.map(url => check(url)),
    ...[...videoAssets].map(([name, asset]) => check(new URL(name, production), asset.hash, "video/mp4"))
  ]);
  for (const result of results) {
    console.log(`${result.ok ? "OK" : "FAILED"} ${result.url}${result.failure ? `: ${result.failure}` : ""}`);
  }
  if (results.some(result => !result.ok)) throw new Error("Deployment verification incomplete; see failed URLs above");
  let rangeWarnings = 0;
  for (const [name, asset] of videoAssets) {
    const response = await fetch(new URL(name, production), {
      headers: { Range: "bytes=0-63" }, signal: AbortSignal.timeout(20000)
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    // RFC 9110 section 14.2 permits servers to ignore Range and send the full file.
    // Surface that limitation explicitly instead of claiming partial playback passed.
    if (response.status === 200 && bytes.equals(asset.bytes)) {
      rangeWarnings++;
      console.warn(`WARNING: ${name} is served as a complete MP4, not partial content. Verify playback on target phones.`);
    } else if (response.status !== 206 || response.headers.get("content-range") !== `bytes 0-63/${asset.bytes.length}` ||
        !bytes.equals(asset.bytes.subarray(0, 64))) {
      throw new Error(`Video range request failed: ${name}`);
    } else {
      console.log(`OK video byte-range playback: ${name}`);
    }
  }
  console.log(`Verified production home page and all ${tasks.length} task URLs.`);
  if (rangeWarnings) console.warn(`Verification limitation: ${rangeWarnings} video asset(s) lack confirmed byte-range support.`);
}

verify().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
