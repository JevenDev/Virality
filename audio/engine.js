import { state, setState } from '../state/store.js';
import { generateImpulseResponse } from '../dsp/impulse.js';

let ctx = null;

// id -> graph
const playing = new Map();

export function ensureCtx(){
  if (!ctx){
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

export function getCtx(){ return ctx; }
export function getCtxTime(){ return ctx ? ctx.currentTime : 0; }
export function getPlayingEntries(){ return Array.from(playing.entries()); }
export function getGraph(id){ return playing.get(id); }

export function disconnectGraph(g){
  try{ g.src.onended = null; g.src.stop(0); }catch{}
  try{ g.src.disconnect(); g.dry.disconnect(); g.wet.disconnect(); }catch{}
}

export function stopGraph(id){
  const g = playing.get(id);
  if (g){
    disconnectGraph(g);
    playing.delete(id);
  }
}

export function stopAllGraphs(){
  for (const [id, g] of Array.from(playing.entries())){
    disconnectGraph(g);
    playing.delete(id);
  }
}

export function createGraphForBuffer(buf, offsetSec){
  const ac = ensureCtx();
  if (ac.state === 'suspended') { ac.resume().catch(()=>{}); }

  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = state.playbackRate;

  const dry = ac.createGain();
  const wet = ac.createGain();
  dry.gain.value = 1 - state.reverbMix;
  wet.gain.value = state.reverbMix;

  const conv = ac.createConvolver();
  const tail = Math.min(6, Math.max(1.5, state.reverbDecay * 1.2));
  conv.buffer = generateImpulseResponse(ac, tail, state.reverbDecay);

  src.connect(dry).connect(ac.destination);
  src.connect(conv).connect(wet).connect(ac.destination);

  return { src, dry, wet, convolver: conv, offsetSec };
}

export function startGraphForItem(item, buf, offsetSec=0, onended){
  const g = createGraphForBuffer(buf, offsetSec);
  const ac = ensureCtx();
  const sourceOffset = Math.max(0, Math.min(buf.duration - 0.001, offsetSec * state.playbackRate));

  g.src.onended = onended;
  try{ g.src.start(0, sourceOffset); }catch{ g.src.start(0); }

  playing.set(item.id, g);
  setState({
    currentPlayingId: item.id,
    currentItem: item,
    currentBuffer: buf,
    allowScrub: true,
    isPaused: false,
    pausedOffsetSec: offsetSec || 0,
    startedAtCtxTime: ac.currentTime - offsetSec,
  });
}

export function updateLiveParamsOnGraph(g){
  try{ if (g.src?.playbackRate) g.src.playbackRate.value = state.playbackRate; }catch{}
  try{
    if (g.dry && g.wet){
      g.dry.gain.value = 1 - state.reverbMix;
      g.wet.gain.value = state.reverbMix;
    }
  }catch{}
  try{
    if (g.convolver && ctx){
      const tail = Math.min(6, Math.max(1.5, state.reverbDecay * 1.2));
      g.convolver.buffer = generateImpulseResponse(ctx, tail, state.reverbDecay);
    }
  }catch{}
}
