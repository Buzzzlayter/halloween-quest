(function () {
  if (document.body.classList.contains("preview-page")) return;
  const tasks = Array.isArray(window.HALLOWEEN_TASKS) ? window.HALLOWEEN_TASKS : [];
  const taskId = Number(new URLSearchParams(window.location.search).get("id"));
  const task = tasks.find(item => item.id === taskId);
  const get = id => document.querySelector("#" + id);
  const stage = get("animation");
  if (!task) {
    get("task-title").textContent = "Образ не найден";
    get("task-kicker").textContent = "Ой!";
    get("task-prompt").textContent = "Проверьте QR-код или вернитесь на главную.";
    document.title = "Образ не найден"; return;
  }
  document.documentElement.style.setProperty("--accent", task.accent);
  get("task-kicker").textContent = `Этап ${tasks.indexOf(task) + 1} / ${tasks.length}`;
  get("task-title").textContent = task.title;
  get("task-story").textContent = task.description;
  get("task-prompt").textContent = task.text;
  document.title = task.title + " — Тайна погасшего фонаря";
  const media = document.createElement("div");
  media.className = "quest-media"; stage.append(media);
  if (task.video) renderVideo(); else renderIllustration();

  function assetUrl(value) {
    return document.querySelector(".preview-shell") ? value.replace(/^\.\.\//, "") : value;
  }

  function renderVideo() {
    stage.classList.add("animation-stage--illustrated", "animation-stage--video");
    stage.style.setProperty("--media-ratio", task.videoAspect || "1 / 1");
    stage.removeAttribute("aria-hidden");
    const video = document.createElement("video");
    video.className = "task-video";
    video.src = assetUrl(task.video);
    const poster = task.videoPoster || task.image;
    if (poster) video.poster = assetUrl(poster);
    video.muted = false;
    video.defaultMuted = false;
    video.loop = true;
    video.playsInline = true;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
    video.autoplay = !reducedMotion;
    video.preload = reducedMotion ? "none" : "metadata";
    video.setAttribute("aria-label", task.imageAlt || "Анимация к заданию");

    const controls = document.createElement("div");
    controls.className = "video-controls";
    const play = document.createElement("button");
    play.type = "button";
    controls.append(play);
    function updatePlayControl() {
      play.innerHTML = video.paused
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
      const label = video.paused ? "Воспроизвести анимацию" : "Приостановить анимацию";
      play.setAttribute("aria-label", label);
      play.title = label;
    }
    updatePlayControl();
    video.addEventListener("play", updatePlayControl);
    video.addEventListener("pause", updatePlayControl);
    play.addEventListener("click", () => {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });
    video.addEventListener("error", () => {
      stage.classList.remove("animation-stage--video");
      stage.style.removeProperty("--media-ratio");
      media.replaceChildren();
      renderIllustration();
    }, { once: true });
    media.append(video, controls);
    if (video.autoplay) video.play().catch(() => {});
  }

  function renderIllustration() {
    if (task.image) {
    stage.classList.add("animation-stage--illustrated");
    stage.dataset.motion = task.motion || "float";
    const image = document.createElement("img");
    image.className = "task-image";
    image.src = assetUrl(task.image);
    image.alt = task.imageAlt || "Иллюстрация к заданию";
    image.width = 1024;
    image.height = 1024;
    image.decoding = "async";
    image.addEventListener("error", () => {
      stage.classList.remove("animation-stage--illustrated");
      media.replaceChildren(createAnimation(task.animation));
    }, { once: true });
    stage.removeAttribute("aria-hidden");
    media.append(image);
    const atmosphere = document.createElement("div");
    atmosphere.className = "illustration-atmosphere";
    atmosphere.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 6; i++) {
      const spark = document.createElement("span");
      spark.style.setProperty("--i", i);
      atmosphere.append(spark);
    }
    media.append(atmosphere);
  } else {
    stage.dataset.animation = task.animation;
    media.append(createAnimation(task.animation));
  }
  }

  function createAnimation(type) {
    const scene = document.createElement("div");
    scene.className = `scene scene--${type}`;
    scene.setAttribute("aria-hidden", "true");

    if (type === "ghost") {
      scene.innerHTML = '<span class="ghost"><i></i><b></b></span><span class="spark spark--one"></span><span class="spark spark--two"></span>';
    } else if (type === "flame") {
      scene.innerHTML = '<span class="flame"><i></i></span><span class="ember ember--one"></span><span class="ember ember--two"></span><span class="ember ember--three"></span>';
    } else if (type === "eye") {
      scene.innerHTML = '<span class="eye"><i></i></span><span class="ripple ripple--one"></span><span class="ripple ripple--two"></span>';
    } else if (type === "bats") {
      scene.innerHTML = '<span class="moon"></span><span class="bat bat--one">◆</span><span class="bat bat--two">◆</span><span class="bat bat--three">◆</span>';
    } else {
      scene.innerHTML = '<span class="orb"><i></i></span><span class="orbit orbit--one"></span><span class="orbit orbit--two"></span>';
    }

    return scene;
  }
})();
