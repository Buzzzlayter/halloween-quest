import assert from "node:assert/strict";
import {runFlow,request} from "./flow-api-helpers.mjs";
const base=process.argv[2];
if(!base||!/^https?:\/\//.test(base))throw new Error("Pass an explicit local or production URL");
const config=await (await request(base,"/api/config")).json();
assert.equal(config.minTeams,1);
for(const bad of [0,config.maxTeams+1,2.5,"2",null])await request(base,"/api/rooms",null,{teamCount:bad},400);
await request(base,"/api/rooms",null,{teamCount:2,scoring:{answer:-1}},400);
await Promise.all([runFlow(base,config.minTeams),runFlow(base,config.maxTeams)]);
