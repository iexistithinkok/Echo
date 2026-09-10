"use strict";

/*
  ECHO image-sequence motion layer.
  Drop matched frames in /assets/ named echo-frame-*.png.
  All frames should use the same canvas dimensions and composition.
  The existing mouth/eye canvas remains above these images.
*/

const MOTION_TREE = "https://api.github.com/repos/iexistithinkok/Echo/git/trees/main?recursive=1";
const MOTION_RAW = "https://raw.githubusercontent.com/iexistithinkok/Echo/main/";
const motionStage = document.querySelector(".face-stage");
const baseArt = document.querySelector("#echo-art");

if (motionStage && baseArt) {
  const overlay = document.createElement("img");
  overlay.id = "echo-motion-frame";
  overlay.alt = "";
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center;display:block;opacity:0;pointer-events:none;z-index:3;transition:opacity 180ms ease-in-out;";
  motionStage.insertBefore(overlay, baseArt.nextSibling);

  let frames = [];
  let current = 0;
  let timer = null;
  let busy = false;

  function preload(url) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  async function discoverFrames() {
    try {
      const r = await fetch(MOTION_TREE, {cache:"no-store"});
      if (!r.ok) return;
      const data = await r.json();
      frames = (data.tree || [])
        .filter(x => x.type === "blob" && /^assets\/echo-frame-[^/]+\.png$/i.test(x.path))
        .map(x => ({path:x.path, url:MOTION_RAW + x.path.split("/").map(encodeURIComponent).join("/")}))
        .sort((a,b) => a.path.localeCompare(b.path, undefined, {numeric:true,sensitivity:"base"}));

      if (frames.length < 2) return;
      const good = [];
      for (const f of frames) if (await preload(f.url)) good.push(f);
      frames = good;
      if (frames.length < 2) return;

      // Start from the neutral/base image and keep the sequence extremely subtle.
      current = 0;
      scheduleNext(1200);
    } catch (err) {
      console.debug("ECHO motion frames unavailable", err);
    }
  }

  function scheduleNext(delay) {
    clearTimeout(timer);
    timer = setTimeout(nextFrame, delay);
  }

  async function nextFrame() {
    if (busy || frames.length < 2) return scheduleNext(1800);
    busy = true;
    const next = (current + 1) % frames.length;
    const nextUrl = frames[next].url;
    const ok = await preload(nextUrl);
    if (!ok) { busy = false; return scheduleNext(1800); }

    overlay.src = nextUrl;
    // Crossfade rather than hard-cutting between faces.
    requestAnimationFrame(() => { overlay.style.opacity = "1"; });
    setTimeout(() => {
      baseArt.style.opacity = "0";
      overlay.style.opacity = "1";
      current = next;
      // Put the displayed frame into the base image and reset overlay.
      baseArt.src = nextUrl;
      setTimeout(() => {
        baseArt.style.opacity = "1";
        overlay.style.opacity = "0";
        busy = false;
        scheduleNext(1800 + Math.random() * 2600);
      }, 190);
    }, 180);
  }

  // Keep motion disabled until at least two deliberate matched frames exist.
  discoverFrames();
}
