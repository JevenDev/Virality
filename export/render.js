import { state } from '../state/store.js';
import { EXPORT_TAIL_SECONDS } from '../util/constants.js';
import { generateImpulseResponse } from '../dsp/impulse.js';

export async function renderAudioBuffer(file){
  const AC = window.AudioContext || window.webkitAudioContext;
  const tmp = new AC();
  const arr = await file.arrayBuffer();
  const srcBuf = await tmp.decodeAudioData(arr.slice(0));
  const rate = tmp.sampleRate;
  await tmp.close();

  const stretched = srcBuf.duration / Math.max(0.05, state.playbackRate);
  const tail = Math.min(6, Math.max(1.5, state.reverbDecay * 1.2));
  const total = stretched + tail;

  const off = new OfflineAudioContext(srcBuf.numberOfChannels, Math.ceil(total * rate), rate);
  const src = off.createBufferSource();
  src.buffer = srcBuf;
  src.playbackRate.value = state.playbackRate;

  const dry = off.createGain(), wet = off.createGain();
  dry.gain.value = 1 - state.reverbMix;
  wet.gain.value = state.reverbMix;

  const conv = off.createConvolver();
  conv.buffer = generateImpulseResponse(off, tail, state.reverbDecay);

  src.connect(dry).connect(off.destination);
  src.connect(conv).connect(wet).connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();

  const targetFrames = Math.min(rendered.length, Math.max(1, Math.floor((stretched + EXPORT_TAIL_SECONDS) * rate)));
  if (targetFrames >= rendered.length) return rendered;

  const trimmed = new AudioBuffer({ length: targetFrames, numberOfChannels: rendered.numberOfChannels, sampleRate: rendered.sampleRate });
  for (let ch=0; ch<rendered.numberOfChannels; ch++){
    trimmed.getChannelData(ch).set(rendered.getChannelData(ch).subarray(0, targetFrames));
  }
  return trimmed;
}
