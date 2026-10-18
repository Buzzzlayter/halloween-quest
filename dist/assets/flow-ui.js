(function() {
  const {node,button,teamArt,teamLabel,teamButton}=window.RoomUI;
  const questionPrompt=text=>text.replace(/, каждый с новой строки/giu,"");
  const activeTeams=state=>state.teams.filter(t=>t.active!==false);
  const guideFor=(state,team)=>state.guides?.[team]||state.guide;
  const pointLabels={answer:"За каждый засчитанный ответ",code:"За верный код",stage:"За завершение этапа",thanks:"Благодарность за подсказку"};
  let mediaCache=null,mediaUsed=false;
  function scoringInputs(scoring,prefix,draft) {
    const grid=node("div",undefined,"flow-scoring");
    for(const [key,label] of Object.entries(pointLabels)) {
      const wrapper=node("label",undefined,"flow-score-field");wrapper.htmlFor=prefix+"-"+key;
      const input=node("input");input.id=prefix+"-"+key;input.type="number";input.min="0";input.max="10000";input.step="1";
      input.value=String(draft?.[key] ?? scoring[key]);
      if(draft)input.addEventListener("input",()=>{draft[key]=input.value;});
      wrapper.append(node("span",label),input);grid.append(wrapper);
    }
    return grid;
  }
  const readScoring=prefix=>Object.fromEntries(Object.keys(pointLabels).map(key=>[key,Number(document.getElementById(prefix+"-"+key).value)]));
  function scoreBoard(state,handlers) {
    const roster=node("div",undefined,"room-roster");
    roster.style.setProperty("--team-columns",state.teams.length<=4?state.teams.length:state.teams.length<=6?3:4);
    for(const team of state.teams) {
      const el=node(state.role==="host"?"button":"div",undefined,"room-roster-team");
      if(state.role==="host"){el.type="button";el.title="Показать QR команды";el.addEventListener("click",()=>handlers.invite(team.id));}
      el.style.setProperty("--team-accent",team.accent);if(team.id===state.role)el.setAttribute("aria-current","true");
      el.append(teamArt(team),node("small",team.name),node("strong",String(team.score),"team-score"),node("small","очков"),
        node("small",team.active===false?"Не участвует":team.done?"Финиш ✓":state.phase==="lobby"?(team.joined?"Подключились ✓":"Ждём"):"Этап "+(team.stageIndex+1)+"/"+state.total,"team-readiness"));
      roster.append(el);
    }
    return roster;
  }
  function progress(state,run) {
    const row=node("div",undefined,"room-lamp");
    const completed=run.done?state.total:run.stageIndex+(run.cleared?1:0);
    row.setAttribute("aria-label","Пройдено этапов: "+completed+" из "+state.total);
    for(let i=0;i<state.total;i++)row.append(node("span","✦",i<completed?"lit":""));
    return row;
  }
  function hostProgress(state,team) {
    const run=state.runs[team.id],stage=guideFor(state,team.id)[run.stageIndex];
    const completed=Math.min(state.total,run.done?state.total:run.stageIndex+(run.cleared?1:0));
    let partial=0;
    if(!run.done&&!run.cleared&&stage?.type==="questions") {
      const required=stage.questions.reduce((sum,q)=>sum+q.required,0);
      const accepted=stage.questions.reduce((sum,q)=>sum+Math.min(q.required,run.acceptedByStage[stage.id]?.[q.id]||0),0);
      partial=required?accepted/required:0;
    }
    const value=Math.min(state.total,completed+partial),percent=Math.floor(value/state.total*100);
    const submitted=run.results?.[stage?.id];
    const status=team.active===false?"Не участвует · очки сохранены":run.done?"Финиш ✓":run.cleared
      ?submitted?(completed===state.total?"Ответы отправлены · ждём завершения":"Ответы отправлены · переход дальше")
      :completed===state.total?"Все задания выполнены · ждём завершения":"Этап выполнен · переход дальше"
      :"Этап "+(run.stageIndex+1)+" / "+state.total+" · "+stage.title;
    return {completed,value,percent,status};
  }
  function hostStandings(state,handlers) {
    const panel=node("section",undefined,"host-standings");
    panel.setAttribute("aria-label","Прогресс и рейтинг команд");
    panel.append(node("h2","Прогресс и рейтинг"));
    const sorted=[...state.teams].sort((a,b)=>Number(b.active!==false)-Number(a.active!==false)||b.score-a.score),top=sorted[0].score;
    const leaders=sorted.filter(team=>team.active!==false&&team.score===top);
    const lead=activeTeams(state).length===1?"Одна команда · без соперников":!top?"Очков пока нет — лидер ещё не определён"
      :leaders.length===1?"Лидер: "+leaders[0].name+" · "+top+" очков"
      :"Общее 1-е место: "+leaders.map(team=>team.name).join(", ")+" · "+top+" очков";
    panel.append(leaders.length===1&&top>0&&sorted.length>1?teamLabel(leaders[0],lead,"p","host-ranking-lead"):node("p",lead,"host-ranking-lead"));
    const list=node("ol",undefined,"host-ranking");
    let rank=0;
    for(const [index,team] of sorted.entries()) {
      if(!index||team.score!==sorted[index-1].score)rank=index+1;
      const leader=team.active!==false&&top>0&&activeTeams(state).length>1&&team.score===top;
      const row=node("li",undefined,"host-rank-row"+(leader?" host-rank-row--leader":""));
      row.dataset.team=team.id;row.dataset.rank=String(top&&team.active!==false?rank:0);
      row.style.setProperty("--team-accent",team.accent);
      const place=node("span",top&&team.active!==false?String(rank):"—","host-rank-place");
      place.setAttribute("aria-label",team.active===false?"Не участвует":top?"Место "+rank:"Место пока не определено");
      const teamButton=button("",()=>handlers.invite(team.id),true);
      teamButton.className="host-rank-team";teamButton.title="Показать QR команды";
      teamButton.setAttribute("aria-label","Показать QR команды «"+team.name+"»");
      teamButton.append(teamArt(team),node("span",team.name),node("small","QR"));
      const score=node("div",undefined,"host-rank-points");
      score.append(node("strong",String(team.score),"host-rank-score"),node("small","очков"));
      const progress=hostProgress(state,team),body=node("div",undefined,"host-rank-progress");
      const meter=node("progress");meter.max=state.total;meter.value=progress.value;
      meter.setAttribute("aria-label","Прогресс команды «"+team.name+"»");
      meter.setAttribute("aria-valuetext",progress.percent+"%, выполнено этапов: "+progress.completed+" из "+state.total);
      body.append(node("small",progress.status,"host-rank-status"),meter,
        node("small",progress.completed+" / "+state.total+" этапов · "+progress.percent+"%","host-rank-progress-label"));
      row.append(place,teamButton,score,body);list.append(row);
    }
    panel.append(list,node("p","Финишировали: "+activeTeams(state).filter(team=>team.done).length+" / "+activeTeams(state).length+" · место по очкам, прогресс по заданиям","clue-ask"));
    return panel;
  }
  function videoPanel(state,id,onEnded) {
    const media=(window.HALLOWEEN_MEDIA||[]).find(m=>m.id===id);
    if(!media)return node("p","Ролик пока недоступен. Очки и результат сохранены.");
    const key=state.code+":"+state.role+":"+id;
    mediaUsed=true;
    if(mediaCache?.key===key){mediaCache.onEnded=onEnded;return mediaCache.node;}
    if(mediaCache?.video)mediaCache.video.pause();
    const wrapper=node("div",undefined,"flow-video-wrap");
    const video=node("video");video.src=media.video;video.poster=media.poster;video.className="flow-video";
    video.muted=false;video.defaultMuted=false;video.loop=false;video.playsInline=true;video.preload="metadata";
    video.autoplay=!(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    video.setAttribute("aria-label",media.title);
    const control=button("",()=>{
      if(video.paused)return video.play().catch(()=>{});
      video.pause();
    },true);
    control.className="flow-video-control";
    function update() {
      control.innerHTML=video.paused
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
      control.setAttribute("aria-label",video.paused?"Воспроизвести ролик":"Пауза");
    }
    video.addEventListener("play",update);video.addEventListener("pause",update);update();
    const status=node("p",undefined,"flow-video-note");status.hidden=true;
    video.addEventListener("error",()=>{status.textContent="Ролик не загрузился. Проверьте интернет; результат и очки сохранены.";status.hidden=false;},{once:true});
    wrapper.append(video,control,status);
    const entry={key,node:wrapper,video,onEnded};mediaCache=entry;
    video.addEventListener("ended",()=>{if(mediaCache===entry)entry.onEnded?.();});
    if(video.autoplay)video.play().catch(()=>{});
    return wrapper;
  }
  function rewardVideos(panel,state,cache,handlers,options={}) {
    const videos=[...new Set(options.videos||state.run?.stageVideos||[])];
    if(!videos.length)return null;
    panel.append(node("h2",options.title||"Хранители ночного двора"));
    if(!videos.includes(cache.video))cache.video=videos[0];
    cache.shown ||= [];
    if(!cache.shown.includes(cache.video))cache.shown.push(cache.video);
    if(videos.length>1)panel.append(node("p","Ролик "+(videos.indexOf(cache.video)+1)+" из "+videos.length+" · дальше автоматически","clue-ask"));
    if(videos.length>1) {
      const row=node("div",undefined,"control-actions");
      for(const id of videos) {
        const pick=button((window.HALLOWEEN_MEDIA||[]).find(m=>m.id===id)?.title||"Ролик "+id,()=>{cache.video=id;handlers.redraw();},true);
        pick.setAttribute("aria-pressed",String(cache.video===id));row.append(pick);
      }
      panel.append(row);
    }
    panel.append(videoPanel(state,cache.video,()=>{
      const next=videos[videos.indexOf(cache.video)+1];
      if(next!==undefined){cache.video=next;handlers.redraw();}
    }));
    return videos.find(id=>!cache.shown.includes(id))??null;
  }
  function thanksPanel(panel,state,handlers) {
    if(state.run.done||state.teams.length<2)return;
    const thanks=node("details",undefined,"flow-thanks");
    thanks.id="flow-thanks-"+state.role+"-"+state.stage.id;
    thanks.append(node("summary","Поблагодарить за подсказку"));
    if(state.run.thanked) {
      const helper=state.teams.find(t=>t.id===state.run.thanked);
      thanks.append(node("p","На этом этапе вы уже поблагодарили команду «"+helper.name+"»."));
    } else if(!state.scoring.thanks)thanks.append(node("p","Бонусы за подсказки выключены ведущим."));
    else {
      thanks.append(node("p","Помощник получит +"+state.scoring.thanks+" очков. Ваши очки не списываются. Можно поблагодарить одну команду за этап.","clue-ask"));
      const row=node("div",undefined,"help-bonus-grid");
      for(const team of state.teams.filter(t=>t.id!==state.role&&t.active!==false))row.append(teamButton(team,team.name+" +"+state.scoring.thanks,()=>{
        if(window.confirm("Начислить +"+state.scoring.thanks+" команде «"+team.name+"» за подсказку?"))return handlers.act("thank",{helper:team.id});
      },true,!team.joined));
      thanks.append(row);
    }
    panel.append(thanks);
  }
  function hostSettings(state,handlers,draft) {
    const details=node("details",undefined,"dashboard-details");
    details.id="flow-scoring-host";
    details.append(node("summary","Настроить очки"));
    draft.scoreEdit ||= {};
    details.append(scoringInputs(state.scoring,"host-score",draft.scoreEdit),node("p","Изменения действуют на следующие начисления. Уже полученные очки не пересчитываются.","clue-ask"),
      button("Сохранить очки",()=>handlers.act("setScoring",{scoring:readScoring("host-score")}),true));
    return details;
  }
  function taskBank(state) {
    const details=node("details",undefined,"dashboard-details");details.id="flow-task-bank";
    details.append(node("summary","Банк заданий · "+state.taskCatalog.length),
      node("p","Наборы выбираются при создании комнаты. Загадки не повторяются между командами; правильные ответы видны рядом с ответами команд.","clue-ask"));
    const assigned=new Map();
    for(const team of state.teams)for(const stage of guideFor(state,team.id))for(const q of stage.questions||[])assigned.set(q.id,team);
    const list=node("ol",undefined,"flow-bank-list");
    for(const task of state.taskCatalog) {
      const team=assigned.get(task.id),item=node("li");
      if(task.videoId)item.append(node("small",(window.HALLOWEEN_MEDIA||[]).find(m=>m.id===task.videoId)?.title||"Сюжет "+task.videoId));
      item.append(node("span",task.prompt),team?teamLabel(team,team.name,"small"):node("small","В резерве"));list.append(item);
    }
    details.append(list);return details;
  }
  function participationControls(state,handlers) {
    const details=node("details",undefined,"dashboard-details");details.id="flow-participation";
    details.append(node("summary","Участие команд"),
      node("p","Отключите отсутствующую команду, чтобы не ждать её на старте или финише. Ответы и очки сохраняются. Вернуть участие можно до общего завершения.","clue-ask"));
    for(const team of state.teams) {
      const active=team.active!==false,row=node("div",undefined,"control-actions");
      row.append(teamLabel(team,team.name+" · "+(active?"участвует":"не участвует")),
        button(active?"Отключить участие":"Вернуть участие",()=>{
          if(window.confirm((active?"Отключить участие команды «":"Вернуть в игру команду «")+team.name+"»?"+(active?" Если остальные уже готовы, игра начнётся или завершится автоматически.":"")))
            return handlers.act("setTeamActive",{team:team.id,active:!active});
        },true,active&&activeTeams(state).length===1));
      details.append(row);
    }
    if(state.phase==="playing")details.append(button("Завершить с итогами",()=>{
      if(window.confirm("Завершить игру для всех сейчас? Сохраним набранные очки и откроем финальные ролики и рейтинг. Вернуться к заданиям нельзя."))
        return handlers.act("finishGame");
    },true));
    return details;
  }
  function hostPanel(state,handlers,draft) {
    const panel=node("section",undefined,"room-panel");
    panel.append(node("h1",state.phase==="finished"?"Все команды завершили игру":"Панель ведущего"),
      node("p","Команды проходят этапы самостоятельно. Ответы и коды проверяются автоматически; ниже видны засчитанные ответы и прогресс.","round-goal"));
    panel.append(hostStandings(state,handlers),participationControls(state,handlers));
    if(state.demo)panel.append(node("p","Демонстрационный сценарий. Вопросы, допустимые ответы, коды и подсказки заданы в server/quest-flow.json.","room-notice"));
    for(const team of state.teams) {
      const run=state.runs[team.id],section=node("details",undefined,"flow-team-review");
      section.id="flow-review-"+team.id;
      section.open=state.teams.length===1;
      section.append(teamLabel(team,team.name+" · "+(run.done?"Финиш":"Этап "+(run.stageIndex+1)+"/"+state.total)+" · ответов: "+run.relevant+" · кодов: "+run.codes,"summary"));
      const stages=guideFor(state,team.id).map((stage,index)=>({stage,index})).filter(({index})=>index<=run.stageIndex);
      stages.sort((a,b)=>b.index-a.index);
      for(const {stage,index} of stages) {
        const submission=run.submissions[stage.id];
        section.append(node("h3",stage.title+(index===run.stageIndex&&!run.done?" · сейчас":"")));
        const result=run.results?.[stage.id];
        if(result)section.append(node("p","Верно: "+result.correct+" / "+result.total+" · неверно: "+result.incorrect+" · пропущено: "+result.skipped+" · +"+result.points+" очков","clue-ask"));
        if(stage.type==="code") {
          section.append(node("p",(index<run.stageIndex||run.cleared?"Код принят":"Нет ответа")+" ("+stage.code+")","flow-submitted"));
        }
        for(const q of stage.questions||[]) {
          const answer=(submission?.answers?.[q.id]||[]).join(" / ")||"Нет ответа";
          section.append(node("p",questionPrompt(q.prompt)),node("p",answer+" ("+q.answers.map(a=>a.variants[0]).join("; ")+")","flow-submitted"),
            node("small","Засчитано: "+(run.acceptedByStage[stage.id]?.[q.id]||0)));
        }
      }
      panel.append(section);
    }
    if(state.phase!=="finished")panel.append(hostSettings(state,handlers,draft));
    if(state.taskCatalog)panel.append(taskBank(state));
    if(state.phase==="finished")panel.append(button("Новая игра",handlers.newGame));
    return panel;
  }
  function lobby(state,handlers,draft) {
    const host=state.role==="host",own=state.teams.find(t=>t.id===state.role);
    const panel=node("section",undefined,"room-panel");
    panel.append(host?node("h1","Подключите команды · слотов: "+state.teamCount):teamLabel(own,"Вы — "+own.name,"h1"));
    if(host) {
      if(state.demo)panel.append(node("p","Демосценарий: вопросы → код → код → код → финальные вопросы.","room-notice"));
      const grid=node("div",undefined,"invite-grid");
      for(const team of state.teams) {
        const card=node("div",undefined,"invite-card");card.style.setProperty("--team-accent",team.accent);
        card.append(teamLabel(team,team.name,"strong"),node("small",team.active===false?"Не участвует":team.joined?"Подключились ✓":"Ждём телефон"),
          button("Показать QR",()=>handlers.invite(team.id),true,team.active===false));grid.append(card);
      }
      panel.append(grid,node("p","Игра начнётся автоматически, когда подключатся все участвующие команды. Активных слотов: "+activeTeams(state).length+".","room-notice"),participationControls(state,handlers),hostSettings(state,handlers,draft));
      if(state.taskCatalog)panel.append(taskBank(state));
    } else panel.append(node("p","Вы подключились. Ждём остальные команды: когда все слоты будут заняты, игра начнётся автоматически."));
    return panel;
  }
  function questionResult(summary) {
    const result=node("section",undefined,"flow-results");
    result.setAttribute("aria-label","Результат отправки ответов");
    result.append(node("strong","Правильно: "+summary.correct+" из "+summary.total),
      node("p","Не засчитано: "+summary.notCorrect+". Неверно: "+summary.incorrect+" · пропущено: "+summary.skipped+"."),
      node("p","Начислено при отправке: +"+summary.points+" очков."));
    return result;
  }
  function storyResolution(panel,stage) {
    if(stage.epilogue)panel.append(node("p",stage.epilogue,"flow-story"));
    const solved=(stage.questions||[]).filter(q=>q.solution);
    if(!solved.length)return;
    const details=node("details",undefined,"flow-resolution");details.id="flow-resolution-"+stage.id;
    details.append(node("summary","Разбор загадок"));
    for(const q of solved)details.append(node("p",q.prompt),node("strong",q.solution.answer),node("p",q.solution.explanation,"clue-ask"));
    panel.append(details);
  }
  function finalePanel(state,handlers,draft) {
    const panel=node("section",undefined,"room-panel flow-finale");
    panel.append(node("h1","Игра завершена!"),node("p",state.finale.reason==="host"?"Ведущий завершил игру. Набранные очки сохранены — смотрим последние истории вместе.":"Все участвующие команды прошли ночной двор. Финальные очки сохранены — смотрим последние истории вместе.","round-goal"));
    const cache=draft.finale ||= {};
    const videos=cache.all?state.finale.allVideoIds:state.finale.videoIds;
    const pending=rewardVideos(panel,state,cache,handlers,{videos,title:cache.all?"Все ролики игры":"Финальные ролики"});
    if(pending!==null)panel.append(button("Следующий ролик →",()=>{cache.video=pending;handlers.redraw();}));
    panel.append(button(cache.all?"К финальным роликам":"Все ролики игры · "+state.finale.allVideoIds.length,()=>{
      cache.all=!cache.all;cache.video=(cache.all?state.finale.allVideoIds:state.finale.videoIds)[0];handlers.redraw();
    },true));
    const ranking=node("section",undefined,"final-standings");ranking.setAttribute("aria-label","Итоговый рейтинг команд");
    ranking.append(node("h2","Итоговый рейтинг"));
    const list=node("ol",undefined,"host-ranking");
    for(const team of state.finale.standings) {
      const row=node("li",undefined,"host-rank-row"+(team.rank===1&&team.score>0?" host-rank-row--leader":""));
      row.dataset.team=team.id;row.dataset.rank=String(team.rank);row.style.setProperty("--team-accent",team.accent);
      const points=node("div",undefined,"host-rank-points");points.append(node("strong",String(team.score)),node("small","очков"));
      row.append(node("span",team.rank===null?"—":String(team.rank),"host-rank-place"),teamLabel(team,team.name+(team.active===false?" · не участвует":team.done===false?" · не завершили":"")),points);list.append(row);
    }
    ranking.append(list,node("p","Финишировали: "+(state.finale.completed??state.teams.filter(t=>t.done).length)+" / "+(state.finale.activeTeams??state.teams.length),"clue-ask"));panel.append(ranking);
    if(state.role==="host")panel.append(button("Новая игра",handlers.newGame));
    return panel;
  }
  function teamPanel(state,handlers,draft) {
    const panel=node("section",undefined,"room-panel"),run=state.run;
    panel.append(progress(state,run));
    if(run.done) {
      panel.append(node("h1","Ваша команда завершила игру!"),teamArt(state.teams.find(t=>t.id===state.role),"room-end-art"),node("p","Ждём остальные команды: финишировали "+activeTeams(state).filter(t=>t.done).length+" из "+activeTeams(state).length+". После общего финиша откроются финальные ролики и рейтинг."));
      if(run.summary)panel.append(node("h2","Результат последнего этапа"),questionResult(run.summary));
      draft.finishVideo ||= {};
      rewardVideos(panel,state,draft.finishVideo,handlers);
      storyResolution(panel,state.stage);
      thanksPanel(panel,state,handlers);return panel;
    }
    const stage=state.stage;
    draft.flow ||= {};const key=state.role+":"+stage.id;
    const cache=draft.flow[key] ||= {answers:{},code:""};
    panel.append(node("p","Этап "+(state.roundIndex+1)+" / "+state.total+" · ваш темп","round-kicker"),node("h1",stage.title),node("p",stage.type==="questions"?questionPrompt(stage.prompt):stage.prompt,"round-goal"));
    if(stage.story)panel.append(node("p",stage.story,"flow-story"));
    if(run.summary)panel.append(questionResult(run.summary));
    else if(run.result)panel.append(node("p",run.result,run.cleared?"room-success":"room-feedback"));
    if(run.cleared) {
      panel.append(node("p",run.summary?"Ответы отправлены":"Задание выполнено! ✦","flow-cleared"));
      const pending=rewardVideos(panel,state,cache,handlers);
      panel.append(pending!==null?button("Следующий ролик →",()=>{cache.video=pending;handlers.redraw();})
        :button(state.roundIndex===state.total-1?"Завершить игру":"К следующему этапу →",()=>handlers.act("continue")));
      const next=state.stages[state.roundIndex+1];
      if(next)panel.append(node("p","Дальше: "+next.title,"clue-ask"));
      storyResolution(panel,stage);
    } else if(stage.type==="questions") {
      for(const q of stage.questions) {
        if(q.videoId&&q.videoId!==stage.questions[stage.questions.indexOf(q)-1]?.videoId)panel.append(node("h3",(window.HALLOWEEN_MEDIA||[]).find(m=>m.id===q.videoId)?.title||"Тайна хранителя","flow-scene-title"));
        const label=node("label",questionPrompt(q.prompt),"flow-question");label.htmlFor="answer-"+state.role+"-"+stage.id+"-"+q.id;
        const input=node("textarea");input.id=label.htmlFor;input.rows=Math.min(4,q.maxAnswers+1);input.maxLength=160*q.maxAnswers;
        if(cache.answers[q.id]===undefined)cache.answers[q.id]=(run.submission[q.id]||[]).join("\n");
        input.value=cache.answers[q.id];input.placeholder=q.maxAnswers===1?"Одно слово или число":"Короткий ответ";
        input.addEventListener("input",()=>{cache.answers[q.id]=input.value;});
        const count=run.accepted[q.id]||0;
        panel.append(label,input,node("p","Засчитано "+count+" · нужно "+q.required+" · максимум "+q.maxAnswers,count>=q.required?"room-success":"clue-ask"));
      }
      panel.append(node("p","Отправка завершает этап. Исправить ответы после отправки нельзя.","clue-ask"),
        button("Отправить ответы",()=>handlers.act("finishQuestions",{answers:Object.fromEntries(stage.questions.map(q=>[q.id,cache.answers[q.id]||""]))})));
      rewardVideos(panel,state,cache,handlers);
    } else {
      const label=node("label","Код","flow-question");label.htmlFor="code-"+state.role+"-"+stage.id;
      const input=node("input");input.id=label.htmlFor;input.className="flow-code";input.type="text";input.maxLength=64;input.autoComplete="off";input.value=cache.code;
      input.addEventListener("input",()=>{cache.code=input.value;});
      panel.append(label,input,button("Проверить код",()=>handlers.act("submitCode",{code:cache.code})));
      rewardVideos(panel,state,cache,handlers);
    }
    thanksPanel(panel,state,handlers);return panel;
  }
  function render(root,state,handlers,draft) {
    const resume=mediaCache?.video&&!mediaCache.video.paused;mediaUsed=false;
    try {
      root.replaceChildren();
      if(state.phase==="closed") {root.append(node("h1","Комната закрыта"),button("Новая игра",handlers.newGame));return;}
      if(state.phase!=="lobby"&&state.phase!=="finished") {
        if(state.role!=="host")root.append(scoreBoard(state,handlers));
        root.append(node("p","Общая магия: "+state.teams.reduce((sum,t)=>sum+t.score,0)+" очков","score-total"));
        if(state.scoreEvents.length) {
          const history=node("details",undefined,"score-history");history.append(node("summary","За что получены очки"));
          history.id="flow-score-history-"+state.role;
          for(const event of state.scoreEvents.slice(-12).reverse()) {
            const team=state.teams.find(t=>t.id===event.team);
            history.append(teamLabel(team,team.name+" +"+event.points+" · "+event.label,"p","score-history-entry"));
          }root.append(history);
        }
      }
      if(state.phase==="finished"&&state.finale)root.append(finalePanel(state,handlers,draft));
      else if(state.role!=="host"&&state.teams.find(t=>t.id===state.role)?.active===false) {
        root.append(node("h1","Участие команды приостановлено"),
          node("p","Ответы и очки сохранены. Обратитесь к ведущему, чтобы вернуться в игру. После общего завершения здесь откроются ролики и рейтинг."));
      }
      else if(state.phase==="lobby")root.append(lobby(state,handlers,draft));
      else if(state.role==="host")root.append(hostPanel(state,handlers,draft));
      else root.append(teamPanel(state,handlers,draft));
    } finally {
      if(mediaCache?.video) {
        if(!mediaUsed)mediaCache.video.pause();
        else if(resume)mediaCache.video.play().catch(()=>{});
      }
    }
  }
  function stopMedia(){mediaCache?.video?.pause();mediaCache=null;}
  window.FlowUI={render,scoringInputs,readScoring,stopMedia};
})();
