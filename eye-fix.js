"use strict";

/*
  ECHO eye renderer v3.
  The original app renderer and this corrected renderer share one canvas.
  Suppress the original eye image draws so only this renderer owns the eyes.
*/

(() => {
  const canvas = document.querySelector("#mouth-visualizer");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const eyeball = new Image();
  const eyelids = new Image();
  eyeball.decoding = "async";
  eyelids.decoding = "async";
  eyeball.src = "eyeball.png";
  eyelids.src = "eyelids.png";

  const W = 1664;
  const H = 936;
  const EYES = [
    { eye:{x:620,y:268,w:72,h:70,cx:656,cy:303}, lid:{x:600,y:275,w:112,h:67,cx:656,cy:308} },
    { eye:{x:941,y:268,w:72,h:70,cx:977,cy:303}, lid:{x:921,y:275,w:112,h:67,cx:977,cy:308} }
  ];

  // The original app uses the same canvas and would otherwise draw a second
  // copy of the eye layers. Allow this renderer through, block only those
  // specific source images everywhere else.
  const originalDrawImage = ctx.drawImage.bind(ctx);
  let allowEyeDraw = false;
  ctx.drawImage = function(image, ...args) {
    const src = image && (image.currentSrc || image.src || "");
    if (!allowEyeDraw && /(?:^|\/)(?:eyeball|eyelids)\.png(?:\?|$)/i.test(src)) return;
    return originalDrawImage(image, ...args);
  };

  let ex = 0, ey = 0;
  let tx = 0, ty = 0;
  let pointer = false;
  let px = 0, py = 0;
  let nextMove = performance.now() + 1400;
  let blink = 0;
  let blinkMode = 0;
  let blinkStart = 0;
  let nextBlink = performance.now() + 3200;

  function point(x, y) {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const s = Math.min(cw / W, ch / H);
    return { x:(cw - W*s)/2 + x*s, y:(ch - H*s)/2 + y*s, s };
  }

  function clearEyeRegion(item) {
    const a = point(item.lid.x - 7, item.lid.y - 7);
    const b = point(item.lid.x + item.lid.w + 7, item.lid.y + item.lid.h + 7);
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.restore();
  }

  function drawCrop(image, src, p, dx, dy, alpha, scaleY) {
    if (!image.complete || !image.naturalWidth) return;
    const s = p.s;
    const dw = src.w*s;
    const dh = src.h*s;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x + dx*s, p.y + dy*s);
    ctx.scale(1, scaleY);
    allowEyeDraw = true;
    originalDrawImage(image, src.x, src.y, src.w, src.h, -dw/2, -dh/2, dw, dh);
    allowEyeDraw = false;
    ctx.restore();
  }

  function update(time) {
    if (pointer) {
      tx = px;
      ty = py;
    } else if (time >= nextMove) {
      nextMove = time + 2200 + Math.random()*3200;
      tx = (Math.random()-.5)*9;
      ty = (Math.random()-.5)*4;
    }

    ex += (tx-ex)*0.07;
    ey += (ty-ey)*0.07;

    if (blinkMode === 0 && time >= nextBlink) {
      blinkMode = 1;
      blinkStart = time;
    }
    if (blinkMode === 1) {
      blink = Math.min(1, (time-blinkStart)/75);
      if (blink >= 1) { blinkMode = 2; blinkStart = time; }
    } else if (blinkMode === 2) {
      blink = 1-Math.min(1, (time-blinkStart)/105);
      if (blink <= 0) {
        blinkMode = 0;
        nextBlink = time + 3000 + Math.random()*4300;
      }
    }

    // Remove any previous eye/lid pass before drawing one corrected pair.
    EYES.forEach(clearEyeRegion);

    const open = Math.max(0.035, 1-blink);
    EYES.forEach(item => {
      const ep = point(item.eye.cx, item.eye.cy);
      drawCrop(eyeball, item.eye, ep, ex, ey, 1, 1);
    });
    EYES.forEach(item => {
      const lp = point(item.lid.cx, item.lid.cy);
      drawCrop(eyelids, item.lid, lp, 0, 0, .97, open);
    });

    requestAnimationFrame(update);
  }

  canvas.addEventListener("pointermove", event => {
    const r = canvas.getBoundingClientRect();
    const nx = ((event.clientX-r.left)/r.width)*2-1;
    const ny = ((event.clientY-r.top)/r.height)*2-1;
    px = Math.max(-7, Math.min(7, nx*7));
    py = Math.max(-3, Math.min(3, ny*3));
    pointer = true;
  });
  canvas.addEventListener("pointerleave", () => { pointer = false; });

  requestAnimationFrame(update);
})();
