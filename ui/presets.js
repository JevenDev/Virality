import { state, setState } from '../state/store.js';
import { PRESETS, EPS } from '../util/constants.js';
import {
  rate, mix, decay, rateVal, mixVal, decayVal,
  presetDefault, presetSlowed, presetNightcore, presetFaded, presetGrid
} from './elements.js';
import { applyLiveChanges } from '../audio/liveparams.js';
import { addUserPreset, loadUserPresets, removeUserPreset } from '../data/presetsStore.js';

export function updatePresetNameFromSliders(){
  const p = PRESETS.find(p =>
    Math.abs(state.playbackRate - p.rate) <= EPS &&
    Math.abs(state.reverbMix   - p.mix ) <= 0.01 &&
    Math.abs(state.reverbDecay - p.decay) <= 0.05
  );
  setState({ currentPreset: p ? p.name : 'Custom' });
}

export function applyPreset(p){
  setState({
    playbackRate: p.rate,
    reverbMix:    p.mix,
    reverbDecay:  p.decay,
  });
  if (rate)   rate.value   = p.rate;
  if (mix)    mix.value    = p.mix;
  if (decay)  decay.value  = p.decay;
  if (rateVal)  rateVal.textContent  = p.rate.toFixed(2) + 'x';
  if (mixVal)   mixVal.textContent   = Math.round(p.mix * 100) + '%';
  if (decayVal) decayVal.textContent = p.decay.toFixed(1) + 's';
  setState({ currentPreset: p.name });
  applyLiveChanges();
}

export function bindPresetButtons(){
  presetDefault?.addEventListener('click', ()=> applyPreset(PRESETS[0]));
  presetSlowed?.addEventListener('click',  ()=> applyPreset(PRESETS[1]));
  presetNightcore?.addEventListener('click',()=> applyPreset(PRESETS[2]));
  presetFaded?.addEventListener('click',   ()=> applyPreset(PRESETS[3]));
  ensureSaveButton();
  renderUserPresets();
}

/* ---------- NEW: Save button + user presets ---------- */

function ensureSaveButton(){
  if (!presetGrid) return;
  if (presetGrid.querySelector('#presetSave')) return;

  const btn = document.createElement('button');
  btn.id = 'presetSave';
  btn.className = 'btn btn-alt';         // slightly different grey
  btn.title = 'Save current sliders as a new preset';
  btn.textContent = '＋ Save preset';     // fullwidth plus looks nice
  btn.addEventListener('click', onSavePresetClick);

  // insert at the end of grid
  presetGrid.appendChild(btn);
}

function onSavePresetClick(){
  const name = (prompt('Name your preset:', state.currentPreset === 'Custom' ? '' : state.currentPreset) || '').trim();
  if (!name) return;

  const preset = {
    name,
    rate:  state.playbackRate,
    mix:   state.reverbMix,
    decay: state.reverbDecay,
  };
  const list = addUserPreset(preset);
  renderUserPresets(list);
  // optionally switch current preset label to this name
  setState({ currentPreset: name });
}

function renderUserPresets(list = loadUserPresets()){
  if (!presetGrid) return;

  // clear old user presets
  presetGrid.querySelectorAll('.user-preset').forEach(el => el.remove());

  // find or create hint
  let hint = presetGrid.querySelector('.preset-hint');
  if (!hint){
    hint = document.createElement('div');
    hint.className = 'preset-hint';
    hint.textContent = 'Tip: Hold Alt + Click a preset to delete it';
    presetGrid.appendChild(hint);
  }

  // insert presets ABOVE the hint
  for (const p of list){
    const b = document.createElement('button');
    b.className = 'btn user-preset';
    b.textContent = p.name;
    b.title = 'Click to apply. Hold Alt + Click to delete.';

    b.addEventListener('click', (e)=>{
      if (e.altKey){
        renderUserPresets(removeUserPreset(p.name));
        return;
      }
      applyPreset(p);
    });

    presetGrid.insertBefore(b, hint);
  }
}