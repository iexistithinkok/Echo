"use strict";

/*
  ECHO :)> — Global Transmission Engine
  Put audio files in /assets/ on the GitHub repository.
  The site automatically finds supported audio files and builds the vault.
*/

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
let typingTimer = null;

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
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function prettyName(path) {
  const file = decodeURIComponent(path.split("/").pop() || "Transmission");
  return file.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function isAudioPath(path) {
  if (!path.toLowerCase().startsWith("assets/")) return false;
  const ext = path.split(".").pop().toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext);
}

async function discoverAudio() {
  libraryStatus.textContent = "SCANNING ASSETS...";
  try {
    const response = await fetch(REPO_API, { cache: "no-store" });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    const data = await response.json();
    tracks = (data.tree || [])
      .filter(item => item.type === "blob" && isAudioPath(item.path))
      .map(item => ({
        path: item.path,
        name: prettyName(item.path),
        url: RAW_BASE + item.path.split("/").map(encodeURIComponent).join("/")
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
  } catch (error) {
    console.error("ECHO asset scan failed:", error);
    libraryStatus.textContent = "ASSET SCAN OFFLINE";
    subtitle.textContent = "Could not scan the GitHub assets folder.";
  }
}

function renderPlaylist() {
  playlist.textContent = "";
  tracks.forEach((track, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "track-button";
    button.dataset.index = String(index);
    button.innerHTML = `<span class="track-number">${String(index + 1).padStart(3, "0")}</span><span class="track-name"></span>`;
    button.querySelector(".track-name").textContent = track.name;
    button.addEventListener("click", () => selectTrack(index, true));
    playlist.appendChild(button);
  });
  updatePlaylistSelection();
}

function updatePlaylistSelection() {
  playlist.querySelectorAll(".track-button").forEach(button => {
    button.classList.toggle("selected", Number(button.dataset.index) === activeTrack);
  });
}

function selectTrack(index, autoPlay = false) {
  if (!tracks[index]) return;
  activeTrack = index;
  const track = tracks[index];
  audio.pause();
  audio.currentTime = 0;
  audio.src = track.url;
  audio.load();
  transmissionId.textContent = String(index + 1).padStart(3, "0");
  current.textContent = "0:00";
  duration.textContent = "0:00";
  seek.value = "0";
  txStatus.textContent = "STANDBY";
  status.textContent = "SYSTEM ONLINE";
  subtitle.textContent = track.name;
  terminal.textContent = "";
  started = false;
  updatePlaylistSelection();
  if (autoPlay) start();
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
    analyser.fftSize = 1024;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;
    analyser.smoothingTimeConstant = 0.62;
    sourceNode = audioContext.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(audioContext.destination);
    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    waveformData = new Uint8Array(analyser.fftSize);
    audioStatus.textContent = "ACTIVE";
    return true;
  } catch (error) {
    console.warn("ECHO audio analysis unavailable:", error);
    audioStatus.textContent = "UNAVAILABLE";
    return false;
  }
}

function calculateAudioLevel() {
  if (!analyser || audio.paused) return 0;
  analyser.getByteFrequencyData(frequencyData);
  analyser.getByteTimeDomainData(waveformData);

  // Speech is strongest in the low/mid frequency range. This makes the
  // mouth respond naturally to a spoken ECHO transmission without requiring
  // the audio to contain a separate lip-sync track.
  const nyquist = audioContext.sampleRate / 2;
  const binHz = nyquist / frequencyData.length;
  const lowBin = Math.max(1, Math.floor(120 / binHz));
  const highBin = Math.min(frequencyData.length - 1, Math.ceil(4200 / binHz));

  let total = 0;
  let count = 0;
  for (let i = lowBin; i <= highBin; i++) {
    total += frequencyData[i];
    count++;
  }
  const bandEnergy = count ? total / count / 255 : 0;

  let motion = 0;
  for (let i = 0; i < waveformData.length; i += 8) {
    motion += Math.abs(waveformData[i] - 128);
  }
  motion /= Math.ceil(waveformData.length / 8) * 127;

  const target = Math.min(1, bandEnergy * 1.35 + motion * 0.55);
  mouthLevel += (target - mouthLevel) * (target > mouthLevel ? 0.45 : 0.18);
  peakLevel = Math.max(mouthLevel, peakLevel * 0.96);
  return mouthLevel;
}

function drawMouth() {
  resizeCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);

  const level = calculateAudioLevel();

  // Coordinates are deliberately tied to the supplied 16:9 ECHO artwork.
  // The artwork remains untouched underneath; this is the live mouth layer.
  const cx = width * 0.505;
  const cy = height * 0.575;
  const mouthWidth = Math.min(width * 0.20, 245);
  const openHeight = Math.max(2, Math.min(height * 0.075, 42) * level);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";

  // Dark aperture covers the static mouth interior and creates the illusion
  // that the wireframe mouth is opening and closing with the voice.
  ctx.beginPath();
  ctx.moveTo(cx - mouthWidth / 2, cy);
  ctx.quadraticCurveTo(cx, cy + openHeight, cx + mouthWidth / 2, cy);
  ctx.quadraticCurveTo(cx, cy + openHeight * 0.76, cx - mouthWidth / 2, cy);
  ctx.closePath();
  ctx.fillStyle = `rgba(0, 3, 10, ${0.18 + level * 0.70})`;
  ctx.fill();

  if (level > 0.025) {
    ctx.shadowColor = "rgba(38,231,255,.95)";
    ctx.shadowBlur = 5 + level * 18;
    ctx.strokeStyle = `rgba(38,231,255,${0.30 + level * 0.70})`;
    ctx.lineWidth = 1.4 + level * 2.2;
    ctx.beginPath();
    ctx.moveTo(cx - mouthWidth / 2, cy);
    ctx.quadraticCurveTo(cx, cy + openHeight, cx + mouthWidth / 2, cy);
    ctx.stroke();
  }

  // Small internal waveform makes the mouth read as an artificial speech
  // mechanism rather than a human mouth pasted over the artwork.
  if (level > 0.12 && waveformData) {
    ctx.shadowColor = "rgba(255,63,212,.8)";
    ctx.strokeStyle = `rgba(255,63,212,${0.25 + level * 0.55})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const innerWidth = mouthWidth * 0.62;
    const start = Math.floor(waveformData.length * 0.35);
    const end = Math.floor(waveformData.length * 0.65);
    for (let i = start; i <= end; i += 3) {
      const x = cx - innerWidth / 2 + ((i - start) / (end - start)) * innerWidth;
      const y = cy + openHeight * 0.48 + ((waveformData[i] - 128) / 128) * Math.max(1, openHeight * 0.20);
      if (i === start) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  const percent = Math.round(Math.min(1, level) * 100);
  meter.style.width = `${percent}%`;
  signal.textContent = `SIGNAL ${String(percent).padStart(3, "0")}%`;

  if (!audio.paused) {
    status.textContent = "TRANSMISSION ACTIVE";
    txStatus.textContent = "BROADCASTING";
  }
  frame = requestAnimationFrame(drawMouth);
}

function typeTransmission(lines) {
  clearTimeout(typingTimer);
  terminal.textContent = "";
  let line = 0;
  let char = 0;

  function step() {
    if (line >= lines.length) return;
    if (char === 0) {
      const div = document.createElement("div");
      terminal.appendChild(div);
    }
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
    if (!frame) drawMouth();
    typeTransmission(fallbackTransmission);
  }).catch(error => {
    console.warn("ECHO playback failed:", error);
    txStatus.textContent = "PLAYBACK ERROR";
  });
}

play.addEventListener("click", () => {
  if (audio.paused) start();
  else audio.pause();
});

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
  if (Number.isFinite(audio.duration)) audio.currentTime = (Number(seek.value) / 100) * audio.duration;
});

audio.addEventListener("loadedmetadata", () => {
  duration.textContent = formatTime(audio.duration);
});

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
resizeCanvas();
updateClock();
discoverAudio();
