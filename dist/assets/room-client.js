(async function () {
  const get = id => document.getElementById(id);
  const root = get("room-app");
  const message = get("room-message");
  const { node, button } = window.RoomUI;
  const storageKey = "halloween-room-session-v1";
  const params = new URLSearchParams(window.location.search);
  let session = null, state = null, draft = { items: [] }, pending = false, polling = false, timer, qrBlob;
  let inviteRequest = 0, rewardTimer, roomConfig = null, welcomeRequest = 0, displayingWelcome = false;
  function tell(text, error = true) { message.textContent = text; message.hidden = !text; message.className = error ? "room-message" : "room-message room-success"; }
  function saveSession(value) {
    session = value;
    try { if (value) window.localStorage.setItem(storageKey, JSON.stringify(value)); else window.localStorage.removeItem(storageKey); } catch {}
    get("leave-room").hidden = !value;
  }
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
    if (saved && /^\d{6}$/.test(saved.code) && typeof saved.token === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(saved.role || "")) session = saved;
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
    const lastReward = state?.scoreEvents?.at(-1)?.id || 0;
    const freshRewards = state?.code === next.code ? (next.scoreEvents || []).filter(event => event.id > lastReward) : [];
    if (!state || state.roundIndex !== next.roundIndex || (state.proposal && !next.proposal)) draft = { items: [] };
    state = next;
    if (freshRewards.length) {
      const role = state.role;
      window.RoomUI.showReward(get("room-reward"), freshRewards, state.teams, role);
      window.clearTimeout(rewardTimer);
      rewardTimer = window.setTimeout(() => { get("room-reward").hidden = true; }, 6500);
    }
    if (changed) draw();
  }
  function draw() {
    if (!state) return;
    get("room-code").textContent = "Игра " + state.code;
    const team = state.teams.find(team => team.id === state.role);
    if(team)get("room-role").replaceChildren(window.RoomUI.teamLabel(team));
    else get("room-role").textContent = "Ведущий";
    get("leave-room").hidden = false;
    const focused=document.activeElement;
    const focusState=focused?.id ? {id:focused.id,start:focused.selectionStart,end:focused.selectionEnd} : null;
    const opened=[...(root.querySelectorAll?.("details[open]")||[])].map(el=>el.id).filter(Boolean);
    const closed=[...(root.querySelectorAll?.("details:not([open])")||[])].map(el=>el.id).filter(Boolean);
    window.RoomUI.render(root, state, { act: action, redraw: draw, invite: showInvite, newGame }, draft);
    for(const id of opened) { const details=get(id); if(details)details.open=true; }
    for(const id of closed) { const details=get(id); if(details)details.open=false; }
    if(focusState) {
      const nextFocus=get(focusState.id);
      if(nextFocus) { nextFocus.focus({preventScroll:true}); try { nextFocus.setSelectionRange(focusState.start,focusState.end); } catch {} }
    }
    if (state.role === "host" && state.phase !== "closed") {
      const end = node("details", undefined, "room-close");
      end.id="room-management";
      end.open=opened.includes(end.id);
      end.append(node("summary", "Управление комнатой"), button("Закрыть комнату без итогов", async () => {
        if (window.confirm("Закрыть комнату для всех без финальных роликов и рейтинга? Продолжить игру в ней будет нельзя.")) await action("close");
      }, true)); root.append(end);
    }
  }
  async function action(name, data = {}) {
    if (pending || !session || !state) return;
    const actionSession=session;
    pending = true; tell("");
    try {
      const next=await request(`/api/rooms/${actionSession.code}/action`, { ...data, action: name, roundIndex: state.roundIndex },actionSession);
      if(session===actionSession&&!displayingWelcome)accept(next);
    }
    catch (error) {
      if(session!==actionSession||displayingWelcome)return;
      tell(error.name === "AbortError" ? "Связь задерживается. Дождитесь обновления, прежде чем повторять действие." : error.message); await poll();
    }
    finally { pending = false; if(session===actionSession&&!displayingWelcome)draw(); }
  }
  async function poll() {
    if (!session || polling || displayingWelcome) return;
    const pollingSession = session;
    polling = true;
    try {
      const next = await request(`/api/rooms/${pollingSession.code}/state`, undefined, pollingSession);
      if (session !== pollingSession || displayingWelcome) return;
      accept(next);
      if (message.dataset.network === "true") { tell(""); delete message.dataset.network; }
    } catch (error) {
      if (session !== pollingSession || displayingWelcome) return;
      tell(error.name === "AbortError" || !error.status ? "Связь пропала. Игра сохранена; пробуем подключиться снова." : error.message);
      message.dataset.network = "true";
      if ([401, 404, 410].includes(error.status)) { saveSession(null); state = null; welcome(); }
    } finally { polling = false; }
  }
  function schedule() {
    window.clearTimeout(timer);
    if (displayingWelcome) return;
    timer = window.setTimeout(async () => {
      if (!document.hidden) await poll();
      schedule();
    }, document.hidden ? 6000 : 2200);
  }
  async function connect() {
    displayingWelcome = false; welcomeRequest++;
    state = null; draft = { items: [] };
    window.FlowUI?.stopMedia();
    root.replaceChildren(node("p", "Подключаемся к игре…"));
    window.clearTimeout(rewardTimer); get("room-reward").hidden = true;
    window.history.replaceState(null, "", "/play.html?room=" + session.code);
    await poll(); schedule();
  }
  async function newGame() {
    if (pending) return;
    if (!get("room-size")) { await welcome(); return; }
    pending = true; tell("");
    const creatingSession=session,creatingWelcome=welcomeRequest;
    const teamCount = Number(get("room-size").value);
    const scoring = roomConfig.scoring && window.FlowUI ? window.FlowUI.readScoring("setup-score") : undefined;
    try {
      const created=await request("/api/rooms", { teamCount, scoring }, null);
      if(session!==creatingSession||welcomeRequest!==creatingWelcome)return;
      saveSession(created); await connect();
    }
    catch (error) { if(session===creatingSession&&welcomeRequest===creatingWelcome)tell(error.message); }
    finally { pending = false; }
  }
  async function welcome() {
    displayingWelcome = true; window.clearTimeout(timer);
    window.FlowUI?.stopMedia();
    inviteRequest++;get("invite-dialog").close?.();
    if(qrBlob){URL.revokeObjectURL(qrBlob);qrBlob=null;}
    const currentWelcome = ++welcomeRequest;
    root.replaceChildren();
    get("room-code").textContent = ""; get("room-role").textContent = "";
    const panel = node("section", undefined, "room-panel");
    panel.append(node("h1", "Тайна погасшего фонаря"), node("p", "Выберите число команд и награды. Каждая команда проходит вопросы и коды в своём темпе, открывает видео и помогает друзьям подсказками."));
    if (session) panel.append(button("Продолжить игру " + session.code, connect));
    const note = node("div", undefined, "room-rule");
    note.append(node("strong", "Если вы в команде"), node("p", "Попросите ведущего показать QR вашей команды и отсканируйте его этим телефоном. Другого реквизита не нужно."));
    panel.append(note); root.append(panel);
    get("leave-room").hidden = !session;
    const loading = node("p", "Загружаем параметры комнаты…", "clue-ask"); panel.append(loading);
    try {
      if (!roomConfig) roomConfig = await request("/api/config", undefined, null);
      if (welcomeRequest !== currentWelcome) return;
      loading.hidden = true;
      panel.append(window.RoomUI.roomSetup(roomConfig), button("Создать игру ведущего", newGame, !!session));
    } catch (error) {
      if (welcomeRequest !== currentWelcome) return;
      loading.hidden = true; tell("Не удалось загрузить число слотов. Проверьте интернет и попробуйте снова.");
      panel.append(button("Повторить", welcome, true));
    }
  }

  async function showInvite(teamId) {
    const team = state.teams.find(team => team.id === teamId);
    const dialog = get("invite-dialog"), image = get("invite-image"), loading = get("invite-loading");
    const current = ++inviteRequest,invitingSession=session;
    if (qrBlob) { URL.revokeObjectURL(qrBlob); qrBlob = null; }
    const link = new URL("/play.html", window.location.origin);
    link.searchParams.set("room", state.code); link.searchParams.set("team", teamId); link.searchParams.set("invite", state.invites[teamId]);
    get("invite-title").textContent = team.name;
    get("invite-link").value = link.href;
    image.hidden = true; image.removeAttribute("src"); loading.hidden = false; loading.textContent = "Создаём QR…";
    if (!dialog.open) dialog.showModal();
    try {
      const response = await fetch(`/api/rooms/${state.code}/qr/${teamId}`, { headers: { Authorization: "Bearer " + session.token }, cache: "no-store" });
      if (!response.ok) throw new Error("QR не загрузился. Скопируйте ссылку ниже.");
      const blob = await response.blob();
      if (current !== inviteRequest || !dialog.open || session!==invitingSession) return;
      qrBlob = URL.createObjectURL(blob); image.src = qrBlob; image.hidden = false; loading.hidden = true;
    } catch (error) { if (current === inviteRequest && session===invitingSession) loading.textContent = error.message; }
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
    window.clearTimeout(rewardTimer); get("room-reward").hidden = true;
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
  else await welcome();
})();
