import { formatSelect } from '../ui/elements.js';
import { PRESETS } from '../util/constants.js';
import { applyPreset, bindPresetButtons } from '../ui/presets.js';
import { adjustStickyOffsets, observeHeaderResize } from '../ui/layout.js';
import { clearPlayerUI } from '../ui/player.js';
import { bindControls } from '../ui/controls.js';
import { bindDropzone } from '../ui/dropzone.js';
import { bindSeek } from '../waveform/seek.js';
import { bindGlobalButtonAuto } from '../ui/globalButton.js';
import { bindDownloads } from '../export/downloads.js';
import { renderList } from '../ui/list.js';

export function boot(){
  if (formatSelect) formatSelect.value = 'wav';
  applyPreset(PRESETS[1]); // Slowed + Reverb default
  adjustStickyOffsets();
  observeHeaderResize();
  clearPlayerUI();

  bindPresetButtons();
  bindControls();
  bindDropzone();
  bindSeek();
  bindGlobalButtonAuto();
  bindDownloads();
  renderList();

  // Self-test
  try{
    if (!(typeof OfflineAudioContext === 'function' || typeof webkitOfflineAudioContext === 'function')){
      console.warn('[SelfTest] OfflineAudioContext not available');
    }
  }catch{}
}
