(function () {
  const params = new URLSearchParams(window.location.search);
  if (document.body.classList.contains("preview-page")) return;
  const taskId = Number(params.get("id"));
  const tasks = Array.isArray(window.HALLOWEEN_TASKS) ? window.HALLOWEEN_TASKS : [];
  const task = tasks.find((item) => item.id === taskId);

  const shell = document.querySelector("#task");
  const stage = document.querySelector("#animation");
  const kicker = document.querySelector("#task-kicker");
  const title = document.querySelector("#task-title");
  const description = document.querySelector("#task-description");
  const instruction = document.querySelector("#task-instruction");
  const text = document.querySelector("#task-text");

  if (!task) {
    shell.classList.add("task-shell--missing");
    stage.dataset.animation = "ghost";
    stage.append(createAnimation("ghost"));
    kicker.textContent = "Ошибка";
    title.textContent = "Задание не найдено";
    description.hidden = true;
    instruction.hidden = true;
    text.textContent = "Проверьте QR-код или адрес страницы.";
    document.title = "Задание не найдено";
    return;
  }

  document.documentElement.style.setProperty("--accent", task.accent);
  kicker.textContent = task.kicker;
  title.textContent = task.title;
  description.textContent = task.description || "";
  description.hidden = !task.description;
  text.textContent = task.text;
  document.title = `${task.kicker} — ${task.title}`;

  if (task.image) {
    stage.classList.add("animation-stage--illustrated");
    stage.dataset.motion = task.motion || "float";
    const image = document.createElement("img");
    image.className = "task-image";
    image.src = document.querySelector(".preview-shell")
      ? task.image.replace(/^\.\.\//, "")
      : task.image;
    image.alt = task.imageAlt || "Иллюстрация к заданию";
    image.width = 1024;
    image.height = 1024;
    image.decoding = "async";
    image.addEventListener("error", () => {
      stage.classList.remove("animation-stage--illustrated");
      stage.setAttribute("aria-hidden", "true");
      stage.replaceChildren(createAnimation(task.animation));
    }, { once: true });
    stage.removeAttribute("aria-hidden");
    stage.append(image);
    const atmosphere = document.createElement("div");
    atmosphere.className = "illustration-atmosphere";
    atmosphere.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 6; i++) {
      const spark = document.createElement("span");
      spark.style.setProperty("--i", i);
      atmosphere.append(spark);
    }
    stage.append(atmosphere);
  } else {
    stage.dataset.animation = task.animation;
    stage.append(createAnimation(task.animation));
  }

  function createAnimation(type) {
    const scene = document.createElement("div");
    scene.className = `scene scene--${type}`;

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
