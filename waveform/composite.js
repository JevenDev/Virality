import { waveCanvas } from '../ui/elements.js';
import { state } from '../state/store.js';
import { secondsToClock } from '../util/time.js';
import { CANVAS_PLACE_BG, CANVAS_GRID, CANVAS_TEXT } from '../util/constants.js';
import { drawWaveform, drawWaveformBase, drawWaveformProgress, getWaveformCache, resizeWaveCanvas } from './renderer.js';

export function getIdleMessage(){
  return state.files.length ? 'Click Play on a file to preview' : 'Drop or select a file to start';
}

export function drawPlaceholderWave(msg=getIdleMessage()){
  resizeWaveCanvas();
  const c = waveCanvas;
  if (!c) return;
  const w = c.clientWidth;
  const h = c.clientHeight;
  const g = c.getContext('2d');
  g.clearRect(0,0,w,h);
  g.fillStyle = CANVAS_PLACE_BG;
  g.fillRect(0,0,w,h);
  g.strokeStyle = CANVAS_GRID;
  g.lineWidth = 1;
  g.beginPath();
  for (let x=0;x<w;x+=8){ const y1=h*.45, y2=h*.55; g.moveTo(x+.5,y1); g.lineTo(x+.5,y2); }
  g.stroke();
  g.fillStyle = CANVAS_TEXT;
  g.font = '14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(msg, w/2, h/2);
}

export function redrawWaveform(buffer){
  if (!buffer){ drawPlaceholderWave(); return; }
  drawWaveform(buffer);
}

export function renderComposite(progressFrac=0){
  if (!state.currentBuffer){
    drawPlaceholderWave();
    return;
  }
  drawWaveformBase();
  if (progressFrac > 0) drawWaveformProgress(progressFrac);
  if (state.hoverActive && !state.isSeeking){
    drawHoverOverlay(state.hoverFrac);
  }
}

export function drawHoverOverlay(frac){
  const wf = getWaveformCache();
  if (!wf) return;
  const g = waveCanvas.getContext('2d');
  const upto = Math.floor(frac * wf.heights.length);
  g.save();
  g.globalAlpha = 0.25;
  g.fillStyle = '#ffffff';
  for (let i=0;i<upto;i++){
    const x = wf.x[i], y = wf.yTop[i], w = wf.barWidth, h = wf.heights[i];
    g.fillRect(x, y, w, h);
  }
  g.restore();
}
