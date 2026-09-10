"use strict";

(() => {
  const art = document.querySelector("#echo-art");
  const stage = document.querySelector(".face-stage");
  const audio = document.querySelector("#audio");
  if (!art || !stage) return;

  // Glitch the EXISTING ECHO artwork only.
  // This deliberately does not scan for or swap echo-frame images.
  let timer = null;
  let busy = false;

  const overlay = document.createElement("div");
  overlay.className = "glitch-transition";
  overlay.innerHTML = '<div class="glitch-layer glitch-main"></div><div class="glitch-layer glitch-cyan"></div><div class="glitch-layer glitch-magenta"></div>';
  stage.insertBefore(overlay, stage.querySelector(".scanline"));

  const main = overlay.querySelector(".glitch-main");
  const cyan = overlay.querySelector(".glitch-cyan");
  const magenta = overlay.querySelector(".glitch-magenta");

  function setLayers() {
    const url = art.currentSrc || art.src;
    main.style.backgroundImage = `url("${url}")`;
    cyan.style.backgroundImage = `url("${url}")`;
    magenta.style.backgroundImage = `url("${url}")`;
  }

  function glitchCurrent() {
    if (busy) return;
    busy = true;
    setLayers();
    overlay.classList.remove("is-glitching");
    void overlay.offsetWidth;
    overlay.classList.add("is-glitching");

    window.setTimeout(() => {
      overlay.classList.remove("is-glitching");
      busy = false;
      scheduleNext();
    }, 640);
  }

  function scheduleNext() {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (!audio || !audio.paused) glitchCurrent();
      else scheduleNext();
    }, 9000 + Math.random() * 7000);
  }

  art.addEventListener("load", setLayers);
  setLayers();
  scheduleNext();

  // Manual trigger remains available for testing.
  window.echoGlitch = glitchCurrent;
})();
