export const normalizeAnswer = value => value.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё","е").replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim();
export const normalizeCode = value => value.normalize("NFKC").replace(/\s+/g,"").toLocaleUpperCase("ru").replaceAll("Ё","Е");
export function validateFlow(stages) {
  const validId=id=>typeof id==="string"&&/^[a-z][a-z0-9-]{0,63}$/.test(id);
  const requireConfig=ok=>{if(!ok)throw new Error("Некорректная конфигурация вопросов, кодов или подсказок.");};
  requireConfig(Array.isArray(stages)&&stages.length>0&&new Set(stages.map(s=>s.id)).size===stages.length);
  for(const stage of stages) {
    requireConfig(validId(stage.id)&&["code","questions"].includes(stage.type)&&typeof stage.title==="string");
    requireConfig(Array.isArray(stage.hintParts)&&stage.hintParts.length>0&&stage.hintParts.every(s=>typeof s==="string"&&s.trim()));
    if(stage.type==="code")requireConfig(typeof stage.code==="string"&&stage.code.trim().length>0&&stage.code.length<=64);
    else {
      requireConfig(Array.isArray(stage.questions)&&stage.questions.length>0&&stage.questions.length<=8&&new Set(stage.questions.map(q=>q.id)).size===stage.questions.length);
      for(const q of stage.questions) {
        requireConfig(validId(q.id)&&typeof q.prompt==="string"&&Array.isArray(q.answers)&&Number.isInteger(q.required)&&q.required>0&&Number.isInteger(q.maxAnswers)&&q.maxAnswers<=5&&q.maxAnswers>=q.required&&q.answers.length>=q.required);
        const aliases=new Map(),canonical=new Set();
        for(const answer of q.answers) {
          requireConfig(validId(answer.id)&&!canonical.has(answer.id)&&Array.isArray(answer.variants)&&answer.variants.length>0);canonical.add(answer.id);
          for(const variant of answer.variants) {
            requireConfig(typeof variant==="string"&&normalizeAnswer(variant));const normalized=normalizeAnswer(variant);
            requireConfig(!aliases.has(normalized)||aliases.get(normalized)===answer.id);aliases.set(normalized,answer.id);
          }
        }
      }
    }
  }
}
export function validateTaskBank(template,bank,maxTeams) {
  const requireConfig=(ok,message)=>{if(!ok)throw new Error(message);};
  requireConfig(Array.isArray(template.stages)&&template.stages.length>0,"В конфигурации нет этапов.");
  requireConfig(new Set(template.stages.map(s=>s.id)).size===template.stages.length,"Повторяются идентификаторы этапов.");
  const fixedIds=template.stages.flatMap(stage=>stage.questionIds||[]);
  requireConfig(new Set(fixedIds).size===fixedIds.length,"Общие вопросы не должны повторяться в маршруте.");
  const sceneVideos=new Set(template.stages.flatMap(stage=>[...(stage.videoIds||[]),...(stage.questionVideoIds||[])]));
  let count=0,wordCount=0;const codeCounts=new Map(),videoCounts=new Map();
  for(const stage of template.stages) {
    requireConfig(typeof stage.id==="string"&&/^[a-z][a-z0-9-]{0,63}$/.test(stage.id)&&typeof stage.title==="string"&&typeof stage.prompt==="string","Проверьте описание этапа.");
    requireConfig(Array.isArray(stage.videoIds)&&stage.videoIds.every(id=>Number.isInteger(id)&&id>0),"Проверьте ролики этапа.");
    if(stage.type==="questions") {
      requireConfig(Number.isInteger(stage.questionCount)&&stage.questionCount>=1&&stage.questionCount<=8,"Количество вопросов на этапе: от 1 до 8.");
      requireConfig(!stage.questionIds||(Array.isArray(stage.questionIds)&&stage.questionIds.length===stage.questionCount&&new Set(stage.questionIds).size===stage.questionIds.length&&stage.questionIds.every(id=>typeof id==="string")),"Проверьте список общих вопросов.");
      requireConfig(!stage.questionVideoIds||(Array.isArray(stage.questionVideoIds)&&stage.questionVideoIds.length===stage.questionCount&&stage.questionVideoIds.every(id=>Number.isInteger(id)&&id>0)),"Для каждого вопроса нужен свой ролик.");
      for(let index=0;index<stage.questionCount;index++) {
        const videoId=stage.questionVideoIds?.[index]||stage.videoIds[0];
        requireConfig(Number.isInteger(videoId)&&videoId>0,"Вопросы должны быть связаны с роликом.");
        videoCounts.set(videoId,(videoCounts.get(videoId)||0)+1);
      }
      count+=stage.questionCount;
    } else {
      requireConfig(stage.type==="code","Неизвестный тип этапа.");
      if(stage.codeType==="word")wordCount+=maxTeams;
      else {
        requireConfig(!stage.codeType&&Number.isInteger(stage.codeLength)&&stage.codeLength>=4&&stage.codeLength<=6,"Длина цифрового кода: от 4 до 6 цифр.");
        codeCounts.set(stage.codeLength,(codeCounts.get(stage.codeLength)||0)+maxTeams);
      }
    }
  }
  for(const [length,needed] of codeCounts)requireConfig(needed<=10**length,"Не хватает уникальных кодов указанной длины.");
  if(wordCount) {
    requireConfig(Array.isArray(template.codeWords)&&template.codeWords.every(word=>typeof word==="string"&&/^[а-яё]{2,24}$/iu.test(word)),"Кодовое слово: от 2 до 24 русских букв без пробелов и цифр.");
    const words=template.codeWords.map(normalizeCode);
    requireConfig(new Set(words).size===words.length,"Повторяются кодовые слова, включая регистр и е/ё.");
    requireConfig(words.length>=wordCount,"Не хватает уникальных кодовых слов: нужно "+wordCount+", есть "+words.length+".");
  }
  requireConfig(Number.isInteger(bank.version)&&bank.version>0&&Array.isArray(bank.questions),"Проверьте банк заданий.");
  requireConfig(bank.questions.length>=count,"В банке не хватает уникальных вопросов для одной команды: нужно "+count+", есть "+bank.questions.length+".");
  const ids=new Set(),prompts=new Set();
  for(const question of bank.questions) {
    const prompt=typeof question.prompt==="string"?normalizeAnswer(question.prompt):"";
    requireConfig(prompt&&!ids.has(question.id)&&!prompts.has(prompt),"В банке повторяются идентификаторы или тексты вопросов.");
    requireConfig(Number.isInteger(question.videoId)&&sceneVideos.has(question.videoId),"Укажите сюжетный ролик вопроса.");
    requireConfig(typeof question.explanation==="string"&&question.explanation.trim().length>0,"У каждого вопроса должен быть разбор решения.");
    requireConfig(question.discussion===undefined||(typeof question.discussion==="string"&&question.discussion.trim().length>0&&question.discussion.length<=150),"Вопрос для обсуждения должен быть коротким текстом.");
    requireConfig(typeof question.hint==="string"&&question.hint.trim().length>0,"У каждого вопроса должна быть подсказка.");
    requireConfig(question.required===undefined||question.required===1,"Для равных условий у загадки должен быть один ответ.");
    requireConfig(question.maxAnswers===undefined||question.maxAnswers===1,"Синонимы загадки должны давать один ответ.");
    requireConfig(question.answers?.length===1,"У загадки один ответ с несколькими допустимыми вариантами.");
    validateFlow([{id:"bank-question",type:"questions",title:"Проверка банка",hintParts:[question.hint],questions:[{...question,required:1,maxAnswers:1}]}]);
    ids.add(question.id);prompts.add(prompt);
  }
  for(const [videoId,needed] of videoCounts) {
    const available=bank.questions.filter(q=>q.videoId===videoId).length;
    requireConfig(available>=needed,"Для ролика "+videoId+" не хватает уникальных вопросов: нужно "+needed+", есть "+available+".");
  }
  for(const stage of template.stages.filter(s=>s.questionIds))for(const [index,id] of stage.questionIds.entries()) {
    const expected=stage.questionVideoIds?.[index]||stage.videoIds[0];
    requireConfig(bank.questions.some(q=>q.id===id&&q.videoId===expected),"Не найден общий вопрос "+id+" для ролика "+expected+".");
  }
  return {questionsPerTeam:count,questionsAvailable:bank.questions.length};
}
