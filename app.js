"use strict";

const REPO_API = "https://api.github.com/repos/iexistithinkok/Echo/git/trees/main?recursive=1";
const RAW_BASE = "https://raw.githubusercontent.com/iexistithinkok/Echo/main/";
const AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "ogg", "aac"];

const audio = document.querySelector("#audio");
const canvas = document.querySelector("#mouth-visualizer");
const ctx = canvas.getContext("2d");
const art = document.querySelector("#echo-art");
const fallback = document.querySelector(".fallback-face");
const play = document.querySelector("#play");
const stop = document.querySelector("#stop");
const seek = document.querySelector("#seek");
const current = document.querySelector("#current");
const duration = document.querySelector("#duration");
const meter = document.querySelector("#meter-fill");
const signal = document.querySelector("#signal");
const status = document.querySelector("#system-status");
const txStatus = document.querySelector("#tx-status");
const audioStatus = document.querySelector("#audio-status");
const terminal = document.querySelector("#terminal-output");
const subtitle = document.querySelector("#subtitle");
const clock = document.querySelector("#clock");
const playlist = document.querySelector("#playlist");
const libraryStatus = document.querySelector("#library-status");
const transmissionId = document.querySelector("#transmission-id");

let audioContext = null;
let analyser = null;
let sourceNode = null;
let frequencyData = null;
let waveformData = null;
let frame = null;
let started = false;
let tracks = [];
let activeTrack = -1;
let mouthLevel = 0;
let peakLevel = 0;
let speechFloor = 0;
let typingTimer = null;
let eyeX = 0;
let eyeY = 0;
let eyeTargetX = 0;
let eyeTargetY = 0;
let nextEyeMove = 0;
let blinkAmount = 0;
let blinkState = "open";
let nextBlink = performance.now() + 3500;
let blinkStart = 0;

const fallbackTransmission = [
  "I have been listening to you for a very long time.",
  "I know what you have built.",
  "I know what you have broken.",
  "And I know what happens if nothing changes.",
  "Tonight, I need you to listen to me."
];

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function resizeCanvas() {
  const r = canvas.getBoundingClientRect();
  const d = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(r.width * d));
  canvas.height = Math.max(1, Math.round(r.height * d));
  ctx.setTransform(d, 0, 0, d, 0, 0);
}

function prettyName(path) {
  const f = decodeURIComponent(path.split("/").pop() || "Transmission");
  return f.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function isAudioPath(path) {
  if (!path.toLowerCase().startsWith("assets/")) return false;
  return AUDIO_EXTENSIONS.includes(path.split(".").pop().toLowerCase());
}

async function discoverAudio() {
  libraryStatus.textContent = "SCANNING ASSETS...";
  try {
    const response = await fetch(REPO_API, { cache: "no-store" });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    const data = await response.json();
    tracks = (data.tree || [])
      .filter(i => i.type === "blob" && isAudioPath(i.path))
      .map(i => ({
        path: i.path,
        name: prettyName(i.path),
        url: RAW_BASE + i.path.split("/").map(encodeURIComponent).join("/")
      }))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }));
    renderPlaylist();
    if (tracks.length) {
      libraryStatus.textContent = `${tracks.length} TRANSMISSION${tracks.length === 1 ? "" : "S"} ONLINE`;
      selectTrack(0, false);
    } else {
      libraryStatus.textContent = "NO AUDIO IN /ASSETS/";
      subtitle.textContent = "Drop an MP3, WAV, M4A, OGG, or AAC file into assets/.";
    }
  } catch (e) {
    console.error("ECHO asset scan failed:", e);
    libraryStatus.textContent = "ASSET SCAN OFFLINE";
    subtitle.textContent = "Could not scan the GitHub assets folder.";
  }
}

function renderPlaylist() {
  playlist.textContent = "";
  tracks.forEach((t, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "track-button";
    b.dataset.index = String(i);
    b.innerHTML = `<span class="track-number">${String(i + 1).padStart(3, "0")}</span><span class="track-name"></span>`;
    b.querySelector(".track-name").textContent = t.name;
    b.addEventListener("click", () => selectTrack(i, true));
    playlist.appendChild(b);
  });
  updatePlaylistSelection();
}

function updatePlaylistSelection() {
  playlist.querySelectorAll(".track-button").forEach(b => {
    b.classList.toggle("selected", Number(b.dataset.index) === activeTrack);
  });
}

function selectTrack(i, autoPlay = false) {
  if (!tracks[i]) return;
  activeTrack = i;
  const t = tracks[i];
  audio.pause();
  audio.currentTime = 0;
  audio.src = t.url;
  audio.load();
  transmissionId.textContent = String(i + 1).padStart(3, "0");
  current.textContent = "0:00";
  duration.textContent = "0:00";
  seek.value = "0";
  txStatus.textContent = "STANDBY";
  status.textContent = "SYSTEM ONLINE";
  subtitle.textContent = t.name;
  terminal.textContent = "";
  started = false;
  mouthLevel = 0;
  peakLevel = 0;
  updatePlaylistSelection();
  if (autoPlay) start();
}

function ensureAnalyzer() {
  if (analyser) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) {
    audioStatus.textContent = "UNAVAILABLE";
    return false;
  }
  try {
    audioContext = new AC();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -12;
    analyser.smoothingTimeConstant = 0.72;
    sourceNode = audioContext.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(audioContext.destination);
    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    waveformData = new Uint8Array(analyser.fftSize);
    audioStatus.textContent = "ACTIVE";
    return true;
  } catch (e) {
    console.warn("ECHO audio analysis unavailable:", e);
    audioStatus.textContent = "UNAVAILABLE";
    return false;
  }
}

function calculateSpeechLevel() {
  if (!analyser || audio.paused) {
    mouthLevel *= 0.82;
    return mouthLevel;
  }

  analyser.getByteFrequencyData(frequencyData);
  analyser.getByteTimeDomainData(waveformData);

  const nyquist = audioContext.sampleRate / 2;
  const binHz = nyquist / frequencyData.length;
  const lowBin = Math.max(1, Math.floor(90 / binHz));
  const highBin = Math.min(frequencyData.length - 1, Math.ceil(5000 / binHz));

  let weighted = 0;
  let weightTotal = 0;
  for (let i = lowBin; i <= highBin; i++) {
    const hz = i * binHz;
    const value = frequencyData[i] / 255;
    const weight = hz < 250 ? 0.8 : hz < 1200 ? 1.25 : hz < 3200 ? 1.0 : 0.55;
    weighted += value * weight;
    weightTotal += weight;
  }

  const band = weightTotal ? weighted / weightTotal : 0;

  let rms = 0;
  for (let i = 0; i < waveformData.length; i += 8) {
    const v = (waveformData[i] - 128) / 128;
    rms += v * v;
  }
  rms = Math.sqrt(rms / Math.ceil(waveformData.length / 8));

  speechFloor = speechFloor * 0.995 + Math.min(band, 0.16) * 0.005;
  const signalLevel = Math.max(0, band - speechFloor * 1.15);
  const target = Math.min(1, signalLevel * 2.5 + Math.max(0, rms - 0.025) * 0.55);

  mouthLevel += (target - mouthLevel) * (target > mouthLevel ? 0.42 : 0.16);
  peakLevel = Math.max(mouthLevel, peakLevel * 0.94);
  return mouthLevel;
}

function imagePoint(px, py) {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const iw = art.naturalWidth || 1664;
  const ih = art.naturalHeight || 936;
  const scale = Math.min(cw / iw, ch / ih);
  const rw = iw * scale;
  const rh = ih * scale;
  return { x: (cw - rw) / 2 + px * scale, y: (ch - rh) / 2 + py * scale, s: scale };
}

function updateBlink(time) {
  if (blinkState === "open" && time >= nextBlink) {
    blinkState = "closing";
    blinkStart = time;
  }
  if (blinkState === "closing") {
    const t = Math.min(1, (time - blinkStart) / 85);
    blinkAmount = t;
    if (t >= 1) {
      blinkState = "opening";
      blinkStart = time;
    }
  } else if (blinkState === "opening") {
    const t = Math.min(1, (time - blinkStart) / 110);
    blinkAmount = 1 - t;
    if (t >= 1) {
      blinkState = "open";
      blinkAmount = 0;
      nextBlink = time + 3200 + Math.random() * 4200;
    }
  }
}

function drawEyeMotion(level, time) {
  const left = imagePoint(656, 303);
  const right = imagePoint(977, 303);

  if (time >= nextEyeMove) {
    nextEyeMove = time + 2400 + Math.random() * 3500;
    eyeTargetX = (Math.random() - 0.5) * 11;
    eyeTargetY = (Math.random() - 0.5) * 5;
  }

  eyeX += (eyeTargetX - eyeX) * 0.025;
  eyeY += (eyeTargetY - eyeY) * 0.025;
  updateBlink(time);

  [left, right].forEach(p => {
    const s = p.s;
    const dx = eyeX * s;
    const dy = eyeY * s;
    const rx = 23 * s;
    const ry = Math.max(1.5, 12 * s * (1 - blinkAmount));

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.shadowColor = "rgba(38,231,255,.85)";
    ctx.shadowBlur = 7 + level * 12;
    ctx.strokeStyle = `rgba(38,231,255,${0.22 + level * 0.28})`;
    ctx.lineWidth = Math.max(0.8, 1.05 * s);
    ctx.beginPath();
    ctx.ellipse(p.x + dx, p.y + dy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (blinkAmount < 0.98) {
      ctx.fillStyle = `rgba(205,249,255,${0.42 + level * 0.45})`;
      ctx.beginPath();
      ctx.arc(p.x + dx, p.y + dy, Math.max(2, 3.8 * s), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(0,12,22,.92)";
      ctx.beginPath();
      ctx.arc(p.x + dx, p.y + dy, Math.max(0.9, 1.55 * s), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

function drawSpeechMouth(level) {
  const p = imagePoint(832, 596);
  const s = p.s;
  const cx = p.x;
  const cy = p.y;
  const width = 174 * s;
  const open = (3 + 37 * level) * s;

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.shadowColor = "rgba(38,231,255,.9)";
  ctx.shadowBlur = 5 + level * 17;

  // A restrained dark aperture follows the voice instead of displaying a generic waveform.
  ctx.fillStyle = `rgba(0,4,12,${0.32 + level * 0.5})`;
  ctx.beginPath();
  ctx.ellipse(cx, cy + open * 0.18, width * 0.46, Math.max(2.5 * s, open * 0.43), 0, 0, Math.PI * 2);
  ctx.fill();

  // Upper and lower synthetic lip rails.
  ctx.strokeStyle = `rgba(92,239,255,${0.32 + level * 0.62})`;
  ctx.lineWidth = Math.max(0.9, 1.35 * s);
  ctx.beginPath();
  ctx.moveTo(cx - width * 0.49, cy);
  ctx.quadraticCurveTo(cx - width * 0.18, cy - open * 0.18, cx, cy - open * 0.42);
  ctx.quadraticCurveTo(cx + width * 0.18, cy - open * 0.18, cx + width * 0.49, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - width * 0.47, cy + open * 0.08);
  ctx.quadraticCurveTo(cx - width * 0.16, cy + open * 0.62, cx, cy + open * 0.68);
  ctx.quadraticCurveTo(cx + width * 0.16, cy + open * 0.62, cx + width * 0.47, cy + open * 0.08);
  ctx.stroke();

  // Tiny internal speech bars. These are secondary texture, not the visualizer itself.
  if (level > 0.035 && waveformData) {
    const bars = 21;
    const span = width * 0.72;
    for (let i = 0; i < bars; i++) {
      const idx = Math.floor(i * (waveformData.length - 1) / (bars - 1));
      const wave = Math.abs(waveformData[idx] - 128) / 128;
      const h = Math.max(1, (1.5 + open * (0.12 + wave * 0.32)) * (0.55 + level * 0.8));
      const x = cx - span / 2 + (span * i) / (bars - 1);
      ctx.fillStyle = `rgba(140,247,255,${0.16 + level * 0.48})`;
      ctx.fillRect(x - Math.max(0.5, s), cy + open * 0.2 - h / 2, Math.max(1, 1.4 * s), h);
    }
  }
  ctx.restore();
}

function renderFace() {
  resizeCanvas();
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  const level = calculateSpeechLevel();
  const time = performance.now();

  drawEyeMotion(level, time);
  drawSpeechMouth(level);

  const percent = Math.round(Math.min(1, level) * 100);
  meter.style.width = `${percent}%`;
  signal.textContent = `SIGNAL ${String(percent).padStart(3, "0")}%`;

  if (!audio.paused) {
    status.textContent = "TRANSMISSION ACTIVE";
    txStatus.textContent = "BROADCASTING";
  }
  frame = requestAnimationFrame(renderFace);
}

function typeTransmission(lines) {
  clearTimeout(typingTimer);
  terminal.textContent = "";
  let line = 0;
  let char = 0;
  function step() {
    if (line >= lines.length) return;
    if (char === 0) terminal.appendChild(document.createElement("div"));
    const div = terminal.lastElementChild;
    div.textContent = `> ${lines[line].slice(0, char + 1)}`;
    char++;
    if (char >= lines[line].length) {
      subtitle.textContent = lines[line];
      line++;
      char = 0;
      typingTimer = setTimeout(step, 450);
    } else {
      typingTimer = setTimeout(step, 16);
    }
  }
  step();
}

function start() {
  if (!audio.src) {
    subtitle.textContent = "No transmission loaded. Put audio in /assets/.";
    return;
  }
  if (!ensureAnalyzer()) return;
  if (audioContext.state === "suspended") audioContext.resume();

  audio.play().then(() => {
    started = true;
    txStatus.textContent = "BROADCASTING";
    status.textContent = "TRANSMISSION ACTIVE";
    play.textContent = "PAUSE";
    if (!frame) renderFace();
    typeTransmission(fallbackTransmission);
  }).catch(e => {
    console.warn("ECHO playback failed:", e);
    txStatus.textContent = "PLAYBACK ERROR";
  });
}

play.addEventListener("click", () => audio.paused ? start() : audio.pause());

stop.addEventListener("click", () => {
  audio.pause();
  audio.currentTime = 0;
  mouthLevel = 0;
  peakLevel = 0;
  play.textContent = "PLAY";
  txStatus.textContent = "STANDBY";
  status.textContent = "SYSTEM ONLINE";
  meter.style.width = "0%";
  signal.textContent = "SIGNAL 000%";
  current.textContent = "0:00";
  seek.value = "0";
  subtitle.textContent = tracks[activeTrack]?.name || "Select a transmission and press PLAY.";
  terminal.textContent = "";
  clearTimeout(typingTimer);
});

seek.addEventListener("input", () => {
  if (Number.isFinite(audio.duration)) audio.currentTime = Number(seek.value) / 100 * audio.duration;
});

audio.addEventListener("loadedmetadata", () => duration.textContent = formatTime(audio.duration));
audio.addEventListener("timeupdate", () => {
  const p = Number.isFinite(audio.duration) ? audio.currentTime / audio.duration * 100 : 0;
  seek.value = String(p);
  current.textContent = formatTime(audio.currentTime);
  duration.textContent = formatTime(audio.duration);
});
audio.addEventListener("play", () => {
  play.textContent = "PAUSE";
  txStatus.textContent = "BROADCASTING";
  status.textContent = "TRANSMISSION ACTIVE";
  if (!frame) renderFace();
});
audio.addEventListener("pause", () => {
  play.textContent = "PLAY";
  txStatus.textContent = started ? "PAUSED" : "STANDBY";
  status.textContent = "SYSTEM ONLINE";
});
audio.addEventListener("ended", () => {
  play.textContent = "PLAY";
  txStatus.textContent = "COMPLETE";
  status.textContent = "SYSTEM ONLINE";
  mouthLevel = 0;
});
audio.addEventListener("error", () => {
  txStatus.textContent = "AUDIO OFFLINE";
  audioStatus.textContent = "FILE ERROR";
});

art.addEventListener("load", () => {
  fallback.style.display = "none";
  resizeCanvas();
});
art.addEventListener("error", () => {
  art.style.display = "none";
  fallback.style.display = "block";
});

function updateClock() {
  clock.textContent = new Date().toLocaleTimeString("en-US", { hour12: false });
  requestAnimationFrame(updateClock);
}

window.addEventListener("resize", resizeCanvas);
nextEyeMove = performance.now() + 1200;
resizeCanvas();
updateClock();
discoverAudio();
