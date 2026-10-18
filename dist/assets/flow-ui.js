(function() {
  const {node,button}=window.RoomUI;
  const questionPrompt=text=>text.replace(/, каждый с новой строки/giu,"");
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
      el.append(node("span",team.icon),node("small",team.name),node("strong",String(team.score),"team-score"),node("small","очков"),
        node("small",team.done?"Финиш ✓":state.phase==="lobby"?(team.joined?"Подключились ✓":"Ждём"):"Этап "+(team.stageIndex+1)+"/"+state.total,"team-readiness"));
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
  function videoPanel(state,id) {
    const media=(window.HALLOWEEN_MEDIA||[]).find(m=>m.id===id);
    if(!media)return node("p","Ролик пока недоступен. Очки и результат сохранены.");
    const key=state.code+":"+state.role+":"+id;
    mediaUsed=true;
    if(mediaCache?.key===key)return mediaCache.node;
    if(mediaCache?.video)mediaCache.video.pause();
    const wrapper=node("div",undefined,"flow-video-wrap");
    const video=node("video");video.src=media.video;video.poster=media.poster;video.className="flow-video";
    video.muted=false;video.defaultMuted=false;video.loop=true;video.playsInline=true;video.preload="metadata";
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
    mediaCache={key,node:wrapper,video};
    if(video.autoplay)video.play().catch(()=>{});
    return wrapper;
  }
  function rewardVideos(panel,state,cache,handlers) {
    const videos=state.run.stageVideos||[];
    if(!videos.length)return;
    panel.append(node("h2","Открытые ролики"));
    if(!videos.includes(cache.video))cache.video=videos.at(-1);
    if(videos.length>1) {
      const row=node("div",undefined,"control-actions");
      for(const id of videos) {
        const pick=button("Ролик "+id,()=>{cache.video=id;handlers.redraw();},true);
        pick.setAttribute("aria-pressed",String(cache.video===id));row.append(pick);
      }
      panel.append(row);
    }
    panel.append(videoPanel(state,cache.video));
  }
  function hintsAndThanks(panel,state,handlers) {
    const hints=node("details",undefined,"flow-hints");
    hints.id="flow-hints-"+state.role;
    hints.append(node("summary","Мои подсказки"));
    for(const hint of state.hints||[]) {
      hints.append(node("h3",hint.title),node("p",hint.text));
    }
    panel.append(hints);
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
      for(const team of state.teams.filter(t=>t.id!==state.role))row.append(button(team.icon+" "+team.name+" +"+state.scoring.thanks,()=>{
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
  function hostPanel(state,handlers,draft) {
    const panel=node("section",undefined,"room-panel");
    panel.append(node("h1",state.phase==="finished"?"Все команды завершили игру":"Панель ведущего"),
      node("p","Команды проходят этапы самостоятельно. Ответы и коды проверяются автоматически; ниже видны засчитанные ответы и прогресс.","round-goal"));
    if(state.demo)panel.append(node("p","Демонстрационный сценарий. Вопросы, допустимые ответы, коды и подсказки заданы в server/quest-flow.json.","room-notice"));
    for(const team of state.teams) {
      const run=state.runs[team.id],section=node("details",undefined,"flow-team-review");
      section.id="flow-review-"+team.id;
      section.open=state.teams.length===1;
      section.append(node("summary",team.icon+" "+team.name+" · "+(run.done?"Финиш":"Этап "+(run.stageIndex+1)+"/"+state.total)+" · ответов: "+run.relevant+" · кодов: "+run.codes));
      const stages=state.guide.map((stage,index)=>({stage,index})).filter(({index})=>index<=run.stageIndex);
      stages.sort((a,b)=>b.index-a.index);
      for(const {stage,index} of stages) {
        const submission=run.submissions[stage.id];
        section.append(node("h3",stage.title+(index===run.stageIndex&&!run.done?" · сейчас":"")));
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
    if(state.phase==="finished")panel.append(button("Новая игра",handlers.newGame));
    return panel;
  }
  function lobby(state,handlers,draft) {
    const host=state.role==="host",own=state.teams.find(t=>t.id===state.role);
    const panel=node("section",undefined,"room-panel");
    panel.append(node("h1",host?"Подключите команды · слотов: "+state.teamCount:own.icon+" Вы — "+own.name));
    if(host) {
      if(state.demo)panel.append(node("p","Демосценарий: вопросы → код → код → код → финальные вопросы.","room-notice"));
      const grid=node("div",undefined,"invite-grid");
      for(const team of state.teams) {
        const card=node("div",undefined,"invite-card");card.style.setProperty("--team-accent",team.accent);
        card.append(node("strong",team.icon+" "+team.name),node("small",team.joined?"Подключились ✓":"Ждём телефон"),
          button("Показать QR",()=>handlers.invite(team.id),true));grid.append(card);
      }
      panel.append(grid,button("Все в сборе — начать",()=>handlers.act("start"),false,!state.teams.every(t=>t.joined)),hostSettings(state,handlers,draft));
    } else panel.append(node("p",state.teamCount===1?"Ждём старта. Все подсказки у вашей команды: отвечайте на вопросы, вводите коды и открывайте ролики.":"Ждём старта. Потом у вашей команды будут свои ответы, коды, видео и очки. Если помогли друзья — поблагодарите их бонусом."));
    return panel;
  }
  function teamPanel(state,handlers,draft) {
    const panel=node("section",undefined,"room-panel"),run=state.run;
    panel.append(progress(state,run));
    if(run.done) {
      panel.append(node("h1","Ваша команда завершила игру!"),node("div","🎃","room-end-icon"),node("p","Ролики открыты, очки сохранены. Другие команды могут продолжать. Помогайте им подсказками из пройденных этапов."));
      hintsAndThanks(panel,state,handlers);return panel;
    }
    const stage=state.stage;
    draft.flow ||= {};const key=state.role+":"+stage.id;
    const cache=draft.flow[key] ||= {answers:{},code:""};
    panel.append(node("p","Этап "+(state.roundIndex+1)+" / "+state.total+" · ваш темп","round-kicker"),node("h1",stage.title),node("p",stage.type==="questions"?questionPrompt(stage.prompt):stage.prompt,"round-goal"));
    if(run.result)panel.append(node("p",run.result,run.cleared?"room-success":"room-feedback"));
    if(run.cleared) {
      panel.append(node("p","Задание выполнено! ✦","flow-cleared"));
      panel.append(button(state.roundIndex===state.total-1?"Завершить игру":"К следующему этапу →",()=>handlers.act("continue")));
      const next=state.stages[state.roundIndex+1];
      if(next)panel.append(node("p","Дальше: "+next.title,"clue-ask"));
      rewardVideos(panel,state,cache,handlers);
    } else if(stage.type==="questions") {
      for(const q of stage.questions) {
        const label=node("label",questionPrompt(q.prompt),"flow-question");label.htmlFor="answer-"+state.role+"-"+stage.id+"-"+q.id;
        const input=node("textarea");input.id=label.htmlFor;input.rows=Math.min(4,q.maxAnswers+1);input.maxLength=160*q.maxAnswers;
        if(cache.answers[q.id]===undefined)cache.answers[q.id]=(run.submission[q.id]||[]).join("\n");
        input.value=cache.answers[q.id];input.placeholder="Можно через запятую, пробел или с новой строки";
        input.addEventListener("input",()=>{cache.answers[q.id]=input.value;});
        const count=run.accepted[q.id]||0;
        panel.append(label,input,node("p","Засчитано "+count+" · нужно "+q.required+" · максимум "+q.maxAnswers,count>=q.required?"room-success":"clue-ask"));
      }
      panel.append(button("Проверить ответы",()=>handlers.act("submitQuestions",{answers:Object.fromEntries(stage.questions.map(q=>[q.id,cache.answers[q.id]||""]))})));
      rewardVideos(panel,state,cache,handlers);
    } else {
      const label=node("label","Код","flow-question");label.htmlFor="code-"+state.role+"-"+stage.id;
      const input=node("input");input.id=label.htmlFor;input.className="flow-code";input.type="text";input.maxLength=64;input.autoComplete="off";input.value=cache.code;
      input.addEventListener("input",()=>{cache.code=input.value;});
      panel.append(label,input,button("Проверить код",()=>handlers.act("submitCode",{code:cache.code})));
    }
    hintsAndThanks(panel,state,handlers);return panel;
  }
  function render(root,state,handlers,draft) {
    const resume=mediaCache?.video&&!mediaCache.video.paused;mediaUsed=false;
    try {
      root.replaceChildren();
      if(state.phase==="closed") {root.append(node("h1","Комната закрыта"),button("Новая игра",handlers.newGame));return;}
      if(state.phase!=="lobby") {
        root.append(scoreBoard(state,handlers),node("p","Общая магия: "+state.teams.reduce((sum,t)=>sum+t.score,0)+" очков","score-total"));
        if(state.scoreEvents.length) {
          const history=node("details",undefined,"score-history");history.append(node("summary","За что получены очки"));
          history.id="flow-score-history-"+state.role;
          for(const event of state.scoreEvents.slice(-12).reverse()) {
            const team=state.teams.find(t=>t.id===event.team);
            history.append(node("p",team.icon+" "+team.name+" +"+event.points+" · "+event.label,"score-history-entry"));
          }root.append(history);
        }
      }
      if(state.phase==="lobby")root.append(lobby(state,handlers,draft));
      else if(state.role==="host")root.append(hostPanel(state,handlers,draft));
      else root.append(teamPanel(state,handlers,draft));
    } finally {
      if(mediaCache?.video) {
        if(!mediaUsed)mediaCache.video.pause();
        else if(resume)mediaCache.video.play().catch(()=>{});
      }
    }
  }
  window.FlowUI={render,scoringInputs,readScoring};
})();
