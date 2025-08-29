// ui/player.js
import { nowPlayingTitle, playTimeEl, playTotalEl, playBar } from './elements.js';
import { state } from '../state/store.js';
import { secondsToClock } from '../util/time.js';
import { renderComposite, drawPlaceholderWave, redrawWaveform } from '../waveform/composite.js';
import { resetWaveformCache } from '../waveform/renderer.js';   // add this import
import { getCtxTime } from '../audio/engine.js';

let rafId = null;
let boundReqId = 0;

export function updatePlayerUIStart(name, durationSec, buffer){
  if (nowPlayingTitle) nowPlayingTitle.textContent = `Now Playing: ${name}`;
  if (playTotalEl) playTotalEl.textContent = secondsToClock(durationSec);
  if (playTimeEl) playTimeEl.textContent = '0:00';
  if (playBar) playBar.style.width = '0%';

  resetWaveformCache();           // ensure we don’t reuse old bars
  redrawWaveform(buffer);

  if (rafId) cancelAnimationFrame(rafId);
  const reqId = ++boundReqId;

  const tick = ()=>{
    if (reqId !== boundReqId) return; // stale loop
    if (!state.currentPlayingId) return;
    const now = getCtxTime();
    const elapsed = Math.max(0, now - state.startedAtCtxTime);
    const clamped = Math.min(state.currentDuration, elapsed);
    const frac = state.currentDuration ? (clamped / state.currentDuration) : 0;

    if (playTimeEl) playTimeEl.textContent = secondsToClock(clamped);
    if (playBar) playBar.style.width = (frac * 100) + '%';

    renderComposite(frac);

    if (clamped >= state.currentDuration){
      if (playBar) playBar.style.width = '100%';
      return;
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

export function clearPlayerUI(){
  if (nowPlayingTitle) nowPlayingTitle.textContent = 'Now Playing';
  if (playTimeEl) playTimeEl.textContent = '0:00';
  if (playTotalEl) playTotalEl.textContent = '0:00';
  if (playBar) playBar.style.width = '0%';
  if (rafId) cancelAnimationFrame(rafId);
  drawPlaceholderWave();
}

export function onPlaybackEndedVisuals(){
  if (rafId) cancelAnimationFrame(rafId);
  if (playTimeEl) playTimeEl.textContent = '0:00';
  if (playBar) playBar.style.width = '0%';
  renderComposite(0);
}
