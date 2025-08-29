import { state, setState } from '../state/store.js';
import { getCtxTime } from './engine.js';
import { newSession } from './session.js';
import { startBufferPlayback } from './transport.js';
import { getPlayingEntries, updateLiveParamsOnGraph } from './engine.js';

export function applyLiveChanges(){
  for (const [, g] of getPlayingEntries()){
    updateLiveParamsOnGraph(g);
  }
}

export function onRateChange(elapsedProvider){
  // Restart playback to preserve visual time
  const [buf, item, startedAtCtxTime, currentDuration] = elapsedProvider();
  if (!buf || !item) return;
  const now = getCtxTime();
  const elapsed = Math.max(0, now - startedAtCtxTime);
  const req = newSession();
  startBufferPlayback(buf, item, elapsed, req);
}
