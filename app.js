"use strict";

const REPO_API="https://api.github.com/repos/iexistithinkok/Echo/git/trees/main?recursive=1";
const RAW_BASE="https://raw.githubusercontent.com/iexistithinkok/Echo/main/";
const AUDIO_EXTENSIONS=["mp3","m4a","wav","ogg","aac","flac"];

const audio=document.querySelector("#audio");
const mouthCanvas=document.querySelector("#mouth-visualizer");
const mouthCtx=mouthCanvas.getContext("2d",{alpha:true});
const faceStage=document.querySelector(".face-stage");
const compositor=document.querySelector("#echo-face-compositor");
const faceBase=document.querySelector("#echo-face-base");
const eyeLeft=document.querySelector("#echo-eye-left");
const eyeRight=document.querySelector("#echo-eye-right");
const eyelidLeft=document.querySelector("#echo-eyelid-left");
const eyelidRight=document.querySelector("#echo-eyelid-right");
const mouthLayer=document.querySelector("#echo-mouth");
const play=document.querySelector("#play");
const stop=document.querySelector("#stop");
const seek=document.querySelector("#seek");
const current=document.querySelector("#current");
const duration=document.querySelector("#duration");
const meter=document.querySelector("#meter-fill");
const signal=document.querySelector("#signal");
const status=document.querySelector("#system-status");
const txStatus=document.querySelector("#tx-status");
const audioStatus=document.querySelector("#audio-status");
const terminal=document.querySelector("#terminal-output");
const subtitle=document.querySelector("#subtitle");
const clock=document.querySelector("#clock");
const playlist=document.querySelector("#playlist");
const libraryStatus=document.querySelector("#library-status");
const transmissionId=document.querySelector("#transmission-id");
const upload=document.querySelector("#audio-upload");
const uploadStatus=document.querySelector("#upload-status");
const trailerMode=document.querySelector("#trailer-mode");

const DEBUG_FACE=false;

const FACE={
  width:1664,
  height:936,
  eyes:[
    {cx:635,cy:514},
    {cx:1049,cy:508}
  ],
  mouth:{
    cx:842,
    cy:703,
    bbox:{x:666,y:615,w:353,h:177}
  }
};

const GAZE={maxX:12,maxY:6,saturation:500};

const FACE_ASSETS=[
  ["BASE",faceBase,"assets/echo-face-base.png"],
  ["EYE-LEFT",eyeLeft,"assets/echo-eye-left.png"],
  ["EYE-RIGHT",eyeRight,"assets/echo-eye-right.png"],
  ["EYELID-LEFT",eyelidLeft,"assets/echo-eyelid-left.png"],
  ["EYELID-RIGHT",eyelidRight,"assets/echo-eyelid-right.png"],
  ["MOUTH",mouthLayer,"assets/echo-mouth.png"]
];

let audioContext=null,analyser=null,sourceNode=null,frequencyData=null,waveformData=null;
let animationFrame=null,tracks=[],activeTrack=-1,localObjectUrl=null;
let mouthLevel=0,speechPulse=0,speechFloor=0;
let eyeX=[0,0],eyeY=[0,0];
let eyeTargetX=[0,0],eyeTargetY=[0,0];
let pointerClientX=0,pointerClientY=0,pointerActive=false,nextEyeMove=0;
let blinkAmount=0,blinkState="open",blinkStart=0,nextBlink=performance.now()+3500;
let typingTimer=null;

const fallbackTransmission=[
  "I have been listening to you for a very long time.",
  "I know what you have built.",
  "I know what you have broken.",
  "And I know what happens if nothing changes.",
  "Tonight, I need you to listen to me."
];

function formatTime(seconds){
  if(!Number.isFinite(seconds)||seconds<0)return"0:00";
  const s=Math.floor(seconds);
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
}

let faceScale=1;
let faceOffsetX=0;
let faceOffsetY=0;

function resizeFaceCompositor(){
  const r=faceStage.getBoundingClientRect();
  faceScale=Math.min(r.width/FACE.width,r.height/FACE.height);
  const width=FACE.width*faceScale;
  const height=FACE.height*faceScale;
  faceOffsetX=(r.width-width)/2;
  faceOffsetY=(r.height-height)/2;

  compositor.style.left="${faceOffsetX}px";
  compositor.style.top="${faceOffsetY}px";
  compositor.style.width="${width}px";
  compositor.style.height="${height}px";

  const d=Math.min(window.devicePixelRatio||1,2);
  mouthCanvas.style.left="${faceOffsetX}px";
  mouthCanvas.style.top="${faceOffsetY}px";
  mouthCanvas.style.width="${width}px";
  mouthCanvas.style.height="${height}px";
  mouthCanvas.width=Math.max(1,Math.round(FACE.width*d));
  mouthCanvas.height=Math.max(1,Math.round(FACE.height*d));
  mouthCtx.setTransform(d,0,0,d,0,0);
}

function pointerArtworkPoint(clientX,clientY){
  const r=faceStage.getBoundingClientRect();
  return{
    x:(clientX-r.left-faceOffsetX)/faceScale,
    y:(clientY-r.top-faceOffsetY)/faceScale
  };
}

function verifyFaceAssets(){
  FACE_ASSETS.forEach(([name,img,path])=>{
    const verify=()=>{
      if(img.naturalWidth!==FACE.width||img.naturalHeight!==FACE.height){
        console.error("[ECHO FACE] "+name+" has unexpected dimensions: "+img.naturalWidth+"x"+img.naturalHeight+"; expected 1664x936.");
      }
    };
    if(img.complete&&img.naturalWidth>0){
      verify();
    }else{
      img.addEventListener("load",verify,{once:true});
      img.addEventListener("error",()=>console.error("[ECHO FACE] Failed to load "+path),{once:true});
    }
  });
  console.info("[ECHO FACE] BASE: echo-face-base.png | EYES: echo-eye-left.png + echo-eye-right.png | EYELIDS: echo-eyelid-left.png + echo-eyelid-right.png | MOUTH: echo-mouth.png | ARCHITECTURE: FULL-CANVAS COMPOSITOR");
}

function prettyName(path){
  const f=decodeURIComponent(path.split("/").pop()||"Transmission");
  return f.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ").replace(/\b\w/g,c=>c.toUpperCase());
}

function isAudioPath(path){
  return path.toLowerCase().startsWith("assets/")&&AUDIO_EXTENSIONS.includes(path.split(".").pop().toLowerCase());
}

async function discoverAudio(){
  libraryStatus.textContent="SCANNING ASSETS...";
  try{
    const response=await fetch(REPO_API,{cache:"no-store"});
    if(!response.ok)throw new Error(`GitHub API ${response.status}`);
    const data=await response.json();
    tracks=(data.tree||[]).filter(i=>i.type==="blob"&&isAudioPath(i.path)).map(i=>({
      path:i.path,name:prettyName(i.path),
      url:RAW_BASE+i.path.split("/").map(encodeURIComponent).join("/")
    })).sort((a,b)=>a.path.localeCompare(b.path,undefined,{numeric:true,sensitivity:"base"}));
    renderPlaylist();
    if(tracks.length){
      libraryStatus.textContent=`${tracks.length} TRANSMISSION${tracks.length===1?"":"S"} ONLINE`;
      selectTrack(0,false);
    }else{
      libraryStatus.textContent="NO AUDIO IN /ASSETS/";
      subtitle.textContent="Load an audio file to create a trailer, or add one to assets/.";
    }
  }catch(e){
    console.warn("ECHO asset scan failed:",e);
    libraryStatus.textContent="ASSET SCAN OFFLINE";
    subtitle.textContent="Load an audio file to play locally.";
  }
}

function renderPlaylist(){
  playlist.textContent="";
  tracks.forEach((t,i)=>{
    const b=document.createElement("button");
    b.type="button";b.className="track-button";b.dataset.index=String(i);
    b.innerHTML=`<span class="track-number">${String(i+1).padStart(3,"0")}</span><span class="track-name"></span>`;
    b.querySelector(".track-name").textContent=t.name;
    b.addEventListener("click",()=>selectTrack(i,true));
    playlist.appendChild(b);
  });
  updatePlaylistSelection();
}

function updatePlaylistSelection(){
  playlist.querySelectorAll(".track-button").forEach(b=>b.classList.toggle("selected",Number(b.dataset.index)===activeTrack));
}

function setAudioSource(url,isLocal,name){
  audio.pause();
  audio.currentTime=0;
  audio.removeAttribute("crossorigin");
  if(!isLocal)audio.crossOrigin="anonymous";
  audio.src=url;
  audio.load();
  transmissionId.textContent=isLocal?"LOC":String(Math.max(1,activeTrack+1)).padStart(3,"0");
  current.textContent="0:00";duration.textContent="0:00";seek.value="0";
  txStatus.textContent="STANDBY";status.textContent="SYSTEM ONLINE";
  subtitle.textContent=name||"GLOBAL ADDRESS";
  terminal.textContent="";
  mouthLevel=0;speechPulse=0;speechFloor=0;
  updatePlaylistSelection();
}

function selectTrack(i,autoPlay=false){
  if(!tracks[i])return;
  activeTrack=i;
  setAudioSource(tracks[i].url,false,tracks[i].name);
  if(autoPlay)start();
}

function ensureAnalyzer(){
  if(analyser)return true;
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC){audioStatus.textContent="UNAVAILABLE";return false;}
  try{
    audioContext=new AC();
    analyser=audioContext.createAnalyser();
    analyser.fftSize=1024;
    analyser.minDecibels=-90;
    analyser.maxDecibels=-12;
    analyser.smoothingTimeConstant=.72;
    sourceNode=audioContext.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(audioContext.destination);
    frequencyData=new Uint8Array(analyser.frequencyBinCount);
    waveformData=new Uint8Array(analyser.fftSize);
    audioStatus.textContent="ACTIVE";
    return true;
  }catch(e){
    console.warn("ECHO audio analysis unavailable:",e);
    audioStatus.textContent="UNAVAILABLE";
    return false;
  }
}

function calculateSpeechLevel(){
  if(!analyser||audio.paused){
    mouthLevel*=.82;speechPulse*=.82;
    return mouthLevel;
  }
  analyser.getByteFrequencyData(frequencyData);
  analyser.getByteTimeDomainData(waveformData);
  const binHz=(audioContext.sampleRate/2)/frequencyData.length;
  const low=Math.max(1,Math.floor(90/binHz));
  const high=Math.min(frequencyData.length-1,Math.ceil(5000/binHz));
  let weighted=0,total=0;
  for(let i=low;i<=high;i++){
    const hz=i*binHz,v=frequencyData[i]/255;
    const weight=hz<250?.8:hz<1200?1.25:hz<3200?1:.55;
    weighted+=v*weight;total+=weight;
  }
  const band=total?weighted/total:0;
  let rms=0;
  for(let i=0;i<waveformData.length;i+=8){
    const v=(waveformData[i]-128)/128;rms+=v*v;
  }
  rms=Math.sqrt(rms/Math.ceil(waveformData.length/8));
  speechFloor=speechFloor*.995+Math.min(band,.16)*.005;
  const target=Math.min(1,Math.max(0,band-speechFloor*1.15)*2.5+Math.max(0,rms-.025)*.55);
  const pulseTarget=Math.min(1,target*1.35+rms*.3);
  speechPulse+=(pulseTarget-speechPulse)*(pulseTarget>speechPulse?.48:.18);
  mouthLevel+=(target-mouthLevel)*(target>mouthLevel?.42:.16);
  return mouthLevel;
}

function updateBlink(time){
  if(blinkState==="open"&&time>=nextBlink){blinkState="closing";blinkStart=time;}
  if(blinkState==="closing"){
    const t=Math.min(1,(time-blinkStart)/85);blinkAmount=t;
    if(t>=1){blinkState="opening";blinkStart=time;}
  }else if(blinkState==="opening"){
    const t=Math.min(1,(time-blinkStart)/110);blinkAmount=1-t;
    if(t>=1){blinkState="open";blinkAmount=0;nextBlink=time+3200+Math.random()*4200;}
  }
}

function clamp(value,min,max){
  return Math.max(min,Math.min(max,value));
}

function updateEyeTarget(){
  const pointer=pointerActive?pointerArtworkPoint(pointerClientX,pointerClientY):null;
  FACE.eyes.forEach((eye,i)=>{
    if(!pointer||!faceScale){
      eyeTargetX[i]=0;
      eyeTargetY[i]=0;
      return;
    }

    const dx=pointer.x-eye.cx;
    const dy=pointer.y-eye.cy;
    const distance=Math.hypot(dx,dy);
    const strength=Math.min(1,distance/GAZE.saturation);
    const nx=distance>0.001?dx/distance:0;
    const ny=distance>0.001?dy/distance:0;
    const lag=i===1?0.98:1;
    eyeTargetX[i]=clamp(nx*GAZE.maxX*strength*lag,-GAZE.maxX,GAZE.maxX);
    eyeTargetY[i]=clamp(ny*GAZE.maxY*strength*lag,-GAZE.maxY,GAZE.maxY);
  });
}

function applyEyeMotion(){
  eyeX[0]+=(eyeTargetX[0]-eyeX[0])*0.10;
  eyeY[0]+=(eyeTargetY[0]-eyeY[0])*0.10;
  eyeX[1]+=(eyeTargetX[1]-eyeX[1])*0.095;
  eyeY[1]+=(eyeTargetY[1]-eyeY[1])*0.095;

  eyeLeft.style.transform="translate3d("+(eyeX[0]*faceScale)+"px,"+(eyeY[0]*faceScale)+"px,0)";
  eyeRight.style.transform="translate3d("+(eyeX[1]*faceScale)+"px,"+(eyeY[1]*faceScale)+"px,0)";
}

function applyBlink(){
  const visible=blinkAmount;
  const clip="inset("+((1-visible)*100)+"% 0 0 0)";
  eyelidLeft.style.opacity=String(visible);
  eyelidRight.style.opacity=String(visible);
  eyelidLeft.style.clipPath=clip;
  eyelidLeft.style.webkitClipPath=clip;
  eyelidRight.style.clipPath=clip;
  eyelidRight.style.webkitClipPath=clip;
}

function applyMouthMotion(){
  const scaleY=1+Math.min(0.055,mouthLevel*0.055);
  const y=speechPulse*1.15*faceScale;
  mouthLayer.style.transform="translate3d(0,"+y+"px,0) scaleY("+scaleY+")";
}

function drawSpeechMouth(level){
  if(audio.paused||!waveformData||level<0.01)return;

  const {cx,cy,bbox}=FACE.mouth;
  const amplitude=1.5+8*level;

  mouthCtx.save();
  mouthCtx.globalCompositeOperation="source-over";

  mouthCtx.beginPath();
  mouthCtx.roundRect(bbox.x,bbox.y,bbox.w,bbox.h,40);
  mouthCtx.clip();

  const samples=64;
  const span=bbox.w*0.80;
  mouthCtx.strokeStyle="rgba(92,239,255,"+(.12+level*.42)+")";
  mouthCtx.lineWidth=0.9;
  mouthCtx.beginPath();

  for(let i=0;i<samples;i++){
    const x=cx-span/2+span*i/(samples-1);
    const idx=Math.floor(i*(waveformData.length-1)/(samples-1));
    const wave=(waveformData[idx]-128)/128;
    const y=cy+wave*amplitude;
    if(i===0)mouthCtx.moveTo(x,y);
    else mouthCtx.lineTo(x,y);
  }

  mouthCtx.stroke();
  mouthCtx.restore();
}

function renderFace(time){
  const level=calculateSpeechLevel();
  mouthCtx.clearRect(0,0,FACE.width,FACE.height);

  updateBlink(time);
  updateEyeTarget();
  applyEyeMotion();
  applyBlink();
  applyMouthMotion();
  drawSpeechMouth(level);
}

function typeTransmission(lines){
  clearInterval(typingTimer);terminal.textContent="";
  let line=0,char=0,buffer="";
  typingTimer=setInterval(()=>{
    if(line>=lines.length){clearInterval(typingTimer);typingTimer=null;return;}
    const text=lines[line];
    if(char<text.length){buffer+=text[char++];terminal.textContent=buffer;}
    else{buffer+="\n";terminal.textContent=buffer;line++;char=0;}
  },28);
}

async function start(){
  if(!audio.src)return;
  ensureAnalyzer();
  if(audioContext&&audioContext.state==="suspended")await audioContext.resume();
  try{
    await audio.play();
    status.textContent="TRANSMISSION ACTIVE";txStatus.textContent="TRANSMITTING";
    subtitle.textContent=audio.dataset.localName||tracks[activeTrack]?.name||"GLOBAL ADDRESS";
    typeTransmission(fallbackTransmission);
  }catch(e){
    console.warn("ECHO playback blocked:",e);
    subtitle.textContent="Press PLAY to authorize the transmission.";
  }
}

function stopAudio(){
  audio.pause();audio.currentTime=0;
  txStatus.textContent="STANDBY";status.textContent="SYSTEM ONLINE";
  mouthLevel=0;speechPulse=0;current.textContent="0:00";seek.value="0";
}

function loadLocalFile(file){
  if(!file)return;
  if(localObjectUrl)URL.revokeObjectURL(localObjectUrl);
  localObjectUrl=URL.createObjectURL(file);
  activeTrack=-1;
  audio.dataset.localName=file.name;
  uploadStatus.textContent="LOADED: "+file.name;
  libraryStatus.textContent="LOCAL AUDIO";
  setAudioSource(localObjectUrl,true,file.name);
}

function animationLoop(time){
  renderFace(time);
  if(Number.isFinite(audio.duration)&&audio.duration>0){
    seek.value=String((audio.currentTime/audio.duration)*100);
    current.textContent=formatTime(audio.currentTime);
  }
  const level=mouthLevel;
  meter.style.width=`${Math.round(Math.min(1,level*1.35)*100)}%`;
  signal.textContent=`SIGNAL ${String(Math.round(Math.min(99,18+level*81))).padStart(3,"0")}%`;
  meter.style.transform=!audio.paused&&audio.duration?`scaleX(${Math.max(.02,audio.currentTime/audio.duration)})`:"scaleX(.02)";
  clock.textContent=new Date().toLocaleTimeString([], {hour12:false});
  animationFrame=requestAnimationFrame(animationLoop);
}

window.addEventListener("pointermove",e=>{
  pointerClientX=e.clientX;
  pointerClientY=e.clientY;
  pointerActive=true;
});
window.addEventListener("blur",()=>{
  pointerActive=false;
});

play.addEventListener("click",start);
stop.addEventListener("click",stopAudio);

seek.addEventListener("input",()=>{
  if(Number.isFinite(audio.duration))audio.currentTime=(Number(seek.value)/100)*audio.duration;
});

upload.addEventListener("change",e=>loadLocalFile(e.target.files?.[0]));

trailerMode.addEventListener("click",()=>{
  document.body.classList.toggle("trailer-mode");
  trailerMode.textContent=document.body.classList.contains("trailer-mode")?"EXIT TRAILER":"TRAILER MODE";
  setTimeout(resizeFaceCompositor,60);
});

audio.addEventListener("loadedmetadata",()=>duration.textContent=formatTime(audio.duration));
audio.addEventListener("play",()=>{txStatus.textContent="TRANSMITTING";status.textContent="TRANSMISSION ACTIVE";});
audio.addEventListener("pause",()=>{if(!audio.ended){txStatus.textContent="PAUSED";status.textContent="SYSTEM ONLINE";}});
audio.addEventListener("ended",()=>{txStatus.textContent="COMPLETE";status.textContent="SYSTEM ONLINE";mouthLevel=0;speechPulse=0;});

window.addEventListener("resize",resizeFaceCompositor);
resizeFaceCompositor();
verifyFaceAssets();
discoverAudio();
animationFrame=requestAnimationFrame(animationLoop);
