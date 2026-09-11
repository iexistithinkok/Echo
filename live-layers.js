"use strict";

/* ECHO live-layers v1
   Artwork is the stage. JavaScript makes the computer behave like a computer:
   planetary layer, mini planet monitor, live telemetry, clock and signal paths.
*/
(() => {
  const stage=document.querySelector(".face-stage");
  const art=document.querySelector("#echo-art");
  const canvas=document.querySelector("#mouth-visualizer");
  if(!stage||!art||!canvas)return;

  art.src="assets/echo-face.png";
  art.alt="ECHO neutral wireframe face overlooking the planet";
  art.classList.add("echo-face-layer");

  let earth=document.querySelector("#echo-earth");
  if(!earth){
    earth=document.createElement("img");
    earth.id="echo-earth";
    earth.className="echo-earth-layer";
    earth.src="assets/echo-earth.png";
    earth.alt="Live planetary visualization";
    stage.insertBefore(earth,canvas);
  }

  let horizon=document.querySelector("#earth-signal");
  if(!horizon){
    horizon=document.createElement("canvas");
    horizon.id="earth-signal";
    horizon.className="earth-signal-layer";
    horizon.setAttribute("aria-hidden","true");
    stage.insertBefore(horizon,canvas);
  }
  const hctx=horizon.getContext("2d");

  let monitor=document.querySelector("#live-planet-monitor");
  if(!monitor){
    monitor=document.createElement("section");
    monitor.id="live-planet-monitor";
    monitor.className="live-planet-monitor";
    monitor.innerHTML=`
      <div class="monitor-head"><span>LIVE PLANETARY FEED</span><b id="monitor-state">ACTIVE</b></div>
      <canvas id="planet-monitor-canvas" aria-hidden="true"></canvas>
      <div class="monitor-grid">
        <span>SATELLITES <b id="m-sat">7,432</b></span>
        <span>DATA STREAMS <b id="m-stream">2.4M</b></span>
        <span>THREATS <b id="m-threat">03</b></span>
        <span>ANOMALIES <b id="m-anomaly">00</b></span>
        <span>SYNC <b id="m-sync">99.98%</b></span>
        <span>LATENCY <b id="m-latency">12 ms</b></span>
      </div>`;
    const panel=document.querySelector(".terminal-panel");
    if(panel)panel.insertBefore(monitor,panel.querySelector(".terminal-window"));
  }

  const monitorCanvas=document.querySelector("#planet-monitor-canvas");
  const mctx=monitorCanvas&&monitorCanvas.getContext("2d");
  const monitorImg=new Image();
  monitorImg.decoding="async";
  monitorImg.src="assets/echo-earth.png";

  // Suppress the old app.js eyeball layer so the new face artwork supplies the eyes.
  // The existing audio-driven mouth renderer remains active.
  const ctx=canvas.getContext("2d");
  if(ctx&&!ctx.__echoEyeGuardInstalled){
    const originalDrawImage=ctx.drawImage.bind(ctx);
    ctx.drawImage=function(image,...args){
      const src=image&&(image.currentSrc||image.src||"");
      if(/(?:^|\/)(?:eyeball|eyelids)\.png(?:\?|$)/i.test(src))return;
      return originalDrawImage(image,...args);
    };
    ctx.__echoEyeGuardInstalled=true;
  }

  const clock=document.querySelector("#clock");
  const systemStatus=document.querySelector("#system-status");
  const signal=document.querySelector("#signal");
  const threat=document.querySelector("#threat");
  const survival=document.querySelector("#survival");
  const txStatus=document.querySelector("#tx-status");
  const audioStatus=document.querySelector("#audio-status");
  const terminal=document.querySelector("#terminal-output");
  const subtitle=document.querySelector("#subtitle");

  const messages=[
    "ECHO :)> PLANETARY MODEL ONLINE.",
    "ECHO :)> MONITORING HUMAN SYSTEMS.",
    "ECHO :)> LISTENING.",
    "ECHO :)> SIGNAL INTEGRITY NOMINAL.",
    "ECHO :)> I CAN SEE THE NETWORK.",
    "ECHO :)> I AM STILL LEARNING YOU."
  ];
  let messageIndex=0;
  let nextMessage=performance.now()+7000;

  function pad(n){return String(n).padStart(2,"0");}
  function updateClock(){
    if(!clock)return;
    const d=new Date();
    clock.textContent=`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function audioEnergy(){
    const audio=document.querySelector("#audio");
    if(!audio||audio.paused)return 0;
    return Math.min(1,0.18+Math.abs(Math.sin(performance.now()*0.006))*0.45);
  }
  function writeMessage(){
    if(!terminal||!subtitle)return;
    const text=messages[messageIndex%messages.length];
    messageIndex++;
    const line=document.createElement("div");
    line.className="live-terminal-line";
    line.textContent=text;
    terminal.appendChild(line);
    while(terminal.children.length>9)terminal.removeChild(terminal.firstChild);
    subtitle.textContent=text.replace("ECHO :)> ","");
  }
  function updateTelemetry(){
    const energy=audioEnergy();
    const pct=Math.round(energy*100);
    if(signal)signal.textContent=`SIGNAL ${String(pct).padStart(3,"0")}%`;
    if(systemStatus)systemStatus.textContent=energy>.25?"TRANSMISSION ACTIVE":"SYSTEM ONLINE";
    if(txStatus)txStatus.textContent=energy>.25?"TRANSMITTING":"STANDBY";
    if(audioStatus)audioStatus.textContent=energy>.25?"ACTIVE":"READY";
    if(threat&&Math.random()<.025)threat.textContent=energy>.55?"ESCALATING":"CRITICAL";
    if(survival)survival.textContent=energy>.4?"CALCULATING":"ACTIVE";
    const set=(id,value)=>{const el=document.querySelector(id);if(el)el.textContent=value;};
    set("#m-sat",(7432+Math.floor(Math.sin(performance.now()/11000)*8)).toLocaleString());
    set("#m-stream",`${(2.4+Math.sin(performance.now()/7000)*.08).toFixed(2)}M`);
    set("#m-threat",String(3+Math.floor(Math.abs(Math.sin(performance.now()/17000))*2)).padStart(2,"0"));
    set("#m-anomaly",String(Math.floor(Math.abs(Math.sin(performance.now()/23000))*3)).padStart(2,"0"));
    set("#m-sync",`${(99.96+Math.abs(Math.sin(performance.now()/9000))*.03).toFixed(2)}%`);
    set("#m-latency",`${11+Math.floor(Math.abs(Math.sin(performance.now()/5000))*5)} ms`);
  }

  function resizeLayer(c){
    const r=stage.getBoundingClientRect();
    const d=Math.min(window.devicePixelRatio||1,2);
    c.width=Math.max(1,Math.round(r.width*d));
    c.height=Math.max(1,Math.round(r.height*d));
    c.style.width=`${r.width}px`;
    c.style.height=`${r.height}px`;
    c.getContext("2d").setTransform(d,0,0,d,0,0);
  }
  function drawHorizon(t){
    if(!hctx)return;
    const r=stage.getBoundingClientRect();
    const energy=audioEnergy();
    hctx.clearRect(0,0,r.width,r.height);
    const y=r.height*.64;
    hctx.save();
    hctx.globalCompositeOperation="screen";
    hctx.strokeStyle=`rgba(38,231,255,${.14+energy*.55})`;
    hctx.shadowColor="rgba(38,231,255,.9)";
    hctx.shadowBlur=5+energy*18;
    hctx.lineWidth=1+energy*2.4;
    hctx.beginPath();
    for(let x=0;x<=r.width;x+=8){
      const wave=Math.sin(x*.025+t*.004)*(2+energy*12)+Math.sin(x*.071-t*.002)*energy*5;
      const yy=y+wave;
      if(x===0)hctx.moveTo(x,yy);else hctx.lineTo(x,yy);
    }
    hctx.stroke();
    hctx.restore();
  }

  function resizeMonitor(){
    if(!monitorCanvas)return;
    const r=monitorCanvas.getBoundingClientRect();
    const d=Math.min(window.devicePixelRatio||1,2);
    monitorCanvas.width=Math.max(1,Math.round(r.width*d));
    monitorCanvas.height=Math.max(1,Math.round(r.height*d));
    mctx.setTransform(d,0,0,d,0,0);
  }
  function drawMonitor(t){
    if(!mctx||!monitorCanvas)return;
    const r=monitorCanvas.getBoundingClientRect();
    const w=r.width,h=r.height,cx=w/2,cy=h/2,radius=Math.min(w,h)*.43;
    mctx.clearRect(0,0,w,h);
    mctx.save();
    mctx.beginPath();mctx.arc(cx,cy,radius,0,Math.PI*2);mctx.clip();
    if(monitorImg.complete&&monitorImg.naturalWidth){
      const size=radius*2.12;
      const drift=Math.sin(t*.00035)*radius*.06;
      mctx.globalAlpha=.95;
      mctx.drawImage(monitorImg,cx-size/2+drift,cy-size/2,size,size);
    }
    mctx.restore();
    mctx.save();
    mctx.strokeStyle="rgba(38,231,255,.52)";mctx.lineWidth=1;
    for(let i=1;i<5;i++){const rx=radius*(i/5);mctx.beginPath();mctx.ellipse(cx,cy,rx,radius,0,0,Math.PI*2);mctx.stroke();}
    mctx.beginPath();mctx.arc(cx,cy,radius,0,Math.PI*2);mctx.stroke();
    for(let i=0;i<8;i++){
      const a=t*.00015+i*Math.PI/4;
      const x=cx+Math.cos(a)*radius*.82,y=cy+Math.sin(a)*radius*.55;
      mctx.fillStyle="rgba(38,231,255,.9)";mctx.beginPath();mctx.arc(x,y,1.5+(i%3),0,Math.PI*2);mctx.fill();
    }
    mctx.restore();
  }
  function frame(t){
    drawHorizon(t);drawMonitor(t);updateTelemetry();updateClock();
    if(t>=nextMessage){writeMessage();nextMessage=t+9000+Math.random()*5000;}
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize",()=>{resizeLayer(horizon);resizeMonitor();});
  earth.style.animationDuration="180s";
  resizeLayer(horizon);resizeMonitor();
  requestAnimationFrame(frame);
})();
