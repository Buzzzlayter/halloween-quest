(function () {
  if (!document.body.classList.contains("preview-page")) return;
  const game = window.HALLOWEEN_GAME;
  if (!game) return;
  const title = document.querySelector("#game-title");
  if (title) title.textContent = game.title;
  const summary = document.querySelector("#game-summary");
  if (summary) summary.textContent = game.duration;
  const finale = document.querySelector("#game-finale");
  if (finale) finale.textContent = game.finale || "";
  const opening = document.querySelector("#game-opening");
  if (opening) opening.textContent = game.opening;
  const rules = document.querySelector("#game-rules");
  if (rules) {
    for (const rule of game.rules) {
      const item = document.createElement("li");
      item.textContent = rule;
      rules.append(item);
    }
  }
  for (const container of document.querySelectorAll("[data-team-list]")) {
    for (const team of game.teams) {
      const card = document.createElement("article");
      card.className = "team-card";
      card.style.setProperty("--team-accent", team.accent);
      const symbol = document.createElement("p");
      symbol.className = "team-card__symbol";
      symbol.textContent = `${team.color} · символ: ${team.symbol}`;
      const title = document.createElement("h3");
      title.textContent = `${team.icon || ""} ${team.name} — ${team.power}`.trim();
      const role = document.createElement("p");
      role.className = "team-card__role";
      role.textContent = team.role;
      card.append(symbol, title, role);
      container.append(card);
    }
  }
})();
