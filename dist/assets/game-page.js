(function () {
  if (!document.body.classList.contains("preview-page")) return;
  const game = window.HALLOWEEN_GAME;
  if (!game) return;
  const title = document.querySelector("#game-title");
  if (title) title.textContent = game.title;
  const summary = document.querySelector("#game-summary");
  if (summary) summary.textContent = game.duration;
})();
