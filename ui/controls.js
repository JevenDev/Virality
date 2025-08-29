import { state, setState } from '../state/store.js';
import { rate, mix, decay, rateVal, mixVal, decayVal } from './elements.js';
import { updatePresetNameFromSliders } from './presets.js';
import { applyLiveChanges, onRateChange } from '../audio/liveparams.js';

function elapsedProvider(){
  return [state.currentBuffer, state.currentItem, state.startedAtCtxTime, state.currentDuration];
}

export function bindControls(){
  rate?.addEventListener('input', e=>{
    const v = parseFloat(e.target.value);
    setState({ playbackRate: v });
    if (rateVal) rateVal.textContent = v.toFixed(2) + 'x';
    onRateChange(elapsedProvider);
  });
  mix?.addEventListener('input', e=>{
    const v = parseFloat(e.target.value);
    setState({ reverbMix: v });
    if (mixVal) mixVal.textContent = Math.round(v * 100) + '%';
    applyLiveChanges();
    updatePresetNameFromSliders();
  });
  decay?.addEventListener('input', e=>{
    const v = parseFloat(e.target.value);
    setState({ reverbDecay: v });
    if (decayVal) decayVal.textContent = v.toFixed(1) + 's';
    applyLiveChanges();
    updatePresetNameFromSliders();
  });
}
