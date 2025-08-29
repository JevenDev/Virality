// waveform/renderer.js
import { waveCanvas } from '../ui/elements.js';
import { WAVE_COLOR, WAVE_OVERLAY, CANVAS_BG } from '../util/constants.js';

let wfBars = null;
let lastCanvasW = 0, lastCanvasH = 0;
let lastBufferRef = null;

export function resetWaveformCache(){
  wfBars = null;
  lastCanvasW = 0;
  lastCanvasH = 0;
  lastBufferRef = null;
}

export function resizeWaveCanvas(){
  if (!waveCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  const wCss = Math.max(1, waveCanvas.clientWidth);
  const hCss = Math.max(1, waveCanvas.clientHeight);
  const w = Math.floor(wCss * dpr), h = Math.floor(hCss * dpr);
  if (waveCanvas.width !== w || waveCanvas.height !== h){
    waveCanvas.width = w; waveCanvas.height = h;
  }
  const g = waveCanvas.getContext('2d');
  g.setTransform(dpr,0,0,dpr,0,0);
}

export function computeBarData(buffer){
  const w = waveCanvas.clientWidth;
  const h = waveCanvas.clientHeight;
  const data = buffer.getChannelData(0);
  const barWidth=3, gap=2, marginY=8, minBarH=3, radius=2;
  const bars = Math.max(1, Math.floor(w / (barWidth + gap)));
  const samplesPerBar = Math.max(1, Math.floor(data.length / bars));
  const usableH = Math.max(1, h - marginY*2);
  const heights = new Float32Array(bars);
  const yTop = new Float32Array(bars);
  const xs = new Float32Array(bars);

  for (let i=0;i<bars;i++){
    const start=i*samplesPerBar, end=Math.min(start+samplesPerBar, data.length);
    let peak=0; for (let j=start;j<end;j++){ const v=Math.abs(data[j]); if (v>peak) peak=v; }
    const hBar = Math.max(minBarH, peak * usableH);
    heights[i] = hBar;
    xs[i] = Math.round(i*(barWidth+gap) + gap*.5);
    yTop[i] = Math.round((h - hBar)/2);
  }
  return { heights, x: xs, yTop, barWidth, gap, radius, color: WAVE_COLOR, overlay: WAVE_OVERLAY };
}

export function ensureBarCache(buffer){
  const w = waveCanvas.clientWidth;
  const h = waveCanvas.clientHeight;
  const sizeChanged = (w !== lastCanvasW || h !== lastCanvasH);
  const bufferChanged = (buffer !== lastBufferRef);

  if (!wfBars || sizeChanged || bufferChanged){
    wfBars = computeBarData(buffer);
    lastCanvasW = w; lastCanvasH = h;
    lastBufferRef = buffer;
  }
}

export function drawWaveformBase(){
  if (!wfBars) return;
  const c = waveCanvas;
  const w = c.clientWidth, h = c.clientHeight;
  const g = c.getContext('2d');
  g.clearRect(0,0,w,h);
  g.fillStyle = CANVAS_BG;
  g.fillRect(0,0,w,h);
  g.fillStyle = wfBars.color;
  for (let i=0;i<wfBars.heights.length;i++){
    const x = wfBars.x[i], y = wfBars.yTop[i], bw = wfBars.barWidth, bh = wfBars.heights[i], r = wfBars.radius;
    g.beginPath();
    const rr = Math.min(r, bw*.5, bh*.5);
    g.moveTo(x+rr,y);
    g.lineTo(x+bw-rr,y);
    g.quadraticCurveTo(x+bw,y, x+bw,y+rr);
    g.lineTo(x+bw,y+bh-rr);
    g.quadraticCurveTo(x+bw,y+bh, x+bw-rr,y+bh);
    g.lineTo(x+rr,y+bh);
    g.quadraticCurveTo(x,y+bh, x,y+bh-rr);
    g.lineTo(x,y+rr);
    g.quadraticCurveTo(x,y, x+rr,y);
    g.closePath();
    g.fill();
  }
}

export function drawWaveformProgress(frac){
  if (!wfBars) return;
  const g = waveCanvas.getContext('2d');
  const upto = Math.floor(frac * wfBars.heights.length);
  g.fillStyle = wfBars.overlay;
  for (let i=0;i<upto;i++){
    g.fillRect(wfBars.x[i], wfBars.yTop[i], wfBars.barWidth, wfBars.heights[i]);
  }
}

export function drawWaveform(buffer){
  resizeWaveCanvas();
  ensureBarCache(buffer);
  drawWaveformBase();
}

export function getWaveformCache(){ return wfBars; }
