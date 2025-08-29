import { state, setState } from '../state/store.js';
import { waveCanvas, playBar, playTimeEl } from '../ui/elements.js';
import { drawWaveformBase, drawWaveformProgress } from './renderer.js';
import { renderComposite } from './composite.js';
import { secondsToClock } from '../util/time.js';
import { newSession } from '../audio/session.js';
import { startBufferPlayback, stopAllPreviews } from '../audio/transport.js';
import { getCtxTime } from '../audio/engine.js';

let isSeeking = false;
let pendingSeekFrac = 0;

function fracFromPointer(ev){
  const rect = waveCanvas.getBoundingClientRect();
  const x = Math.min(Math.max(ev.clientX - rect.left, 0), rect.width);
  return rect.width ? (x / rect.width) : 0;
}

function applySeekPreview(frac){
  if (!state.currentBuffer) return;
  pendingSeekFrac = frac;
  drawWaveformBase();
  drawWaveformProgress(frac);
  const previewSec = frac * state.currentDuration;
  if (playTimeEl) playTimeEl.textContent = secondsToClock(previewSec);
  if (playBar) playBar.style.width = (frac * 100) + '%';
}

export function bindSeek(){
  waveCanvas?.addEventListener('pointerdown', (e)=>{
    if (!state.currentBuffer || !state.allowScrub) return;
    waveCanvas.setPointerCapture(e.pointerId);
    stopAllPreviews(true);
    isSeeking = true;
    applySeekPreview(fracFromPointer(e));
  });
  waveCanvas?.addEventListener('pointermove', (e)=>{
    if (isSeeking && state.allowScrub){
      applySeekPreview(fracFromPointer(e));
      return;
    }
    if (!state.currentBuffer) return;
    setState({ hoverActive: true, hoverFrac: fracFromPointer(e) });
    const progress = (state.currentPlayingId && state.currentDuration>0)
      ? Math.min(1, Math.max(0, (getCtxTime() - state.startedAtCtxTime) / state.currentDuration))
      : 0;
    renderComposite(progress);
  });
  ['pointerup','pointercancel','pointerleave'].forEach(evt=>{
    waveCanvas?.addEventListener(evt, (e)=>{
      if (evt === 'pointerleave'){
        setState({ hoverActive: false });
        const progress = (state.currentPlayingId && state.currentDuration>0)
        ? Math.min(1, Math.max(0, (getCtxTime() - state.startedAtCtxTime) / state.currentDuration))
        : 0;
        renderComposite(progress);
      }
      if (!isSeeking) return;
      isSeeking = false;
      if (!state.currentBuffer) return;
      const req = newSession();
      startBufferPlayback(state.currentBuffer, state.currentItem, pendingSeekFrac * state.currentDuration, req);
    }, { passive: true });
  });
}
