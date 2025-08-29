import { state } from '../state/store.js';
import { drawPlaceholderWave } from '../waveform/composite.js';
import { waveCanvas } from './elements.js';
import { redrawWaveform } from '../waveform/composite.js';

export function adjustStickyOffsets(){
  const header = document.querySelector('.topbar.top-fixed');
  const h = header ? header.getBoundingClientRect().height : 64;
  document.documentElement.style.setProperty('--topbar-h', `${Math.round(h)}px`);
}

export function observeHeaderResize(){
  const header = document.querySelector('.topbar.top-fixed');
  if (!header) return;
  const ro = new ResizeObserver(()=>{
    adjustStickyOffsets();
    if (state.currentBuffer){
      redrawWaveform(state.currentBuffer);
    } else {
      drawPlaceholderWave();
    }
  });
  ro.observe(header);
  window.addEventListener('resize', ()=>{
    adjustStickyOffsets();
    if (state.currentBuffer){
      redrawWaveform(state.currentBuffer);
    } else {
      drawPlaceholderWave();
    }
  });
}
