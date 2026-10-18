import { TEAMS, ROUNDS } from "./scenario.mjs";
import TEAM_ART from "./team-art.json" with {type:"json"};

const EXTRA_TEAMS = [
  {id:"candles", name:"Огоньки", icon:"🕯️", accent:"#ffd166", power:"Помогают найти решение"},
  {id:"watchers", name:"Стражи", icon:"👁️", accent:"#a9e178", power:"Замечают важные детали"},
  {id:"oracles", name:"Оракулы", icon:"🔮", accent:"#eb9cdb", power:"Проверяют подсказки"},
  {id:"keepers", name:"Ключники", icon:"🔑", accent:"#8fbaff", power:"Соединяют секреты"}
];
export const roomLimits = () => ({ minTeams: 1, maxTeams: ROUNDS.length, defaultTeams: Math.min(4, ROUNDS.length) });
export function teamCatalogue() {
  return ROUNDS.map((round,index) => TEAMS[index] || EXTRA_TEAMS[index-TEAMS.length] || {
    id:"guard-"+round.id, name:"Хранители "+round.id, icon:"✨", accent:"#d8b8ff", power:"Помогают общему решению"
  }).map(team=>({...team,artId:TEAM_ART[team.id]}));
}
export const teamsFor = room => room.teams || TEAMS;
export const roundsFor = room => room.rounds || ROUNDS;
const copy = value => JSON.parse(JSON.stringify(value));
const extraIngredients = [
  {id:"water",icon:"💧",label:"Капля",badges:[]}, {id:"flower",icon:"🌼",label:"Цветок",badges:[]},
  {id:"berry",icon:"🫐",label:"Ягода",badges:[]}, {id:"mushroom",icon:"🍄",label:"Гриб",badges:[]}
];
function ingredientPool(base,count) {
  const options=[...copy(base),...copy(extraIngredients)];
  for(let i=options.length;i<count+2;i++) options.push({id:"spark-"+i,icon:"✦",label:"Искра "+(i+1),badges:[]});
  return options;
}
const clue = (visual,text,ask) => ({visual,text,ask});
const clueAsk = (teams,index) => "Расскажите свою часть команде «"+teams[(index+1)%teams.length].name+"» и выслушайте остальные команды.";
const orderTeams = (teams,preferred) => [
  ...preferred.map(id=>teams.find(t=>t.id===id)).filter(Boolean),
  ...teams.filter(t=>!preferred.includes(t.id))
];
function numberedClues(teams,solution,options) {
  return Object.fromEntries(teams.map((team,i)=>[team.id,clue(
    [String(i+1),options.find(o=>o.id===solution[i]).icon],
    "На месте "+(i+1)+" — "+options.find(o=>o.id===solution[i]).label+".",
    clueAsk(teams,i)
  )]));
}
export function adaptRound(base,teams,index) {
  const round=copy(base);
  if(teams.length===TEAMS.length) return round; // Preserve existing four-team games exactly.
  const n=teams.length;
  round.captain=teams[index%n].id;
  // Distribute every original fact. Small groups get several facts per phone;
  // extra teams get a complementary check, not an empty spectator slot.
  const original=TEAMS.map(t=>base.clues[t.id]);
  round.clues=Object.fromEntries(teams.map((team,i)=>{
    const assigned=original.filter((_,j)=>j%n===i);
    if(!assigned.length) {
      if(base.kind==="choice") {
        const fact=original[i%original.length];
        assigned.push(clue(fact.visual,"Для проверки общего выбора: "+fact.text,""));
      } else {
        const position=(i-original.length)%base.solution.length;
        const option=base.options.find(o=>o.id===base.solution[position]);
        assigned.push(clue([String(position+1),option.icon],"Проверьте: на месте "+(position+1)+" должен быть знак «"+option.label+"».",""));
      }
    }
    return [team.id,clue(assigned.flatMap(c=>c.visual),assigned.map(c=>c.text).join(" "),clueAsk(teams,i))];
  }));
  if(base.id===1) round.rule="Экраны не показываем. Посланники рассказывают приметы друг другу. Капитан собирает ответ после готовности всех команд.";
  if(base.id===3) {
    round.options=ingredientPool(base.options,n);
    round.solution=[...base.solution,...round.options.map(o=>o.id).filter(id=>!base.solution.includes(id))].slice(0,n);
    round.slots=n;
    round.goal="Восстановите пароль из "+n+" знаков по памяти команд.";
    round.story="Каждая команда запоминает свою часть пароля. Весь пароль можно собрать только после обмена сообщениями.";
    round.clues=numberedClues(teams,round.solution,round.options);
  }
  if(base.id===4) {
    const captainIndex=teams.findIndex(t=>t.id===round.captain);
    const chain=[...teams.slice(captainIndex+1),...teams.slice(0,captainIndex+1)];
    const directions=["up","right","down","right","up","left","down","left"];
    round.solution=Array.from({length:n},(_,i)=>directions[i%directions.length]); round.slots=n;
    round.goal="Передайте маршрут из "+n+" стрелок и проведите мышей через туман.";
    round.rule="Цепочка сообщений: "+chain.map(t=>t.name).join(" → ")+". Последняя команда повторяет маршрут и собирает ответ.";
    round.story="У каждой команды один участок маршрута. Передавайте своё сообщение вместе с предыдущими.";
    round.clues=numberedClues(chain,round.solution,round.options);
    chain.forEach((team,i)=>{round.clues[team.id].ask=i<n-1?"Передайте собранные стрелки команде «"+chain[i+1].name+"».":"Выслушайте посланника и соберите все стрелки по порядку.";});
  }
  if(base.id===6) {
    const ordered=orderTeams(teams,base.solution);
    round.title="Лучи общего фонаря";
    round.options=teams.map(t=>({id:t.id,icon:t.icon,label:t.name,badges:[]}));
    round.solution=ordered.map(t=>t.id); round.activationOrder=[...round.solution]; round.slots=n;
    round.story="Каждая команда зажигает свой луч со своего телефона. Нужен общий порядок и участие всех.";
    round.clues=Object.fromEntries(ordered.map((team,i)=>[team.id,clue(
      [String(i+1),team.icon],
      i===0?"Ваша команда зажигает первый луч.":"Ваша команда зажигает луч сразу после команды «"+ordered[i-1].name+"».",
      i<n-1?"Передайте очередь команде «"+ordered[i+1].name+"».":"Дождитесь всех и завершите цепочку."
    )]));
    round.result="Все лучи соединились!";
  }
  if(base.id===8) {
    const ordered=orderTeams(teams,base.activationOrder);
    round.options=ingredientPool(base.options,n);
    round.solution=[...base.solution,...round.options.map(o=>o.id).filter(id=>!base.solution.includes(id))].slice(0,n);
    round.slots=n; round.activationOrder=ordered.map(t=>t.id);
    round.goal="Соберите общий рецепт: каждая команда добавит свой ингредиент.";
    round.story="У каждой команды свой ингредиент и место в рецепте. Договоритесь, а затем выполните общий план.";
    round.hint="Попросите каждую команду назвать свой ингредиент и его место. В рецепте "+n+" мест. После согласования каждая команда добавляет свою часть в нужную очередь.";
    round.clues=numberedClues(ordered,round.solution,round.options);
  }
  return round;
}
