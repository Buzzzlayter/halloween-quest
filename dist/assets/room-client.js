(async function () {
  const get = id => document.getElementById(id);
  const root = get("room-app");
  const message = get("room-message");
  const { node, button } = window.RoomUI;
  const storageKey = "halloween-room-session-v1";
  const params = new URLSearchParams(window.location.search);
  let session = null, state = null, draft = { items: [] }, pending = false, polling = false, timer, qrBlob;
  let inviteRequest = 0;
  function tell(text, error = true) { message.textContent = text; message.hidden = !text; message.className = error ? "room-message" : "room-message room-success"; }
  function saveSession(value) {
    session = value;
    try { if (value) window.localStorage.setItem(storageKey, JSON.stringify(value)); else window.localStorage.removeItem(storageKey); } catch {}
    get("leave-room").hidden = !value;
  }
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
    if (saved && /^\d{6}$/.test(saved.code) && typeof saved.token === "string" && ["host", "pumpkins", "bats", "ghosts", "mages"].includes(saved.role)) session = saved;
  } catch {}

  async function request(path, body, auth = session) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(path, { method: body === undefined ? "GET" : "POST", signal: controller.signal,
        headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(auth ? { Authorization: "Bearer " + auth.token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) { const error = new Error(data.error || "Запрос не выполнен."); error.status = response.status; throw error; }
      return data;
    } finally { window.clearTimeout(timeout); }
  }
  function accept(next) {
    if (state && next.code === state.code && next.version < state.version) return;
    const changed = !state || state.version !== next.version || state.code !== next.code;
    if (!state || state.roundIndex !== next.roundIndex || (state.proposal && !next.proposal)) draft = { items: [], testRole: draft.testRole };
    state = next;
    if (changed) draw();
  }
  function draw() {
    if (!state) return;
    get("room-code").textContent = "Игра " + state.code;
    const team = state.teams.find(team => team.id === state.role);
    get("room-role").textContent = team ? team.icon + " " + team.name : "Ведущий";
    get("leave-room").hidden = false;
    window.RoomUI.render(root, state, { act: action, redraw: draw, invite: showInvite, newGame }, draft);
    if (state.role === "host" && state.phase !== "closed") {
      const end = node("details", undefined, "room-close");
      end.append(node("summary", "Управление комнатой"), button("Завершить эту игру", async () => {
        if (window.confirm("Завершить игру для всех четырёх команд?")) await action("close");
      }, true)); root.append(end);
    }
  }
  async function action(name, data = {}) {
    if (pending || !session || !state) return;
    pending = true; tell("");
    const asTeam = name !== "close" && state.role === "host" && state.testMode && draft.testRole && draft.testRole !== "host" ? draft.testRole : undefined;
    try { accept(await request(`/api/rooms/${session.code}/action`, { ...data, asTeam, action: name, roundIndex: state.roundIndex })); }
    catch (error) { tell(error.name === "AbortError" ? "Связь задерживается. Дождитесь обновления, прежде чем повторять действие." : error.message); await poll(); }
    finally { pending = false; draw(); }
  }
  async function poll() {
    if (!session || polling) return;
    const pollingSession = session;
    polling = true;
    try {
      const next = await request(`/api/rooms/${pollingSession.code}/state`, undefined, pollingSession);
      if (session !== pollingSession) return;
      accept(next);
      if (message.dataset.network === "true") { tell(""); delete message.dataset.network; }
    } catch (error) {
      if (session !== pollingSession) return;
      tell(error.name === "AbortError" || !error.status ? "Связь пропала. Игра сохранена; пробуем подключиться снова." : error.message);
      message.dataset.network = "true";
      if ([401, 404, 410].includes(error.status)) { saveSession(null); state = null; welcome(); }
    } finally { polling = false; }
  }
  function schedule() {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      if (!document.hidden) await poll();
      schedule();
    }, document.hidden ? 6000 : 2200);
  }
  async function connect() {
    state = null; draft = { items: [] };
    window.history.replaceState(null, "", "/play.html?room=" + session.code);
    await poll(); schedule();
  }
  async function newGame() {
    if (pending) return; pending = true; tell("");
    try { saveSession(await request("/api/rooms", {}, null)); await connect(); }
    catch (error) { tell(error.message); }
    finally { pending = false; }
  }
  function welcome() {
    root.replaceChildren();
    get("room-code").textContent = ""; get("room-role").textContent = "";
    const panel = node("section", undefined, "room-panel");
    panel.append(node("h1", "Тайна погасшего фонаря"), node("p", "Четыре команды, пять телефонов, восемь общих испытаний. У каждой команды своя часть секрета — без переговоров ответ не собрать."));
    if (session) panel.append(button("Продолжить игру " + session.code, connect));
    panel.append(button("Создать игру ведущего", newGame, !!session));
    const note = node("div", undefined, "room-rule");
    note.append(node("strong", "Если вы в команде"), node("p", "Попросите ведущего показать QR вашей команды и отсканируйте его этим телефоном. Другого реквизита не нужно."));
    panel.append(note); root.append(panel);
    get("leave-room").hidden = !session;
  }

  async function showInvite(teamId) {
    const team = state.teams.find(team => team.id === teamId);
    const dialog = get("invite-dialog"), image = get("invite-image"), loading = get("invite-loading");
    const current = ++inviteRequest;
    if (qrBlob) { URL.revokeObjectURL(qrBlob); qrBlob = null; }
    const link = new URL("/play.html", window.location.origin);
    link.searchParams.set("room", state.code); link.searchParams.set("team", teamId); link.searchParams.set("invite", state.invites[teamId]);
    get("invite-title").textContent = team.icon + " " + team.name;
    get("invite-link").value = link.href;
    image.hidden = true; loading.hidden = false; loading.textContent = "Создаём QR…";
    if (!dialog.open) dialog.showModal();
    try {
      const response = await fetch(`/api/rooms/${state.code}/qr/${teamId}`, { headers: { Authorization: "Bearer " + session.token }, cache: "no-store" });
      if (!response.ok) throw new Error("QR не загрузился. Скопируйте ссылку ниже.");
      const blob = await response.blob();
      if (current !== inviteRequest || !dialog.open) return;
      qrBlob = URL.createObjectURL(blob); image.src = qrBlob; image.hidden = false; loading.hidden = true;
    } catch (error) { if (current === inviteRequest) loading.textContent = error.message; }
  }
  get("invite-dialog").addEventListener("close", () => {
    inviteRequest++; if (qrBlob) { URL.revokeObjectURL(qrBlob); qrBlob = null; }
  });
  get("copy-invite").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(get("invite-link").value); tell("Ссылка команды скопирована.", false); }
    catch { get("invite-link").focus(); get("invite-link").select(); }
  });
  get("leave-room").addEventListener("click", () => {
    if (!window.confirm("Выйти на этом телефоне? Остальные команды продолжат игру.")) return;
    saveSession(null); state = null; window.clearTimeout(timer);
    window.history.replaceState(null, "", "/play.html"); welcome();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });

  if (params.has("invite") && /^\d{6}$/.test(params.get("room") || "")) {
    tell("");
    try {
      saveSession(await request(`/api/rooms/${params.get("room")}/join`, { team: params.get("team"), invite: params.get("invite") }, null));
      await connect();
    } catch (error) { tell(error.message); welcome(); }
  } else if (session && params.get("room") === session.code) await connect();
  else welcome();
})();
