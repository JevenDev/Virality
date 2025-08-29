import { state } from '../state/store.js';
import { formatSelect, bitrateSelect, downloadAllBtn } from '../ui/elements.js';
import { showProgress, hideProgress, setProgress } from '../ui/progress.js';
import { renderAudioBuffer } from './render.js';
import { audioBufferToWav } from '../dsp/convert.js';
import { encodeMp3 } from '../dsp/mp3.js';
import { saveBlob } from '../util/save.js';

function getJSZip(){
  const J = window.JSZip;
  if (!J){
    alert('JSZip is not loaded. Include it before app.js, e.g. <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>');
    throw new Error('JSZip not found on window');
  }
  return J;
}

export function bindDownloads(){
  downloadAllBtn?.addEventListener('click', downloadAll);
}

export async function downloadAll(){
  if (!state.files.length) return;
  const JSZip = getJSZip();
  const fmt = (formatSelect?.value || 'wav').toLowerCase();
  const kbps = Number(bitrateSelect?.value || 192);

  showProgress('Starting…');
  const zip = new JSZip();
  try{
    for (let i=0; i<state.files.length; i++){
      const it = state.files[i];
      setProgress(i/state.files.length, `Rendering… (${i}/${state.files.length}) — ${it.name}`);
      const rendered = await renderAudioBuffer(it.file);
      let blob;
      if (fmt === 'wav'){
        blob = audioBufferToWav(rendered);
        setProgress((i+1)/state.files.length, `Adding… (${i+1}/${state.files.length}) — ${it.name}`);
      } else {
        blob = await encodeMp3(rendered, kbps, (p)=>{
          const overall = (i + 0.5 + p*0.5)/state.files.length;
          setProgress(overall, `Encoding MP3… ${(p*100|0)}% (${i+1}/${state.files.length}) — ${it.name}`);
        });
      }
      const arrBuf = await blob.arrayBuffer();
      const base = it.name.replace(/\.[^/.]+$/, '');
      const ext  = fmt === 'mp3' ? 'mp3' : 'wav';
      zip.file(`${base}_[${state.currentPreset}].${ext}`, arrBuf);
      setProgress((i+1)/state.files.length, `Queued (${i+1}/${state.files.length}) — ${it.name}`);
    }
    setProgress(1,'Packaging ZIP…');
    const content = await zip.generateAsync({type:'blob'});
    saveBlob(content, `[${state.currentPreset}] Batch Download.zip`);
    setProgress(1,'Done ✓');
  }catch(e){
    console.error(e);
    alert('Render failed. See console for details.');
  } finally {
    setTimeout(hideProgress, 800);
  }
}

export async function downloadOne(item){
  const fmt = (formatSelect?.value || 'wav').toLowerCase();
  const kbps = Number(bitrateSelect?.value || 192);
  try{
    showProgress(`Rendering… — ${item.name}`);
    setProgress(0);
    const rendered = await renderAudioBuffer(item.file);
    let blob;
    if (fmt === 'wav'){
      blob = audioBufferToWav(rendered);
      setProgress(1, `Exporting WAV… — ${item.name}`);
    } else {
      blob = await encodeMp3(rendered, kbps, (p)=> setProgress(p, `Encoding MP3… ${(p*100|0)}% — ${item.name}`));
    }
    const base = item.name.replace(/\.[^/.]+$/, '');
    const ext  = fmt === 'mp3' ? 'mp3' : 'wav';
    saveBlob(blob, `${base}_[${state.currentPreset}].${ext}`);
    setProgress(1, `Done ✓ — ${item.name}`);
  }catch(e){
    console.error(e);
    alert('Render failed. See console for details.');
  } finally {
    setTimeout(hideProgress, 800);
  }
}
