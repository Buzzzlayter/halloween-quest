import { DurableObject } from "cloudflare:workers";
import qrcode from "qrcode-generator";
import { GameError, createRoom, validateTeamCount, validateScoring, flowConfig, joinRoom, authorize, dispatch, view } from "./game-engine.mjs";
import { teamsFor } from "./room-scenario.mjs";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: {
  "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
} });
async function readJson(request) {
  if (!request.body) return {};
  const reader = request.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 32768) { await reader.cancel(); throw new GameError("Слишком большой запрос.", 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("object expected");
    return data;
  } catch { throw new GameError("Не удалось прочитать запрос.", 400); }
}
function failure(error) {
  if (error instanceof GameError) return json({ error: error.message }, error.status);
  console.error("Room request failed:", error.message);
  return json({ error: "Не удалось обновить игру. Попробуйте ещё раз." }, 500);
}

export class QuestRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.ctx = ctx; this.room = null; this.queue = Promise.resolve();
    this.ready = ctx.blockConcurrencyWhile(async () => { this.room = await ctx.storage.get("room"); });
  }
  fetch(request) {
    const result = this.queue.then(() => this.handle(request));
    this.queue = result.catch(() => {}); return result;
  }
  async handle(request) {
    try {
      await this.ready;
      const url = new URL(request.url);
      const part = url.pathname.split("/").filter(Boolean);
      const command = part[3];
      if (command === "create" && request.method === "POST") {
        if (this.room) return json({ error: "occupied" }, 409);
        const data = await readJson(request);
        const next = createRoom(data.code, Date.now(), undefined, data.teamCount, {scoring:data.scoring});
        await this.ctx.storage.setAlarm(next.expiresAt);
        await this.ctx.storage.put("room", next);
        this.room = next;
        return json({ code: this.room.code, role: "host", token: this.room.hostToken });
      }
      if (!this.room) return json({ error: "Комната не найдена. Попросите новый QR у ведущего." }, 404);
      if (Date.now() > this.room.expiresAt) return json({ error: "Время комнаты истекло. Создайте новую игру." }, 410);
      if (command === "join" && request.method === "POST") {
        const data = await readJson(request);
        const next=structuredClone(this.room);
        const session = joinRoom(next, data.team, data.invite);
        await this.ctx.storage.put("room", next);this.room=next;return json(session);
      }
      const role = authorize(this.room, request.headers.get("Authorization")?.replace(/^Bearer /, ""));
      if (command === "state" && request.method === "GET") return json(view(this.room, role));
      if (command === "action" && request.method === "POST") {
        const data = await readJson(request);
        const next=structuredClone(this.room);
        dispatch(next, role, data.action, data);
        await this.ctx.storage.put("room", next);this.room=next;
        return json(view(this.room, role));
      }
      if (command === "qr" && request.method === "GET") {
        if (role !== "host") throw new GameError("QR-приглашения открывает ведущий.", 403);
        const team = part[4]; if (!teamsFor(this.room).some(item => item.id === team)) throw new GameError("Команда не найдена в этой комнате.", 404);
        const inviteUrl = new URL("/play.html", url.origin);
        inviteUrl.searchParams.set("room", this.room.code);
        inviteUrl.searchParams.set("team", team);
        inviteUrl.searchParams.set("invite", this.room.members[team].invite);
        const qr = qrcode(0, "M"); qr.addData(inviteUrl.href); qr.make();
        return new Response(qr.createSvgTag({ cellSize: 8, margin: 32, scalable: true }), { headers: {
          "Content-Type": "image/svg+xml", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
        } });
      }
      return json({ error: "Действие не найдено." }, 404);
    } catch (error) { return failure(error); }
  }
  async alarm() { await this.ctx.storage.deleteAll(); this.room = null; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (request.method === "POST" && request.headers.has("Origin") && request.headers.get("Origin") !== url.origin) {
        return json({ error: "Откройте игру на её основном сайте." }, 403);
      }
      if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true, game: "quest-flow-v2", legacyRooms: true });
      if (url.pathname === "/api/config" && request.method === "GET") return json(flowConfig());
      if (url.pathname === "/api/rooms" && request.method === "POST") {
        const data = await readJson(request);
        const teamCount = validateTeamCount(data.teamCount);
        const scoring = validateScoring(data.scoring);
        for (let i = 0; i < 3; i++) {
          const code = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
          const stub = env.QUEST_ROOMS.get(env.QUEST_ROOMS.idFromName(code));
          const response = await stub.fetch(new Request(new URL(`/api/rooms/${code}/create`, url.origin), {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, teamCount, scoring })
          }));
          if (response.status !== 409) return response;
        }
        return json({ error: "Не удалось создать комнату. Попробуйте ещё раз." }, 503);
      }
      const match = url.pathname.match(/^\/api\/rooms\/(\d{6})\/(state|join|action|qr\/[a-z][a-z0-9-]{0,63})$/);
      if (!match) return json({ error: "Адрес игры не найден." }, 404);
      return await env.QUEST_ROOMS.get(env.QUEST_ROOMS.idFromName(match[1])).fetch(request);
    } catch (error) { return failure(error); }
  }
};
