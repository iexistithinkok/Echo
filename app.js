"use strict";

// ECHO :)> — first interface prototype
// The audio engine is adapted from the working Big4Arts Music Vault architecture:
// HTMLAudioElement -> MediaElementSource -> AnalyserNode -> visualization.

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

let audioContext = null;
let analyser = null;
let sourceNode = null;
let frequencyData = null;
let waveformData = null;
let frame = null;
let started = false;

const transmission = [
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
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function ensureAnalyzer() {
  if (analyser) return true;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    audioStatus.textContent = "UNAVAILABLE";
    return false;
  }
  try {
    audioContext = new AudioContextClass();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.minDecibels = -92;
    analyser.maxDecibels = -12;
    analyser.smoothingTimeConstant = 0.78;
    sourceNode = audioContext.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(audioContext.destination);
    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    waveformData = new Uint8Array(analyser.fftSize);
    audioStatus.textContent = "ACTIVE";
    return true;
  } catch (error) {
    console.warn("ECHO audio analysis unavailable.", error);
    audioStatus.textContent = "UNAVAILABLE";
    return false;
  }
}

function drawMouth() {
  resizeCanvas();
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  let energy = 0;
  let mouthOpen = 0;
  if (analyser && !audio.paused) {
    analyser.getByteFrequencyData(frequencyData);
    analyser.getByteTimeDomainData(waveformData);

    let total = 0;
    const bins = Math.min(32, frequencyData.length);
    for (let i = 2; i < bins; i++) total += frequencyData[i];
    energy = total / Math.max(1, bins - 2) / 255;

    // Speech-responsive mouth: combine low/mid energy with waveform motion.
    let motion = 0;
    for (let i = 0; i < waveformData.length; i += 8) {
      motion += Math.abs(waveformData[i] - 128);
    }
    motion /= Math.ceil(waveformData.length / 8) * 127;
    mouthOpen = Math.min(1, energy * 0.72 + motion * 0.75);
  }

  // The artwork remains the star. This is a restrained luminous mouth overlay,
  // positioned near the center so it can sit over the ECHO artwork once supplied.
  const cx = width * 0.5;
  const cy = height * 0.55;
  const mouthWidth = Math.min(width * 0.22, 230);
  const openHeight = 3 + mouthOpen * Math.min(height * 0.075, 34);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.shadowColor = "rgba(38,231,255,.95)";
  ctx.shadowBlur = 10 + energy * 22;
  ctx.strokeStyle = `rgba(38,231,255,${0.18 + energy * 0.7})`;
  ctx.lineWidth = 2 + energy * 2;
  ctx.beginPath();
  ctx.moveTo(cx - mouthWidth / 2, cy);
  ctx.quadraticCurveTo(cx, cy + openHeight, cx + mouthWidth / 2, cy);
  ctx.stroke();

  if (mouthOpen > 0.08) {
    ctx.shadowColor = "rgba(255,63,212,.9)";
    ctx.strokeStyle = `rgba(255,63,212,${0.25 + energy * 0.7})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - mouthWidth * 0.36, cy + openHeight * 0.42);
    ctx.quadraticCurveTo(cx, cy + openHeight * 0.82, cx + mouthWidth * 0.36, cy + openHeight * 0.42);
    ctx.stroke();
  }
  ctx.restore();

  const percent = Math.round(Math.min(1, energy) * 100);
  meter.style.width = `${percent}%`;
  signal.textContent = `SIGNAL ${String(percent).padStart(3, "0")}%`;
  if (!audio.paused) {
    status.textContent = "TRANSMISSION ACTIVE";
    txStatus.textContent = "BROADCASTING";
  }
  frame = requestAnimationFrame(drawMouth);
}

function typeTransmission() {
  terminal.textContent = "";
  let line = 0;
  let char = 0;
  function step() {
    if (line >= transmission.length) return;
    if (char === 0) {
      const div = document.createElement("div");
      div.dataset.line = String(line);
      terminal.appendChild(div);
    }
    const div = terminal.lastElementChild;
    div.textContent = `> ${transmission[line].slice(0, char + 1)}`;
    char += 1;
    if (char >= transmission[line].length) {
      line += 1;
      char = 0;
      subtitle.textContent = transmission[line - 1];
      setTimeout(step, 500);
    } else {
      setTimeout(step, 18);
    }
  }
  step();
}

function start() {
  if (!ensureAnalyzer()) return;
  if (audioContext.state === "suspended") audioContext.resume();
  audio.play().then(() => {
    started = true;
    txStatus.textContent = "BROADCASTING";
    status.textContent = "TRANSMISSION ACTIVE";
    play.textContent = "PAUSE";
    if (!frame) drawMouth();
    if (!terminal.children.length) typeTransmission();
  }).catch((error) => console.warn(error));
}

play.addEventListener("click", () => {
  if (audio.paused) start();
  else audio.pause();
});

stop.addEventListener("click", () => {
  audio.pause();
  audio.currentTime = 0;
  play.textContent = "PLAY";
  txStatus.textContent = "STANDBY";
  status.textContent = "SYSTEM ONLINE";
  meter.style.width = "0%";
  signal.textContent = "SIGNAL 000%";
  subtitle.textContent = "Press PLAY to begin transmission.";
  terminal.textContent = "";
});

seek.addEventListener("input", () => {
  if (Number.isFinite(audio.duration)) audio.currentTime = (Number(seek.value) / 100) * audio.duration;
});

audio.addEventListener("loadedmetadata", () => duration.textContent = formatTime(audio.duration));
audio.addEventListener("timeupdate", () => {
  const progress = Number.isFinite(audio.duration) ? audio.currentTime / audio.duration * 100 : 0;
  seek.value = String(progress);
  current.textContent = formatTime(audio.currentTime);
  duration.textContent = formatTime(audio.duration);
});
audio.addEventListener("play", () => {
  play.textContent = "PAUSE";
  txStatus.textContent = "BROADCASTING";
  status.textContent = "TRANSMISSION ACTIVE";
  if (!frame) drawMouth();
});
audio.addEventListener("pause", () => {
  play.textContent = "PLAY";
  txStatus.textContent = started ? "PAUSED" : "STANDBY";
  status.textContent = "SYSTEM ONLINE";
});
audio.addEventListener("error", () => {
  txStatus.textContent = "AUDIO OFFLINE";
  audioStatus.textContent = "FILE NOT FOUND";
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
resizeCanvas();
typeTransmission();
updateClock();
