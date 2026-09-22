"use strict";

const REPO_API="https://api.github.com/repos/iexistithinkok/Echo/git/trees/main?recursive=1";
const RAW_BASE="https://raw.githubusercontent.com/iexistithinkok/Echo/main/";
const AUDIO_EXTENSIONS=["mp3","m4a","wav","ogg","aac","flac"];

const audio=document.querySelector("#audio");
const mouthCanvas=document.querySelector("#mouth-visualizer");
const mouthCtx=mouthCanvas.getContext("2d",{alpha:true});
const eyeCanvas=document.querySelector("#eye-visualizer");
const ctx=eyeCanvas.getContext("2d",{alpha:true});
const faceStage=document.querySelector(".face-stage");
const art=document.querySelector("#echo-art");
const fallback=document.querySelector(".fallback-face");
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

const FACE={width:1664,height:936,eyes:[
  // Resting iris centers are taken from the visible iris positions in echo-frame-02.png.
  // Socket geometry is separate so tracking can be clamped to the actual eye opening.
  {
    rest:{x:621,y:278},
    socket:{cx:657,cy:279,rx:86,ry:50},
    pupilRadius:5.5,
    irisRadius:15
  },
  {
    rest:{x:958,y:273},
    socket:{cx:1005,cy:279,rx:86,ry:50},
    pupilRadius:5.5,
    irisRadius:15
  }
],mouth:{
  cx:835,
  cy:629,
  openingWidth:285,
  openingHeight:120
}};

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

function resizeCanvas(){
  const r=faceStage.getBoundingClientRect(),d=Math.min(window.devicePixelRatio||1,2);
  for(const c of [mouthCanvas,eyeCanvas]){
    c.width=Math.max(1,Math.round(r.width*d));
    c.height=Math.max(1,Math.round(r.height*d));
    c.style.width=`${r.width}px`;
    c.style.height=`${r.height}px`;
  }
  mouthCtx.setTransform(d,0,0,d,0,0);
  ctx.setTransform(d,0,0,d,0,0);
}

function imagePoint(px,py){
  const cw=faceStage.clientWidth,ch=faceStage.clientHeight;
  const scale=Math.min(cw/FACE.width,ch/FACE.height);
  return{x:(cw-FACE.width*scale)/2+px*scale,y:(ch-FACE.height*scale)/2+py*scale,s:scale};
}

function pointerArtworkPoint(clientX,clientY){
  const r=faceStage.getBoundingClientRect();
  const cw=r.width,ch=r.height;
  const scale=Math.min(cw/FACE.width,ch/FACE.height);
  const ox=(cw-FACE.width*scale)/2;
  const oy=(ch-FACE.height*scale)/2;
  return{
    x:(clientX-r.left-ox)/scale,
    y:(clientY-r.top-oy)/scale
  };
}

function clampPupilToSocket(x,y,eye){
  const rx=Math.max(1,eye.socket.rx-eye.irisRadius);
  const ry=Math.max(1,eye.socket.ry-eye.irisRadius);
  const nx=(x-eye.socket.cx)/rx;
  const ny=(y-eye.socket.cy)/ry;
  const d=Math.hypot(nx,ny);
  if(d<=1)return{x,y};
  return{
    x:eye.socket.cx+(nx/d)*rx,
    y:eye.socket.cy+(ny/d)*ry
  };
}

function setImageState(ok){
  if(!art)return;
  art.classList.add("echo-face-layer");
  art.style.display="block";
  art.style.visibility="visible";
  if(fallback)fallback.classList.remove("visible");
  if(!ok)console.warn("ECHO artwork did not report a successful load; leaving the image layer visible.");
}

function verifyArtwork(){
  if(!art)return;
  if(art.complete&&art.naturalWidth>0){
    setImageState(true);
    return;
  }
  art.addEventListener("load",()=>setImageState(true),{once:true});
  art.addEventListener("error",()=>console.warn("ECHO artwork load error:",art.currentSrc||art.src),{once:true});
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

function updateEyeTarget(time){
  if(pointerActive){
    const pointer=pointerArtworkPoint(pointerClientX,pointerClientY);

    FACE.eyes.forEach((eye,i)=>{
      const dx=pointer.x-eye.rest.x;
      const dy=pointer.y-eye.rest.y;
      const distance=Math.hypot(dx,dy);

      // Vector tracking: direction first, then a fixed maximum travel.
      const maxTravel=28;
      const travel=Math.min(maxTravel,distance);
      const nx=distance>0.001?dx/distance:0;
      const ny=distance>0.001?dy/distance:0;

      const proposedX=eye.rest.x+nx*travel;
      const proposedY=eye.rest.y+ny*travel;
      const clamped=clampPupilToSocket(proposedX,proposedY,eye);

      eyeTargetX[i]=clamped.x-eye.rest.x;
      eyeTargetY[i]=clamped.y-eye.rest.y;
    });
    return;
  }

  if(time>=nextEyeMove){
    nextEyeMove=time+2200+Math.random()*3200;
    FACE.eyes.forEach((eye,i)=>{
      const angle=Math.random()*Math.PI*2;
      const travel=4+Math.random()*7;
      const clamped=clampPupilToSocket(
        eye.rest.x+Math.cos(angle)*travel,
        eye.rest.y+Math.sin(angle)*travel,
        eye
      );
      eyeTargetX[i]=clamped.x-eye.rest.x;
      eyeTargetY[i]=clamped.y-eye.rest.y;
    });
  }
}

function drawEye(eye,index,closure){
  const rest=imagePoint(eye.rest.x,eye.rest.y);
  const socket=imagePoint(eye.socket.cx,eye.socket.cy);
  const s=rest.s;
  const irisR=eye.irisRadius*s;
  const pupilR=eye.pupilRadius*s;
  const ix=rest.x+eyeX[index]*s;
  const iy=rest.y+eyeY[index]*s;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(
    socket.x,
    socket.y,
    eye.socket.rx*s,
    eye.socket.ry*s,
    0,0,Math.PI*2
  );
  ctx.clip();

  // Clean tracking iris: no glow, bloom, gradient, or oversized dot.
  ctx.globalCompositeOperation="source-over";
  ctx.strokeStyle="#26e7ff";
  ctx.lineWidth=Math.max(.8,.9*s);
  ctx.beginPath();
  ctx.arc(ix,iy,irisR,0,Math.PI*2);
  ctx.stroke();

  ctx.fillStyle="#26e7ff";
  ctx.beginPath();
  ctx.arc(ix,iy,pupilR,0,Math.PI*2);
  ctx.fill();

  ctx.fillStyle="#02060d";
  ctx.beginPath();
  ctx.arc(ix,iy,pupilR*.48,0,Math.PI*2);
  ctx.fill();

  if(closure>0){
    const cover=eye.socket.ry*s*closure;
    const w=eye.socket.rx*2*s;
    ctx.fillStyle="rgba(2,6,13,.96)";
    ctx.fillRect(socket.x-w/2,socket.y-eye.socket.ry*s,w,cover);
    ctx.fillRect(socket.x-w/2,socket.y+eye.socket.ry*s-cover,w,cover);
  }

  ctx.restore();
}

function drawEyes(time){
  updateEyeTarget(time);
  updateBlink(time);

  FACE.eyes.forEach((eye,i)=>{
    eyeX[i]+=(eyeTargetX[i]-eyeX[i])*.11;
    eyeY[i]+=(eyeTargetY[i]-eyeY[i])*.11;
    drawEye(eye,i,blinkAmount);
  });
}

function drawSpeechMouth(level){
  const p=imagePoint(FACE.mouth.cx,FACE.mouth.cy),s=p.s;
  const width=FACE.mouth.openingWidth*s;
  const height=FACE.mouth.openingHeight*s;
  const amplitude=(2+13*level)*s;

  /* This canvas is RGBA with a transparent background.
     It lives behind the face PNG, so the waveform is only visible
     where the artwork's dark mouth opening lets it show through. */
  mouthCtx.save();
  mouthCtx.globalCompositeOperation="screen";
  mouthCtx.beginPath();
  mouthCtx.ellipse(p.x,p.y,width*.5,height*.5,0,0,Math.PI*2);
  mouthCtx.clip();

  const bars=29;
  const span=width*.78;
  mouthCtx.strokeStyle=`rgba(92,239,255,${.24+level*.62})`;
  mouthCtx.lineWidth=Math.max(.7,1.0*s);

  mouthCtx.beginPath();
  for(let i=0;i<bars;i++){
    const x=p.x-span/2+span*i/(bars-1);
    let wave=0;
    if(waveformData){
      const idx=Math.floor(i*(waveformData.length-1)/(bars-1));
      wave=(waveformData[idx]-128)/128;
    }
    const local=(.18+.82*level)*(.28+Math.abs(wave)*.72);
    const y1=p.y-amplitude*local;
    const y2=p.y+amplitude*local;
    mouthCtx.moveTo(x,y1);
    mouthCtx.lineTo(x,y2);
  }
  mouthCtx.stroke();

  mouthCtx.restore();
}

function renderFace(time){
  const level=calculateSpeechLevel();
  mouthCtx.clearRect(0,0,mouthCanvas.clientWidth,mouthCanvas.clientHeight);
  ctx.clearRect(0,0,eyeCanvas.clientWidth,eyeCanvas.clientHeight);
  drawSpeechMouth(level);
  drawEyes(time);
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
  setTimeout(resizeCanvas,60);
});

audio.addEventListener("loadedmetadata",()=>duration.textContent=formatTime(audio.duration));
audio.addEventListener("play",()=>{txStatus.textContent="TRANSMITTING";status.textContent="TRANSMISSION ACTIVE";});
audio.addEventListener("pause",()=>{if(!audio.ended){txStatus.textContent="PAUSED";status.textContent="SYSTEM ONLINE";}});
audio.addEventListener("ended",()=>{txStatus.textContent="COMPLETE";status.textContent="SYSTEM ONLINE";mouthLevel=0;speechPulse=0;});

window.addEventListener("resize",resizeCanvas);
resizeCanvas();
verifyArtwork();
nextEyeMove=performance.now()+1200;
discoverAudio();
animationFrame=requestAnimationFrame(animationLoop);
