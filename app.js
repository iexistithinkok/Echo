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

let audioContext=null, analyser=null, sourceNode=null, frequencyData=null, waveformData=null;
let frame=null, started=false, tracks=[], activeTrack=-1, mouthLevel=0, peakLevel=0, typingTimer=null;
let eyeX=0, eyeY=0, eyeTargetX=0, eyeTargetY=0, nextEyeMove=0;

const fallbackTransmission=[
  "I have been listening to you for a very long time.",
  "I know what you have built.",
  "I know what you have broken.",
  "And I know what happens if nothing changes.",
  "Tonight, I need you to listen to me."
];

function formatTime(seconds){if(!Number.isFinite(seconds)||seconds<0)return "0:00";const s=Math.floor(seconds);return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;}
function resizeCanvas(){const r=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(r.width*d));canvas.height=Math.max(1,Math.round(r.height*d));ctx.setTransform(d,0,0,d,0,0);}
function prettyName(path){const f=decodeURIComponent(path.split("/").pop()||"Transmission");return f.replace(/\.[^.]+$/," ").replace(/[_-]+/g," ").replace(/\b\w/g,c=>c.toUpperCase());}
function isAudioPath(path){if(!path.toLowerCase().startsWith("assets/"))return false;return AUDIO_EXTENSIONS.includes(path.split(".").pop().toLowerCase());}

async function discoverAudio(){
  libraryStatus.textContent="SCANNING ASSETS...";
  try{
    const response=await fetch(REPO_API,{cache:"no-store"});
    if(!response.ok)throw new Error(`GitHub API ${response.status}`);
    const data=await response.json();
    tracks=(data.tree||[]).filter(i=>i.type==="blob"&&isAudioPath(i.path)).map(i=>({path:i.path,name:prettyName(i.path),url:RAW_BASE+i.path.split("/").map(encodeURIComponent).join("/")})).sort((a,b)=>a.path.localeCompare(b.path,undefined,{numeric:true,sensitivity:"base"}));
    renderPlaylist();
    if(tracks.length){libraryStatus.textContent=`${tracks.length} TRANSMISSION${tracks.length===1?"":"S"} ONLINE`;selectTrack(0,false);}
    else{libraryStatus.textContent="NO AUDIO IN /ASSETS/";subtitle.textContent="Drop an MP3, WAV, M4A, OGG, or AAC file into assets/.";}
  }catch(e){console.error("ECHO asset scan failed:",e);libraryStatus.textContent="ASSET SCAN OFFLINE";subtitle.textContent="Could not scan the GitHub assets folder.";}
}
function renderPlaylist(){playlist.textContent="";tracks.forEach((t,i)=>{const b=document.createElement("button");b.type="button";b.className="track-button";b.dataset.index=String(i);b.innerHTML=`<span class="track-number">${String(i+1).padStart(3,"0")}</span><span class="track-name"></span>`;b.querySelector(".track-name").textContent=t.name;b.addEventListener("click",()=>selectTrack(i,true));playlist.appendChild(b);});updatePlaylistSelection();}
function updatePlaylistSelection(){playlist.querySelectorAll(".track-button").forEach(b=>b.classList.toggle("selected",Number(b.dataset.index)===activeTrack));}
function selectTrack(i,autoPlay=false){if(!tracks[i])return;activeTrack=i;const t=tracks[i];audio.pause();audio.currentTime=0;audio.src=t.url;audio.load();transmissionId.textContent=String(i+1).padStart(3,"0");current.textContent="0:00";duration.textContent="0:00";seek.value="0";txStatus.textContent="STANDBY";status.textContent="SYSTEM ONLINE";subtitle.textContent=t.name;terminal.textContent="";started=false;updatePlaylistSelection();if(autoPlay)start();}

function ensureAnalyzer(){
  if(analyser)return true;const AC=window.AudioContext||window.webkitAudioContext;if(!AC){audioStatus.textContent="UNAVAILABLE";return false;}
  try{audioContext=new AC();analyser=audioContext.createAnalyser();analyser.fftSize=1024;analyser.minDecibels=-90;analyser.maxDecibels=-10;analyser.smoothingTimeConstant=.55;sourceNode=audioContext.createMediaElementSource(audio);sourceNode.connect(analyser);analyser.connect(audioContext.destination);frequencyData=new Uint8Array(analyser.frequencyBinCount);waveformData=new Uint8Array(analyser.fftSize);audioStatus.textContent="ACTIVE";return true;}catch(e){console.warn(e);audioStatus.textContent="UNAVAILABLE";return false;}
}
function calculateAudioLevel(){
  if(!analyser||audio.paused)return 0;analyser.getByteFrequencyData(frequencyData);analyser.getByteTimeDomainData(waveformData);
  const ny=audioContext.sampleRate/2,bin=ny/frequencyData.length,lo=Math.max(1,Math.floor(100/bin)),hi=Math.min(frequencyData.length-1,Math.ceil(5000/bin));
  let total=0,count=0;for(let i=lo;i<=hi;i++){total+=frequencyData[i];count++;}const band=count?total/count/255:0;
  let motion=0;for(let i=0;i<waveformData.length;i+=4)motion+=Math.abs(waveformData[i]-128);motion/=Math.ceil(waveformData.length/4)*127;
  const target=Math.min(1,band*1.8+motion*.35);mouthLevel+=(target-mouthLevel)*(target>mouthLevel?.55:.14);peakLevel=Math.max(mouthLevel,peakLevel*.94);return mouthLevel;
}

function imagePoint(px,py){
  const cw=canvas.clientWidth,ch=canvas.clientHeight,iw=art.naturalWidth||1664,ih=art.naturalHeight||936,scale=Math.min(cw/iw,ch/ih),rw=iw*scale,rh=ih*scale;
  return {x:(cw-rw)/2+px*scale,y:(ch-rh)/2+py*scale,s:scale};
}

function drawEyes(level,time){
  // The artwork supplies the wireframe eyes; this layer adds moving iris/pupil light.
  const l=imagePoint(656,303),r=imagePoint(977,303);
  const motion=Math.sin(time*.00055)*.55;
  if(time>nextEyeMove){nextEyeMove=time+2600+Math.random()*2600;eyeTargetX=(Math.random()-.5)*10;eyeTargetY=(Math.random()-.5)*5;}
  eyeX+=(eyeTargetX-eyeX)*.035;eyeY+=(eyeTargetY-eyeY)*.035;
  [l,r].forEach((p,idx)=>{
    const dx=(eyeX+motion)*p.s,dy=eyeY*p.s,rx=25*p.s,ry=13*p.s;
    ctx.save();ctx.globalCompositeOperation="screen";ctx.shadowColor="rgba(38,231,255,.95)";ctx.shadowBlur=8+level*12;
    ctx.strokeStyle=`rgba(38,231,255,${.38+level*.35})`;ctx.lineWidth=1.2*p.s;ctx.beginPath();ctx.ellipse(p.x+dx,p.y+dy,rx,ry,0,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle=`rgba(210,250,255,${.75+level*.25})`;ctx.beginPath();ctx.arc(p.x+dx,p.y+dy,4.2*p.s,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#00111b";ctx.beginPath();ctx.arc(p.x+dx, p.y+dy,1.7*p.s,0,Math.PI*2);ctx.fill();ctx.restore();
  });
}

function drawMouth(level,time){
  const p=imagePoint(832,596),s=p.s,cx=p.x,cy=p.y;
  const width=175*s,open=(8+34*level)*s;
  ctx.save();ctx.globalCompositeOperation="screen";ctx.shadowColor="rgba(38,231,255,.9)";ctx.shadowBlur=8+level*16;
  // Dark synthetic aperture.
  ctx.fillStyle=`rgba(0,4,12,${.62+level*.25})`;ctx.beginPath();ctx.ellipse(cx,cy+open*.18,width*.5,Math.max(5*s,open*.48),0,0,Math.PI*2);ctx.fill();
  // Two segmented artificial lip rails.
  ctx.strokeStyle=`rgba(38,231,255,${.45+level*.5})`;ctx.lineWidth=1.5*s;ctx.beginPath();ctx.moveTo(cx-width*.5,cy);ctx.quadraticCurveTo(cx,cy-open*.72,cx+width*.5,cy);ctx.stroke();ctx.beginPath();ctx.moveTo(cx-width*.48,cy+open*.12);ctx.quadraticCurveTo(cx,cy+open*.72,cx+width*.48,cy+open*.12);ctx.stroke();
  // Speech bars become the internal AI vocal mechanism.
  const bars=25,barW=Math.max(1,s*2),span=width*.78;for(let i=0;i<bars;i++){const x=cx-span/2+(span*i/(bars-1)),wave=waveformData?Math.abs(waveformData[Math.floor(i*(waveformData.length-1)/(bars-1))]-128)/128:0;const h=(3+open*(.28+.72*wave))*(.35+level*.8);ctx.fillStyle=`rgba(120,242,255,${.28+level*.7})`;ctx.fillRect(x-barW/2,cy+open*.18-h/2,barW,h);}
  // Center voice pulse.
  if(level>.05){ctx.strokeStyle=`rgba(120,242,255,${.25+level*.6})`;ctx.lineWidth=s;ctx.beginPath();ctx.moveTo(cx-width*.28,cy+open*.18);ctx.lineTo(cx+width*.28,cy+open*.18);ctx.stroke();}
  ctx.restore();
}

function drawMouth(){
  resizeCanvas();const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);const level=calculateAudioLevel(),time=performance.now();
  drawEyes(level,time);if(level>.015||!audio.paused)drawMouth(level,time);
  const percent=Math.round(Math.min(1,level)*100);meter.style.width=`${percent}%`;signal.textContent=`SIGNAL ${String(percent).padStart(3,"0")}%`;
  if(!audio.paused){status.textContent="TRANSMISSION ACTIVE";txStatus.textContent="BROADCASTING";}frame=requestAnimationFrame(drawMouth);
}

function typeTransmission(lines){clearTimeout(typingTimer);terminal.textContent="";let line=0,char=0;function step(){if(line>=lines.length)return;if(char===0)terminal.appendChild(document.createElement("div"));const div=terminal.lastElementChild;div.textContent=`> ${lines[line].slice(0,char+1)}`;char++;if(char>=lines[line].length){subtitle.textContent=lines[line];line++;char=0;typingTimer=setTimeout(step,450);}else typingTimer=setTimeout(step,16);}step();}
function start(){if(!audio.src){subtitle.textContent="No transmission loaded. Put audio in /assets/.";return;}if(!ensureAnalyzer())return;if(audioContext.state==="suspended")audioContext.resume();audio.play().then(()=>{started=true;txStatus.textContent="BROADCASTING";status.textContent="TRANSMISSION ACTIVE";play.textContent="PAUSE";if(!frame)drawMouth();typeTransmission(fallbackTransmission);}).catch(e=>{console.warn(e);txStatus.textContent="PLAYBACK ERROR";});}
play.addEventListener("click",()=>audio.paused?start():audio.pause());
stop.addEventListener("click",()=>{audio.pause();audio.currentTime=0;mouthLevel=0;peakLevel=0;play.textContent="PLAY";txStatus.textContent="STANDBY";status.textContent="SYSTEM ONLINE";meter.style.width="0%";signal.textContent="SIGNAL 000%";current.textContent="0:00";seek.value="0";subtitle.textContent=tracks[activeTrack]?.name||"Select a transmission and press PLAY.";terminal.textContent="";clearTimeout(typingTimer);});
seek.addEventListener("input",()=>{if(Number.isFinite(audio.duration))audio.currentTime=Number(seek.value)/100*audio.duration;});
audio.addEventListener("loadedmetadata",()=>duration.textContent=formatTime(audio.duration));
audio.addEventListener("timeupdate",()=>{const p=Number.isFinite(audio.duration)?audio.currentTime/audio.duration*100:0;seek.value=String(p);current.textContent=formatTime(audio.currentTime);duration.textContent=formatTime(audio.duration);});
audio.addEventListener("play",()=>{play.textContent="PAUSE";txStatus.textContent="BROADCASTING";status.textContent="TRANSMISSION ACTIVE";if(!frame)drawMouth();});
audio.addEventListener("pause",()=>{play.textContent="PLAY";txStatus.textContent=started?"PAUSED":"STANDBY";status.textContent="SYSTEM ONLINE";});
audio.addEventListener("ended",()=>{play.textContent="PLAY";txStatus.textContent="COMPLETE";status.textContent="SYSTEM ONLINE";mouthLevel=0;});
audio.addEventListener("error",()=>{txStatus.textContent="AUDIO OFFLINE";audioStatus.textContent="FILE ERROR";});
art.addEventListener("load",()=>{fallback.style.display="none";resizeCanvas();});art.addEventListener("error",()=>{art.style.display="none";fallback.style.display="block";});
function updateClock(){clock.textContent=new Date().toLocaleTimeString("en-US",{hour12:false});requestAnimationFrame(updateClock);}window.addEventListener("resize",resizeCanvas);resizeCanvas();updateClock();discoverAudio();