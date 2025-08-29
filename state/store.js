// Simple app-wide state with pub/sub
const listeners = new Set();

export const state = {
  // queue & current
  files: [],
  currentPlayingId: null,
  currentItem: null,
  currentBuffer: null,

  // playback + FX
  playbackRate: 0.82,
  reverbMix: 0.45,
  reverbDecay: 4.2,
  currentPreset: 'Slowed + Reverb',

  // timing
  currentDuration: 0,
  startedAtCtxTime: 0,
  isPaused: false,
  pausedOffsetSec: 0,

  // UI flags
  allowScrub: false,
  hoverActive: false,
  hoverFrac: 0,

  // counts
  dragDepth: 0,
};

export function setState(patch){
  Object.assign(state, patch);
  for (const fn of Array.from(listeners)) fn(state, patch);
}

export function subscribe(fn){
  listeners.add(fn);
  return () => listeners.delete(fn);
}
