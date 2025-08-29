import { state, setState } from '../state/store.js';
import { newSession, currentSession, isCurrent } from './session.js';
import { ensureCtx, getCtx, getCtxTime, stopGraph, stopAllGraphs, startGraphForItem, getGraph } from './engine.js';
import { isItemInQueue } from '../state/selectors.js';
import { updatePlayerUIStart, clearPlayerUI, onPlaybackEndedVisuals } from '../ui/player.js';

export function stopPreview(id, keepUI){
  const g = getGraph(id);
  if (g){
    stopGraph(id);
  }
  if (state.currentPlayingId === id){
    setState({
      currentPlayingId: null,
      allowScrub: false,
      isPaused: false,
      pausedOffsetSec: 0,
    });
    if (!keepUI) clearPlayerUI();
  }
}

export function stopAllPreviews(keepUI){
  stopAllGraphs();
  setState({
    currentPlayingId: null,
    allowScrub: false,
  });
  if (!keepUI){
    setState({ isPaused: false, pausedOffsetSec: 0 });
    clearPlayerUI();
  }
}

export function startBufferPlayback(buf, item, offsetSec=0, reqId=currentSession()){
  if (!isCurrent(reqId)) return;
  stopAllPreviews(true);

  const ac = ensureCtx();
  if (ac.state === 'suspended'){ ac.resume().catch(()=>{}); }
  if (!isCurrent(reqId)) return;

  const stretched = buf.duration / Math.max(0.001, state.playbackRate);
  setState({ currentDuration: stretched });
  updatePlayerUIStart(item.name, stretched, buf);

  startGraphForItem(item, buf, offsetSec, ()=>{
    if (!isCurrent(reqId)) return;
    // remove and reset flags/UI
    setState({ currentPlayingId: null });
    if (isItemInQueue(item.id)){
      onPlaybackEndedVisuals();
      setState({ allowScrub: true, isPaused: false, pausedOffsetSec: 0 });
    } else {
      clearPlayerUI();
      setState({ currentBuffer: null, currentItem: null, allowScrub: false, isPaused: false, pausedOffsetSec: 0 });
    }
  });
}

export async function playExclusive(item, decoder){
  const req = newSession();
  try{
    ensureCtx();
    const arr = await decoder(item.file);
    if (!isCurrent(req)) return;
    const ac = getCtx();
    const buf = await ac.decodeAudioData(arr);
    if (!isCurrent(req)) return;
    setState({ isPaused: false, pausedOffsetSec: 0 });
    startBufferPlayback(buf, item, 0, req);
  }catch(e){
    if (isCurrent(req)) console.error(e);
  }
}
