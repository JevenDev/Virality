import { globalBtn, waveCanvas, playBar } from './elements.js';
import { state, setState, subscribe } from '../state/store.js';
import { newSession } from '../audio/session.js';
import { stopAllPreviews, startBufferPlayback } from '../audio/transport.js';
import { getCtxTime } from '../audio/engine.js';

function onClick(){
  if (!state.currentBuffer || !state.currentItem) return;

  if (state.currentPlayingId){
    // pause
    const now = getCtxTime();
    const elapsed = Math.max(0, now - state.startedAtCtxTime);
    setState({ pausedOffsetSec: Math.min(state.currentDuration, elapsed) });
    stopAllPreviews(true); // keep UI
    setState({ isPaused: true, allowScrub: true });
  } else {
    // resume (or start fresh)
    const req = newSession();
    const startAt = state.isPaused ? state.pausedOffsetSec : 0;
    startBufferPlayback(state.currentBuffer, state.currentItem, startAt, req);
  }
}

function attachHandler(btn){
  if (!btn) return;
  if (!btn._boundPlayPause){
    btn.addEventListener('click', onClick);
    btn._boundPlayPause = true;
  }
}

export function ensureGlobalPlayButton(){
  // row after the progress bar
  const timelineRow = playBar?.parentElement || waveCanvas?.parentElement;

  // Ensure container row exists
  let row = document.getElementById('playerControlsRow');
  if (!row){
    row = document.createElement('div');
    row.id = 'playerControlsRow';
    row.className = 'player-controls-row';
    if (timelineRow && timelineRow.insertAdjacentElement){
      timelineRow.insertAdjacentElement('afterend', row);
    } else {
      (waveCanvas?.parentElement || document.body).appendChild(row);
    }
  }

  // Use existing button or create one
  let btn = document.getElementById('globalPlayPause') || globalBtn;
  if (!btn){
    btn = document.createElement('button');
    btn.id = 'globalPlayPause';
    btn.className = 'btn';
    btn.textContent = 'Play';
    row.appendChild(btn);
  } else if (btn.parentElement !== row){
    btn.parentElement?.removeChild(btn);
    row.appendChild(btn);
  }
  attachHandler(btn);
}

export function bindGlobalButtonAuto(){
  ensureGlobalPlayButton();
  subscribe(()=> updateGlobalBtn());
  updateGlobalBtn();
}

export function updateGlobalBtn(){
  const btn = document.getElementById('globalPlayPause') || globalBtn;
  if (!btn) return;
  btn.textContent = state.currentPlayingId ? 'Pause' : 'Play';
}
