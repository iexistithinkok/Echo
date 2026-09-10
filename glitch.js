"use strict";

(() => {
  const art = document.querySelector("#echo-art");
  const stage = document.querySelector(".face-stage");
  const audio = document.querySelector("#audio");
  if (!art || !stage) return;

  const RAW_BASE = "https://raw.githubusercontent.com/iexistithinkok/Echo/main/";
  const TREE_API = "https://api.github.com/repos/iexistithinkok/Echo/git/trees/main?recursive=1";
  const FRAME_RE = /^assets\/(echo-frame|echo-interface)[-_].+\.(png|jpg|jpeg|webp)$/i;
  let frames = [];
  let currentIndex = 0;
  let timer = null;
  let busy = false;

  const overlay = document.createElement("div");
  overlay.className = "glitch-transition";
  overlay.innerHTML = '<div class="glitch-layer glitch-main"></div><div class="glitch-layer glitch-cyan"></div><div class="glitch-layer glitch-magenta"></div>';
  stage.insertBefore(overlay, stage.querySelector(".scanline"));
  const main = overlay.querySelector(".glitch-main");
  const cyan = overlay.querySelector(".glitch-cyan");
  const magenta = overlay.querySelector(".glitch-magenta");

  function raw(path) {
    return RAW_BASE + path.split("/").map(encodeURIComponent).join("/");
  }

  function setLayers(url) {
    main.style.backgroundImage = `url("${url}")`;
    cyan.style.backgroundImage = `url("${url}")`;
    magenta.style.backgroundImage = `url("${url}")`;
  }

  function scheduleNext() {
    clearTimeout(timer);
    if (frames.length < 2) return;
    const delay = 7200 + Math.random() * 5200;
    timer = setTimeout(() => {
      if (!audio || !audio.paused) transitionToNext();
      else scheduleNext();
    }, delay);
  }

  function transitionToNext() {
    if (busy || frames.length < 2) return;
    busy = true;
    const nextIndex = (currentIndex + 1) % frames.length;
    const nextUrl = raw(frames[nextIndex]);
    const preload = new Image();
    preload.onload = () => {
      setLayers(nextUrl);
      overlay.classList.remove("is-glitching");
      void overlay.offsetWidth;
      overlay.classList.add("is-glitching");
      setTimeout(() => {
        art.src = nextUrl;
        currentIndex = nextIndex;
        overlay.classList.remove("is-glitching");
        busy = false;
        scheduleNext();
      }, 640);
    };
    preload.onerror = () => {
      busy = false;
      scheduleNext();
    };
    preload.src = nextUrl;
  }

  async function discoverFrames() {
    try {
      const response = await fetch(TREE_API, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      frames = (data.tree || [])
        .filter(item => item.type === "blob" && FRAME_RE.test(item.path))
        .map(item => item.path)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

      const currentName = decodeURIComponent((art.getAttribute("src") || "").split("/").pop() || "");
      const existing = frames.findIndex(path => path.endsWith(currentName));
      if (existing >= 0) currentIndex = existing;
      if (frames.length > 1) scheduleNext();
    } catch (error) {
      console.warn("ECHO frame scan unavailable:", error);
    }
  }

  // Optional manual trigger: window.echoGlitch() from the console or future UI.
  window.echoGlitch = transitionToNext;
  discoverFrames();
})();
