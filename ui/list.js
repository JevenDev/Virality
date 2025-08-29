// ui/list.js
import { state, setState } from '../state/store.js';
import { fileList, fileCount, clearAllBtn, downloadAllBtn } from './elements.js';
import { prettyBytes } from '../util/bytes.js';
import { playExclusive, stopPreview } from '../audio/transport.js';
import { readFileAsArrayBuffer, isAudioLike } from '../util/files.js';
import { clearAllState } from './miscActions.js';

export function refreshCounts(){
  if (fileCount) fileCount.textContent = String(state.files.length);
  if (clearAllBtn) clearAllBtn.disabled = !state.files.length;
  if (downloadAllBtn) downloadAllBtn.disabled = !state.files.length;   // enable/disable properly
}

export function renderList(){
  refreshCounts();
  if (!fileList) return;
  fileList.innerHTML = '';
  for (const it of state.files){
    const row = document.createElement('div');
    row.className = 'file';
    row.innerHTML = `
      <div class="meta">
        <div class="logo" style="width:28px;height:28px;">🎵</div>
        <div><div class="name">${it.name}</div><div class="size">${prettyBytes(it.size)}</div></div>
      </div>
      <div class="actions">
        <button class="btn" data-act="play">Play</button>
        <button class="btn" data-act="stop">Stop</button>
        <button class="btn" data-act="download">Download</button>
        <button class="btn" data-act="remove">Remove</button>
      </div>`;

    row.querySelector('[data-act="play"]')?.addEventListener('click', ()=> playExclusive(it, readFileAsArrayBuffer));
    row.querySelector('[data-act="stop"]')?.addEventListener('click', ()=> stopPreview(it.id, false));
    row.querySelector('[data-act="download"]')?.addEventListener('click', async ()=> {
      const { downloadOne } = await import('../export/downloads.js');
      downloadOne(it);
    });
    row.querySelector('[data-act="remove"]')?.addEventListener('click', ()=> removeItem(it.id));

    fileList.appendChild(row);
  }
}

export function addFiles(listLike){
  const arr = Array.from(listLike);
  const ok  = arr.filter(isAudioLike);
  const bad = arr.filter(f=> !isAudioLike(f));
  if (bad.length) console.warn(`[drop] Ignored ${bad.length} non-audio file(s).`);
  if (!ok.length) return;

  const mapped = ok.map(f=>({
    id: Math.random().toString(36).slice(2) + Date.now().toString(36),
    file: f, name: f.name, size: f.size
  }));

  setState({ files: state.files.concat(mapped) });
  renderList();

  // autoplay the last one using the actual decoder function (not a promise)
  playExclusive(mapped[mapped.length - 1], readFileAsArrayBuffer);
}

export function removeItem(id){
  const wasCurrent = state.currentItem && state.currentItem.id === id;
  stopPreview(id, false);
  setState({ files: state.files.filter(f=> f.id !== id) });
  if (wasCurrent){
    setState({
      currentBuffer: null,
      currentItem: null,
      isPaused: false,
      pausedOffsetSec: 0,
      allowScrub: false,
      hoverActive: false,
      hoverFrac: 0,
    });
  }
  renderList();
}

export function clearAll(){
  clearAllState();
  renderList();
}
