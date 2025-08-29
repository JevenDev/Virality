import { setState } from '../state/store.js';
import { clearPlayerUI } from './player.js';
import { stopAllPreviews } from '../audio/transport.js';

export function clearAllState(){
  stopAllPreviews(false); // also clears UI
  setState({
    files: [],
    currentBuffer: null,
    currentItem: null,
    isPaused: false,
    pausedOffsetSec: 0,
    allowScrub: false,
    hoverActive: false,
    hoverFrac: 0,
  });
  clearPlayerUI();
}
