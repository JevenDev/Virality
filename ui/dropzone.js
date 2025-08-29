import { dropzone, fileInput, clearAllBtn } from './elements.js';
import { collectFilesFromItems } from '../util/dirwalk.js';
import { addFiles, clearAll } from './list.js';

export function bindDropzone(){
  ['dragenter','dragover','dragleave','drop'].forEach(evt=>{
    document.addEventListener(evt, (e)=>{
      if (evt==='dragover' || evt==='drop') e.preventDefault();
    }, false);
  });

  let dragDepth = 0;
  dropzone?.addEventListener('dragenter', ()=>{ dragDepth++; dropzone.classList.add('hover'); });
  dropzone?.addEventListener('dragleave', ()=>{ dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropzone.classList.remove('hover'); });
  dropzone?.addEventListener('dragover', (e)=> e.preventDefault());
  dropzone?.addEventListener('drop', async(e)=>{
    e.preventDefault(); dragDepth = 0; dropzone.classList.remove('hover');
    const dt = e.dataTransfer;
    let dropped = [];
    if (dt?.items?.length){
      const all = await collectFilesFromItems(dt.items);
      dropped = all.length ? all : Array.from(dt.files || []);
    } else if (dt?.files?.length){
      dropped = Array.from(dt.files);
    }
    if (!dropped.length) return;
    addFiles(dropped);
  });

  fileInput?.addEventListener('change', (e)=>{
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = "";
  });

  clearAllBtn?.addEventListener('click', ()=> clearAll());

  // Make sticky pill clickable to open the file picker
  dropzone?.addEventListener('click', ()=> fileInput?.click());
  dropzone?.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter' || e.key === ' '){
      e.preventDefault(); fileInput?.click();
    }
  });
}
