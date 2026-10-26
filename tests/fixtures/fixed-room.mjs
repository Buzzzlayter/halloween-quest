// Regression fixture for already-created v2 rooms with the original shared scenario.
import {createRoom as createRandomRoom} from "../../server/game-engine.mjs";
import FLOW from "./legacy-flow.json" with {type:"json"};
export function createRoom(...args) {
  const room=createRandomRoom(...args);
  delete room.teamFlows;delete room.teamHints;delete room.taskCatalog;delete room.bankVersion;delete room.questionPolicy;
  delete room.codePolicy;delete room.codeTimers;
  room.flow=structuredClone(FLOW.stages);room.demo=true;
  return room;
}
