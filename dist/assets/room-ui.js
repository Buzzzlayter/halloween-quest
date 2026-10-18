(function () {
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  function button(text, fn, quiet = false, disabled = false) {
    const el = node("button", text, "action-button" + (quiet ? " action-button--quiet" : ""));
    el.type = "button"; el.disabled = disabled;
    el.addEventListener("click", async () => { el.disabled = true; try { await fn(); } finally { el.disabled = disabled; } });
    return el;
  }
  function illustratedOption(option) {
    const [color, hatOrCount, eyesOrLight, sign] = option.badges;
    const emoji = (x,y,text,size=22) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-family="Segoe UI Emoji,Apple Color Emoji,sans-serif">${text}</text>`;
    let drawing;
    if (option.icon === "👻") {
      const fill = color === "🟣" ? "#c9a2f5" : "#8acbf5";
      drawing = `<path d="M28 110V61a42 42 0 0184 0v49l-14-10-14 10-14-10-14 10-14-10z" fill="${fill}" stroke="#f9efff" stroke-width="2"/>`;
      drawing += eyesOrLight === "👀" ? '<ellipse cx="56" cy="61" rx="7" ry="10" fill="#21162d"/><ellipse cx="84" cy="61" rx="7" ry="10" fill="#21162d"/>' : '<ellipse cx="70" cy="61" rx="9" ry="12" fill="#21162d"/>';
      drawing += '<path d="M60 80q10 9 20 0" fill="none" stroke="#21162d" stroke-width="3" stroke-linecap="round"/>';
      drawing += emoji(70,36,hatOrCount,35) + emoji(99,102,sign,25);
    } else if (option.icon === "🔮") {
      drawing = `<circle cx="70" cy="66" r="41" fill="${color === "🔵" ? "#345fa9" : "#774bad"}" stroke="#c9d7ff" stroke-width="3"/><path d="M45 45q5-12 20-14" stroke="#ffffff88" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M43 105h54l8 14H35z" fill="#806899"/>`;
      drawing += emoji(70,20,eyesOrLight,22)+emoji(70,75,hatOrCount,24)+emoji(70,115,sign,25);
    } else {
      const keyColor = eyesOrLight === "🔵" ? "#74bdff" : "#c198f1";
      drawing = color === "⭕" ? `<circle cx="43" cy="42" r="24" stroke="${keyColor}" stroke-width="10" fill="none"/>` : `<path d="M43 16L70 60H16z" stroke="${keyColor}" stroke-width="9" fill="none" stroke-linejoin="round"/>`;
      drawing += `<path d="M60 60l47 47" stroke="${keyColor}" stroke-width="12" stroke-linecap="round"/>`;
      const count = hatOrCount === "2" ? 2 : 3;
      for (let i=0;i<count;i++) drawing += `<path d="M${82+i*10} ${82+i*10}l-13 13" stroke="${keyColor}" stroke-width="7"/>`;
      drawing += emoji(101,35,sign,25)+emoji(28,115,hatOrCount,22);
    }
    const el=node("span",undefined,"puzzle-art");
    el.innerHTML=`<svg viewBox="0 0 140 132" aria-hidden="true" focusable="false">${drawing}</svg>`;
    return el;
  }
  function picture(option, large = false) {
    const el = node("div", undefined, "puzzle-picture" + (large ? " puzzle-picture--large" : ""));
    el.append(option.badges.length === 4 ? illustratedOption(option) : node("span", option.icon, "puzzle-icon"));
    if (option.badges.length) {
      const badges = node("div", undefined, "puzzle-badges");
      for (const badge of option.badges) badges.append(node("span", badge));
      el.append(badges);
    }
    el.append(node("span", option.label, "puzzle-label")); return el;
  }
  const byId = (state, id) => state.round.options.find(option => option.id === id);
  function proposal(state) {
    const row = node("div", undefined, "proposal-row");
    for (const [index, id] of state.proposal.items.entries()) {
      const item = node("div", undefined, "proposal-slot");
      if (state.round.slots > 1) item.append(node("small", String(index + 1)));
      item.append(picture(byId(state, id))); row.append(item);
    }
    return row;
  }
  function roster(state, handlers) {
    const row = node("div", undefined, "room-roster");
    for (const team of state.teams) {
      const el = node(state.role === "host" ? "button" : "div", undefined, "room-roster-team");
      if (state.role === "host") {
        el.type = "button";
        el.title = "Показать QR команды";
        el.addEventListener("click", () => handlers.invite(team.id));
      }
      el.style.setProperty("--team-accent", team.accent);
      const mark = state.phase === "lobby" ? (team.joined ? "✓" : "…") : (team.approved || team.ready ? "✓" : "…");
      el.append(node("span", team.icon), node("small", team.name), node("strong", String(team.score || 0), "team-score"),
        node("small", "очков"), node("small", mark === "✓" ? "Готовы ✓" : "…", "team-readiness"));
      if (team.id === state.role) el.setAttribute("aria-current", "true");
      row.append(el);
    }
    return row;
  }

  function showReward(root, events, teams, role) {
    root.replaceChildren();
    const totals = teams.map(team => ({ ...team, gained: events.filter(event => event.team === team.id).reduce((sum, event) => sum + event.points, 0) })).filter(team => team.gained);
    const own = totals.find(team => team.id === role);
    root.append(node("strong", own ? `${own.icon} ${own.name}: +${own.gained}` : `✨ Команды получили +${totals.reduce((sum, team) => sum + team.gained, 0)}`, "reward-title"));
    root.append(node("p", [...new Set(events.filter(event => !own || event.team === role).map(event => event.label))].join(" · "), "reward-reason"));
    const row = node("div", undefined, "reward-teams");
    for (const team of totals) {
      const el = node("span", `${team.icon} ${team.name} +${team.gained}`); el.style.setProperty("--team-accent", team.accent); row.append(el);
    }
    root.append(row); root.hidden = false;
    root.classList.remove("reward-pop");
    void root.offsetWidth;
    root.classList.add("reward-pop");
  }

  function helpBonus(state, handlers) {
    const details = node("details", undefined, "dashboard-details help-bonus");
    details.append(node("summary", "+100 за помощь другой команде"), node("p", "Отметьте команду, которая объяснила подсказку, помогла договориться или заметила ошибку. Один бонус команде за этап.", "clue-ask"));
    const choices = node("div", undefined, "help-bonus-grid");
    for (const team of state.teams) choices.append(button(`${team.icon} ${team.name} ${team.helpRewarded ? "✓" : "+100"}`, () => handlers.act("helpBonus", { team: team.id }), true, team.helpRewarded));
    details.append(choices); return details;
  }

  function render(root, state, handlers, draft) {
    root.replaceChildren();
    if (state.testMode) root.append(node("p", "Тестовый режим · реальные подключения не проверяются", "room-test-banner"));
    if (state.role === "host" && state.testMode && state.previews && !["lobby", "closed", "finished"].includes(state.phase)) {
      const selectedRole = draft.testRole || "host";
      const controls = node("nav", undefined, "room-test-controls");
      controls.setAttribute("aria-label", "Тест: экран ведущего или команды");
      for (const role of [{id:"host", name:"Ведущий", icon:"🎩"}, ...state.teams]) {
        const switcher = button(role.icon + " " + role.name, () => {
          draft.testRole = role.id; draft.items = []; handlers.redraw();
        }, true);
        switcher.setAttribute("aria-pressed", String(selectedRole === role.id)); controls.append(switcher);
      }
      root.append(controls);
      if (selectedRole !== "host" && state.previews[selectedRole]) state = state.previews[selectedRole];
    }
    const host = state.role === "host";
    const own = state.teams.find(team => team.id === state.role);
    const lamp = node("div", undefined, "room-lamp");
    lamp.setAttribute("aria-label", `Собрано искр: ${state.sparks.length} из ${state.total}`);
    for (let i = 0; i < state.total; i++) lamp.append(node("span", "✦", i < state.sparks.length ? "lit" : ""));
    root.append(lamp);
    if (state.phase !== "lobby" || !host) {
      root.append(roster(state, handlers));
      root.append(node("p", `Общая магия: ${state.teams.reduce((sum, team) => sum + (team.score || 0), 0)} очков · помогаем, а не соревнуемся`, "score-total"));
    }
    if (state.scoreEvents?.length) {
      const history = node("details", undefined, "score-history");
      history.append(node("summary", "За что получены очки"));
      for (const event of state.scoreEvents.slice(-12).reverse()) {
        const team = state.teams.find(team => team.id === event.team);
        history.append(node("p", `${team.icon} ${team.name} +${event.points} · ${event.label}`, "score-history-entry"));
      }
      root.append(history);
    }
    if (["closed", "finished"].includes(state.phase)) {
      const end = node("section", undefined, "room-panel room-end");
      end.append(node("div", state.phase === "finished" ? "🎃" : "🌙", "room-end-icon"), node("h1", state.phase === "finished" ? "Фонарь Хэллоуина сияет!" : "Комната закрыта"));
      end.append(node("p", state.phase === "finished" ? "Все четыре команды помогли друг другу. Победа общая!" : "Ведущий завершил эту игру."));
      if (host) end.append(button("Новая игра", handlers.newGame));
      root.append(end); return;
    }
    if (state.phase === "lobby") {
      const panel = node("section", undefined, "room-panel");
      panel.append(node("h1", host ? "Подключите четыре команды" : `${own.icon} Вы — ${own.name}`));
      panel.append(node("p", host ? "Покажите каждой команде её QR. На всю игру достаточно подключиться один раз." : "Обсудите подсказки внутри команды. Малыши ищут символы, старшие передают сообщения. Ждём ведущего."));
      if (host) {
        const test = node("label", undefined, "room-test-toggle");
        const check = node("input"); check.type = "checkbox"; check.checked = !!state.testMode;
        check.addEventListener("change", async () => {
          check.disabled = true;
          try { await handlers.act("setTestMode", { enabled: check.checked }); }
          finally { check.disabled = false; }
        });
        test.append(check, node("span", "Тест без телефонов"));
        panel.append(test, node("p", "Галочка разрешает запуск без подключения команд. Затем можно переключаться между четырьмя командами на этом экране. Для настоящей игры создайте отдельную комнату без галочки.", "clue-ask"));
        const list = node("div", undefined, "invite-grid");
        for (const team of state.teams) {
          const item = node("div", undefined, "invite-card");
          item.style.setProperty("--team-accent", team.accent);
          item.append(node("strong", `${team.icon} ${team.name}`), node("small", team.joined ? "Подключились ✓" : state.testMode ? "Тест без подключения" : "Ждём телефон"), button("Показать QR", () => handlers.invite(team.id), true));
          list.append(item);
        }
        panel.append(list, button(state.testMode ? "Начать тест" : "Все в сборе — начать", () => handlers.act("start"), false, !state.testMode && !state.teams.every(team => team.joined)));
        const rules = node("div", undefined, "room-rule");
        rules.append(node("strong", "Перед началом"), node("p", "Один телефон у команды, один посланник на этап. Экраны с секретами друг другу не показываем. Посланников меняем. Общий ответ подтверждают все команды."));
        panel.append(rules);
      }
      root.append(panel); return;
    }

    const round = state.round;
    const captain = state.teams.find(team => team.id === round.captain);
    const panel = node("section", undefined, "room-panel");
    panel.append(node("p", `Этап ${state.roundIndex + 1} / ${state.total} · капитан: ${captain.icon} ${captain.name}`, "round-kicker"), node("h1", round.title), node("p", round.goal, "round-goal"));
    const rule = node("div", undefined, "room-rule");
    rule.append(node("strong", "Правило этого этапа"), node("p", round.rule)); panel.append(rule);
    if (state.feedback) panel.append(node("p", state.feedback, state.phase === "solved" ? "room-success" : "room-feedback"));
    if (host) panel.append(helpBonus(state, handlers));

    if (state.phase === "solved") {
      panel.append(node("div", "✦", "shared-spark"));
      if (host) {
        panel.append(node("p", state.guide.debrief, "round-goal"));
        panel.append(button(state.roundIndex === state.total - 1 ? "Все высказались — зажечь фонарь" : "Обсудили — следующий этап", () => handlers.act("next")));
      } else panel.append(node("p", "Расскажите друзьям, что помогло решить задачу. Следующий этап откроет ведущий."));
      root.append(panel); return;
    }

    if (!host) {
      const secret = node("section", undefined, "secret-clue");
      secret.style.setProperty("--team-accent", own.accent);
      secret.append(node("h2", `${own.icon} Секрет вашей команды`));
      if (state.clue) {
        secret.append(node("div", state.clue.visual.join(" "), "clue-visual"), node("p", state.clue.text, "clue-text"), node("p", state.clue.ask, "clue-ask"));
      } else secret.append(node("div", "🧠", "clue-visual"), node("p", "Подсказка спрятана. Вспомните её вместе и расскажите капитану."));
      if (["briefing", "discussion"].includes(state.phase)) {
        secret.append(state.teams.find(team => team.id === state.role).ready
          ? node("p", "Ваша команда готова ✓")
          : button(round.memory ? "Запомнили — спрятать" : "Поделились подсказкой — готовы", () => handlers.act("ready")));
      }
      panel.append(secret);
    } else panel.append(node("p", round.story, "room-story"));

    if (["briefing", "discussion", "answer"].includes(state.phase)) {
      const selecting = state.phase === "answer" && state.role === round.captain;
      panel.append(node("h2", selecting ? "Соберите общий ответ" : "Варианты для обсуждения"));
      if (selecting && round.slots > 1) {
        const row = node("div", undefined, "proposal-row draft-row");
        for (let i = 0; i < round.slots; i++) {
          const slot = node("div", undefined, "proposal-slot"); slot.append(node("small", String(i + 1)));
          slot.append(draft.items[i] ? picture(byId(state, draft.items[i])) : node("span", "?", "empty-slot")); row.append(slot);
        }
        panel.append(row, button("Убрать последний", () => { draft.items.pop(); handlers.redraw(); }, true, !draft.items.length));
      }
      const board = node("div", undefined, "picture-grid" + (round.kind === "sequence" ? " picture-grid--tokens" : ""));
      for (const option of round.options) {
        if (selecting) {
          const pick = node("button", undefined, "picture-choice"); pick.type = "button";
          pick.setAttribute("aria-label", option.label + ": " + option.badges.join(", "));
          pick.setAttribute("aria-pressed", String(draft.items.includes(option.id)));
          pick.append(picture(option));
          pick.addEventListener("click", () => {
            if (round.slots === 1) draft.items = [option.id];
            else if (draft.items.length < round.slots && (round.allowRepeat || !draft.items.includes(option.id))) draft.items.push(option.id);
            handlers.redraw();
          }); board.append(pick);
        } else board.append(picture(option));
      }
      panel.append(board);
      if (selecting) panel.append(button("Предложить командам", () => handlers.act("propose", { items: [...draft.items] }), false, draft.items.length !== round.slots));
      else panel.append(node("p", state.phase === "answer" ? `Капитан ${captain.name} собирает ответ. Помогите проверить его.` : "Сначала обсудите подсказки. Когда все команды готовы, капитан сможет собрать ответ.", "clue-ask"));
    }
    if (state.phase === "vote") {
      panel.append(node("h2", "Общий вариант"), proposal(state));
      if (!host) {
        panel.append(node("p", state.proposal.votes[state.role] ? "Ваша команда согласна ✓" : "Сверьте вариант со своей секретной подсказкой."));
        const actions = node("div", undefined, "control-actions");
        if (!state.proposal.votes[state.role]) actions.append(button("Согласны", () => handlers.act("vote", { proposalId: state.proposal.id, approve: true })));
        actions.append(button("Нужно обсудить", () => handlers.act("vote", { proposalId: state.proposal.id, approve: false }), true)); panel.append(actions);
      } else panel.append(node("p", "Ответ проверится после согласия всех четырёх команд."));
    }
    if (state.phase === "ritual") {
      const nextTeam = state.teams.find(team => team.id === state.ritual.next);
      panel.append(proposal(state), node("p", `Сейчас очередь: ${nextTeam.icon} ${nextTeam.name}`, "round-goal"));
      if (!host) panel.append(button(round.id === 8 ? "Добавить наш ингредиент" : "Зажечь наш луч", () => handlers.act("activate"), false, state.ritual.next !== state.role));
      panel.append(node("p", `${state.ritual.step} / ${state.ritual.total} команд выполнили свой шаг`, "clue-ask"));
    }
    if (host) {
      const guide = node("details", undefined, "dashboard-details");
      guide.open = !!draft.guideOpen; guide.addEventListener("toggle", () => { draft.guideOpen = guide.open; });
      guide.append(node("summary", "Подсказки ведущему"), node("p", state.guide.hint));
      for (const team of state.teams) guide.append(node("p", `${team.icon} ${team.name}: ${state.guide.clues[team.id].text}`));
      guide.append(node("strong", "Решение для помощи командам"));
      const solution = node("div", undefined, "proposal-row");
      for (const id of state.guide.solution) solution.append(picture(byId(state, id)));
      guide.append(solution, button("Снова открыть секретные подсказки", () => handlers.act("reopen"), true)); panel.append(guide);
    }
    root.append(panel);
  }
  window.RoomUI = { render, node, button, showReward };
})();
