import { TEAMS, ROUNDS } from "./scenario.mjs";

export class GameError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}
const requireRule = (condition, message, status) => { if (!condition) throw new GameError(message, status); };
const token = () => crypto.randomUUID().replaceAll("-", "");
const teamIds = TEAMS.map(team => team.id);
const allReady = room => teamIds.every(id => room.ready[id]);
const clone = value => JSON.parse(JSON.stringify(value));

export function createRoom(code, now = Date.now(), makeToken = token) {
  return {
    code, createdAt: now, expiresAt: now + 6 * 60 * 60 * 1000, hostToken: makeToken(),
    members: Object.fromEntries(teamIds.map(id => [id, { invite: makeToken(), token: makeToken(), joined: false }])),
    roundIndex: 0, phase: "lobby", phaseStarted: now, version: 1, ready: {}, proposal: null,
    sparks: [], attempts: 0, ritualStep: 0, feedback: "", testMode: false,
    orders: ROUNDS.map(round => round.options.map(option => option.id).sort(() => Math.random() - 0.5))
  };
}

export function authorize(room, bearer) {
  requireRule(typeof bearer === "string" && bearer.length >= 16, "Войдите по QR-коду ведущего.", 401);
  if (bearer === room.hostToken) return "host";
  const role = teamIds.find(id => room.members[id].token === bearer && room.members[id].joined);
  requireRule(role, "Эта ссылка не даёт доступа к игре.", 401);
  return role;
}

export function joinRoom(room, team, invite) {
  requireRule(room.phase !== "closed" && room.phase !== "finished", "Игра уже завершена.");
  requireRule(teamIds.includes(team) && room.members[team].invite === invite, "Нужен QR-код именно вашей команды.", 403);
  room.members[team].joined = true;
  room.version++;
  return { code: room.code, role: team, token: room.members[team].token };
}

function newRound(room, now) {
  room.phase = "briefing"; room.phaseStarted = now; room.ready = {};
  room.proposal = null; room.attempts = 0; room.ritualStep = 0; room.feedback = "";
}
function solve(room, now) {
  const round = ROUNDS[room.roundIndex];
  if (!room.sparks.includes(round.id)) room.sparks.push(round.id);
  room.phase = "solved"; room.phaseStarted = now; room.feedback = round.result;
}
function validateItems(round, items) {
  requireRule(Array.isArray(items) && items.length === round.slots, `Нужно выбрать ${round.slots} ${round.slots === 1 ? "картинку" : "знака"}.`);
  requireRule(items.every(id => typeof id === "string" && round.options.some(option => option.id === id)), "В ответе есть неизвестный знак.");
  requireRule(round.allowRepeat || new Set(items).size === items.length, "Этот знак не должен повторяться.");
}

// Only an authenticated host in an explicitly marked test room can simulate a team.
export function dispatch(room, role, action, data = {}, now = Date.now()) {
  let actingRole = role;
  if (data.asTeam !== undefined) {
    requireRule(role === "host" && room.testMode, "Переключение команд доступно только ведущему в тестовом режиме.", 403);
    requireRule(teamIds.includes(data.asTeam), "Неизвестная тестовая команда.", 400);
    actingRole = data.asTeam;
  }
  act(room, actingRole, action, data, now);
}

export function act(room, role, action, data = {}, now = Date.now()) {
  requireRule(room.phase !== "closed", "Комната закрыта.");
  if (action === "close") {
    requireRule(role === "host", "Закрыть игру может только ведущий.", 403);
    room.phase = "closed"; room.version++; return;
  }
  requireRule(data.roundIndex === room.roundIndex, "Этап уже изменился. Дождитесь обновления экрана.");
  const round = ROUNDS[room.roundIndex];
  if (action === "setTestMode") {
    requireRule(role === "host", "Тестовый режим включает только ведущий.", 403);
    requireRule(room.phase === "lobby", "Выбрать режим можно только до начала игры.");
    requireRule(typeof data.enabled === "boolean", "Выберите режим проверки.", 400);
    room.testMode = data.enabled;
  } else if (action === "start") {
    requireRule(role === "host", "Начать игру может ведущий.", 403);
    requireRule(room.phase === "lobby", "Игра уже началась.");
    requireRule(room.testMode || teamIds.every(id => room.members[id].joined), "Сначала подключите все четыре команды.");
    newRound(room, now);
  } else if (action === "ready") {
    requireRule(role !== "host", "Готовность отмечают команды.", 403);
    if (room.phase === "answer" && room.ready[role]) return;
    requireRule(["briefing", "discussion"].includes(room.phase), "Сейчас идёт другая часть задания.");
    room.ready[role] = true;
    room.phase = allReady(room) ? "answer" : "discussion";
    if (room.phase === "answer") room.phaseStarted = now;
  } else if (action === "propose") {
    requireRule(role === round.captain, "Общий ответ собирает капитан этого этапа.", 403);
    requireRule(room.phase === "answer" && allReady(room), "Сначала обсудите подсказки всеми командами.");
    validateItems(round, data.items);
    room.proposal = { id: token(), items: [...data.items], votes: { [role]: true } };
    room.phase = "vote"; room.phaseStarted = now;
  } else if (action === "vote") {
    requireRule(role !== "host", "Решение подтверждают команды.", 403);
    requireRule(room.phase === "vote" && room.proposal?.id === data.proposalId, "Этот вариант уже изменился.");
    requireRule(typeof data.approve === "boolean", "Выберите согласие или обсуждение.");
    if (!data.approve) {
      room.proposal = null; room.ready = {}; room.phase = "discussion";
      room.feedback = `${TEAMS.find(team => team.id === role).name} просят снова обсудить подсказки.`;
    } else {
      if (room.proposal.votes[role]) return;
      room.proposal.votes[role] = true;
      if (teamIds.every(id => room.proposal.votes[id])) {
        const correct = room.proposal.items.every((id, index) => id === round.solution[index]);
        if (!correct) {
          room.attempts++; room.proposal = null; room.ready = {}; room.phase = "discussion";
          room.feedback = round.retry;
        } else if (round.activationOrder) {
          room.phase = "ritual"; room.ritualStep = 0; room.phaseStarted = now;
          room.feedback = "План согласован. Теперь каждая команда действует со своего телефона.";
        } else solve(room, now);
      }
    }
  } else if (action === "activate") {
    requireRule(role !== "host", "Этот шаг выполняет команда со своего телефона.", 403);
    requireRule(room.phase === "ritual", "Сначала согласуйте общий план.");
    requireRule(round.activationOrder[room.ritualStep] === role, "Сейчас очередь другой команды. Сверьтесь с общим планом.");
    room.ritualStep++;
    if (room.ritualStep === round.activationOrder.length) solve(room, now);
  } else if (action === "reopen") {
    requireRule(role === "host", "Подсказки открывает ведущий.", 403);
    requireRule(!["lobby", "solved", "finished"].includes(room.phase), "Сейчас подсказки открывать не нужно.");
    room.ready = {}; room.proposal = null; room.phase = "briefing"; room.ritualStep = 0;
    room.feedback = "Ведущий снова открыл подсказки. Обсудите их вместе.";
  } else if (action === "next") {
    requireRule(role === "host", "Следующий этап открывает ведущий.", 403);
    requireRule(room.phase === "solved", "Сначала решите текущее задание вместе.");
    if (room.roundIndex === ROUNDS.length - 1) {
      room.phase = "finished"; room.phaseStarted = now;
    } else { room.roundIndex++; newRound(room, now); }
  } else throw new GameError("Неизвестное действие.", 400);
  room.version++;
}

export function view(room, role) {
  const round = ROUNDS[room.roundIndex];
  const visible = !["lobby", "closed", "finished"].includes(room.phase);
  const result = {
    code: room.code, role, version: room.version, expiresAt: room.expiresAt, testMode: !!room.testMode,
    phase: room.phase, phaseStarted: room.phaseStarted, roundIndex: room.roundIndex, total: ROUNDS.length,
    sparks: [...room.sparks], attempts: room.attempts, feedback: room.feedback,
    teams: TEAMS.map(team => ({ ...team, joined: room.members[team.id].joined, ready: !!room.ready[team.id], approved: !!room.proposal?.votes[team.id] })),
    round: visible ? {
      id: round.id, title: round.title, goal: round.goal, story: round.story, rule: round.rule,
      captain: round.captain, kind: round.kind, slots: round.slots, allowRepeat: !!round.allowRepeat,
      memory: !!round.memory, ritual: !!round.activationOrder,
      options: room.orders[room.roundIndex].map(id => clone(round.options.find(option => option.id === id)))
    } : null,
    proposal: room.proposal ? { id: room.proposal.id, items: [...room.proposal.items], votes: { ...room.proposal.votes } } : null,
    ritual: room.phase === "ritual" ? { step: room.ritualStep, total: round.activationOrder.length, next: round.activationOrder[room.ritualStep] } : null
  };
  if (role === "host") {
    result.invites = Object.fromEntries(teamIds.map(id => [id, room.members[id].invite]));
    if (visible) result.guide = { clues: clone(round.clues), solution: [...round.solution], hint: round.hint, debrief: round.debrief };
    if (room.testMode) result.previews = Object.fromEntries(teamIds.map(id => [id, view(room, id)]));
  } else if (visible) {
    result.clue = round.memory && room.ready[role] ? null : clone(round.clues[role]);
    result.memoryHidden = !!(round.memory && room.ready[role]);
  }
  return result;
}
