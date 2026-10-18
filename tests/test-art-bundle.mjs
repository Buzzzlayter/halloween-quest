// Run after a build/deploy. Compare every embedded portrait with the user's source artwork.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import sharp from "sharp";
import TEAM_ART from "../server/team-art.json" with {type:"json"};
const html=await readFile(new URL("../publish/play.html",import.meta.url),"utf8");
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]).find(text=>text.trim().startsWith("window.HALLOWEEN_MEDIA ="));
assert.ok(script,"Embedded media manifest is missing");
const context={window:{}};vm.runInNewContext(script,context);
const media=context.window.HALLOWEEN_MEDIA;
assert.equal(media.length,8);
const matched=new Set();
let total=0;
for(const [team,id] of Object.entries(TEAM_ART)) {
  const entry=media.find(m=>m.id===id);assert.ok(entry.teamIds.includes(team));
  const raw=Buffer.from(entry.art.split(",")[1],"base64");
  const source=new URL("../artwork/quest-"+String(id).padStart(2,"0")+".png",import.meta.url);
  const expected=await sharp(await readFile(source)).resize({width:384,height:384,fit:"inside",withoutEnlargement:true}).webp({quality:80}).toBuffer();
  assert.ok(raw.equals(expected),"Wrong artwork for "+team);
  matched.add(id);total+=raw.length;
}
assert.equal(matched.size,8);
console.log("PASS: all 8 team portraits exactly match artwork/*.png; embedded WebP portraits total "+Math.round(total/1024)+" KB.");
