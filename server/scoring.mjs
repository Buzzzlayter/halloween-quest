import { ROUNDS } from "./scenario.mjs";
// One reward per kind/team/round, persisted with the room to prevent click farming.
export const REWARDS = {
  clue: { points: 50, label: "Поделились подсказкой" },
  plan: { points: 100, label: "Собрали верный общий ответ" },
  check: { points: 100, label: "Помогли проверить верный ответ" },
  action: { points: 50, label: "Выполнили свой шаг в общем плане" },
  solved: { points: 200, label: "Прошли этап вместе" },
  help: { points: 100, label: "Помогли другой команде — отметил ведущий" }
};
export const rewardKey = (roundId, team, kind) => `${roundId}:${team}:${kind}`;
export function award(room, team, kind, now) {
  const roundId = ROUNDS[room.roundIndex].id;
  const key = rewardKey(roundId, team, kind);
  room.scoreAwards ||= {};
  if (room.scoreAwards[key]) return false;
  const reward = REWARDS[kind];
  room.scores ||= {};
  room.scoreEvents ||= [];
  room.scoreSequence ||= 0;
  room.scoreAwards[key] = true;
  room.scores[team] = (room.scores[team] || 0) + reward.points;
  room.scoreEvents.push({ id: ++room.scoreSequence, roundId, team, kind,
    points: reward.points, label: reward.label, at: now });
  room.scoreEvents = room.scoreEvents.slice(-24);
  return true;
}
