const copy=value=>JSON.parse(JSON.stringify(value));
function randomInt(limit) {
  const threshold=Math.floor(0x100000000/limit)*limit;
  let value;do {value=crypto.getRandomValues(new Uint32Array(1))[0];} while(value>=threshold);
  return value%limit;
}
function shuffle(items,pick) {
  const result=[...items];
  for(let i=result.length-1;i>0;i--){const j=pick(i+1);[result[i],result[j]]=[result[j],result[i]];}
  return result;
}
export function dealQuest(template,bank,teams,pick=randomInt) {
  const pools=new Map(),teamFlows={};
  for(const videoId of new Set(bank.questions.map(q=>q.videoId)))pools.set(videoId,shuffle(bank.questions.filter(q=>q.videoId===videoId),pick));
  const usedCodes=new Set();
  for(const team of teams) {
    teamFlows[team.id]=template.stages.map(stage=>{
      let hints;
      const result={id:stage.id,type:stage.type,title:stage.title,prompt:stage.prompt,story:stage.story,epilogue:stage.epilogue,videoIds:[...stage.videoIds]};
      if(stage.type==="questions") {
        result.questions=Array.from({length:stage.questionCount},(_,index)=>{
          const videoId=stage.questionVideoIds?.[index]||stage.videoIds[0];
          const candidate=pools.get(videoId)?.shift();
          if(!candidate)throw new Error("Не хватает вопросов для ролика "+videoId+": повторная выдача запрещена.");
          return {...copy(candidate),required:1,maxAnswers:1};
        });
        hints=result.questions.map(q=>q.prompt+" Подсказка: "+q.hint);
      } else {
        // Generate unique codes without retry loops, even with an injected deterministic RNG.
        const range=10**stage.codeLength;
        let number=pick(range),code=String(number).padStart(stage.codeLength,"0");
        while(usedCodes.has(code)){number=(number+1)%range;code=String(number).padStart(stage.codeLength,"0");}
        usedCodes.add(code);result.code=code;
        hints=[...code].map((digit,index)=>"Цифра "+(index+1)+" из "+stage.codeLength+" — "+digit+".");
      }
      result.hintParts=[...hints];
      return result;
    });
  }
  return {teamFlows};
}
