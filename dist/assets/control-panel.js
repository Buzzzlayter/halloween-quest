(function () {
  if (!document.body.classList.contains("preview-page")) return;
  const get = id => document.getElementById(id);
  const list = get("quest-list");
  if (!list) return;
  const dialog = get("quest-qr"), image = get("qr-image"), pending = get("qr-pending");
  image.addEventListener("load", () => { image.hidden = false; pending.hidden = true; });
  image.addEventListener("error", () => { image.hidden = true; pending.hidden = false; pending.textContent = "QR не загрузился. Откройте образ по ссылке."; });
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  for (const task of window.HALLOWEEN_TASKS || []) {
    const row = document.createElement("div"); row.className = "host-quest-row host-quest-row--image";
    const link = document.createElement("a"); link.className = "host-quest-link"; link.href = "?id=" + task.id;
    link.textContent = String(task.id).padStart(2, "0") + " · " + task.title;
    const qr = document.createElement("button"); qr.type = "button"; qr.className = "action-button action-button--quiet host-quest-qr"; qr.textContent = "QR";
    qr.setAttribute("aria-label", "QR образа " + task.id);
    qr.addEventListener("click", () => {
      get("qr-title").textContent = "Образ " + task.id; get("qr-name").textContent = task.title;
      get("qr-open-task").href = link.href; image.hidden = true; pending.hidden = false; pending.textContent = "Загрузка QR…";
      image.alt = "QR образа " + task.id; image.src = "qr/task-" + String(task.id).padStart(2, "0") + ".svg";
      dialog.showModal();
    });
    row.append(link, qr); list.append(row);
  }
  function openSection() {
    const section = get(window.location.hash.slice(1));
    if (section?.tagName === "DETAILS") section.open = true;
    for (let el = section?.parentElement; el; el = el.parentElement) if (el.tagName === "DETAILS") el.open = true;
  }
  window.addEventListener("hashchange", openSection); openSection();
})();
