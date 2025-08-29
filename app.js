/********* helpers *********/
const prettyBytes = (n)=>{ if(Math.abs(n)<1024) return n+" B";
  const u=["KB","MB","GB","TB"]; let i=-1; do{ n/=1024; ++i }while(Math.abs(n)>=1024&&i<u.length-1);
  return n.toFixed(1)+" "+u[i];
};
const readFileAsArrayBuffer=(file)=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsArrayBuffer(file);});
const AUDIO_EXT=new Set([".mp3",".wav",".m4a",".aac",".flac",".ogg",".oga",".opus",".webm",".wma",".aiff",".aif",".caf"]);
const isAudioLike=(f)=>!!f&&(f.type?.startsWith("audio/")||AUDIO_EXT.has(((f.name||"").toLowerCase().slice(((f.name||"").lastIndexOf(".")))||"")));

async function collectFilesFromItems(items){const out=[],prom=[];for(const it of items){if(it.kind==="file"){const e=it.getAsEntry?.()||it.webkitGetAsEntry?.();if(e&&e.isDirectory){prom.push(walkDirectory(e,out))}else{const f=it.getAsFile();if(f)out.push(f)}}}await Promise.all(prom);return out}
function walkDirectory(dir,out){return new Promise((resolve)=>{const rd=dir.createReader();const read=()=>{rd.readEntries(async(entries)=>{if(!entries.length)return resolve();for(const ent of entries){if(ent.isFile){await new Promise(res=>ent.file((f)=>{out.push(f);res()},()=>res()))}else if(ent.isDirectory){await walkDirectory(ent,out)}}read()},()=>resolve())};read()})}

function generateImpulseResponse(ctx,duration=3,decay=3){const rate=ctx.sampleRate,len=Math.max(1,Math.floor(rate*Math.max(0.1,duration))),imp=ctx.createBuffer(2,len,rate);
  for(let ch=0;ch<2;ch++){const d=imp.getChannelData(ch);for(let i=0;i<len;i++){d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay)}}return imp;}

function audioBufferToWav(abuf){const numCh=abuf.numberOfChannels,len=abuf.length*numCh*2+44,buf=new ArrayBuffer(len),view=new DataView(buf),w=(o,s)=>{for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i))};
  w(0,"RIFF");view.setUint32(4,36+abuf.length*numCh*2,true);w(8,"WAVE");w(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);
  view.setUint16(22,numCh,true);view.setUint32(24,abuf.sampleRate,true);view.setUint32(28,abuf.sampleRate*numCh*2,true);view.setUint16(32,numCh*2,true);view.setUint16(34,16,true);
  w(36,"data");view.setUint32(40,abuf.length*numCh*2,true);let off=44;const chans=Array.from({length:numCh},(_,c)=>abuf.getChannelData(c));
  for(let i=0;i<abuf.length;i++){for(let ch=0;ch<numCh;ch++){let s=Math.max(-1,Math.min(1,chans[ch][i]));s=s<0?s*0x8000:s*0x7fff;view.setInt16(off,s,true);off+=2}}
  return new Blob([view],{type:"audio/wav"});
}

/* MP3 worker + fallback */
function createMp3WorkerURL(){const code=`importScripts('https://cdn.jsdelivr.net/npm/lamejs@1.2.0/lame.min.js');
function encode(L,R,C,S,K,p){const E=(self.lamejs&&self.lamejs.Mp3Encoder)||(typeof lamejs!=='undefined'&&lamejs.Mp3Encoder);if(!E)throw new Error('lamejs not available in worker');
const e=new E(C,S,K);const B=1152;let parts=[];const T=L.length;for(let i=0;i<T;i+=B){const l=L.subarray(i,i+B);const r=C>1?R.subarray(i,i+B):l;const out=e.encodeBuffer(l,r);if(out.length)parts.push(out);if((i&0x7FFF)===0)p(Math.min(1,i/T))}
const end=e.flush();if(end.length)parts.push(end);return new Blob(parts,{type:'audio/mpeg'})}
self.onmessage=(ev)=>{const {type,left,right,channels,sampleRate,kbps}=ev.data||{};if(type!=='encode')return;try{const b=encode(left,right,channels,sampleRate,kbps,(v)=>self.postMessage({type:'progress',value:v}));self.postMessage({type:'done',blob:b})}catch(err){setTimeout(()=>{throw err;})}}`;
return URL.createObjectURL(new Blob([code],{type:"application/javascript"}))}
function floatTo16BitPCM(f32){const out=new Int16Array(f32.length);for(let i=0;i<f32.length;i++){let s=Math.max(-1,Math.min(1,f32[i]));out[i]=s<0?s*0x8000:s*0x7FFF}return out}
function audioBufferToMp3Worker(abuf,kbps=192,onP=()=>{}){return new Promise((resolve,reject)=>{try{const url=createMp3WorkerURL();const w=new Worker(url);URL.revokeObjectURL(url);
const ch=abuf.numberOfChannels,sr=abuf.sampleRate,L=floatTo16BitPCM(abuf.getChannelData(0).slice()),R=floatTo16BitPCM((ch>1?abuf.getChannelData(1):abuf.getChannelData(0)).slice());
w.onmessage=(e)=>{const m=e.data;if(m.type==='progress')onP(m.value);else if(m.type==='done'){w.terminate();resolve(m.blob)}};w.onerror=(err)=>{w.terminate();reject(err)};
w.postMessage({type:'encode',left:L,right:R,channels:ch,sampleRate:sr,kbps:Number(kbps)||192},[L.buffer,R.buffer])}catch(e){reject(e)}})}
function audioBufferToMp3Main(abuf,kbps=192,onP=()=>{}){if(!window.lamejs?.Mp3Encoder)throw new Error('lamejs not loaded');
  const ch=abuf.numberOfChannels,sr=abuf.sampleRate,enc=new lamejs.Mp3Encoder(ch,sr,Number(kbps)||192),BS=1152,parts=[],L=floatTo16BitPCM(abuf.getChannelData(0)),R=floatTo16BitPCM((ch>1?abuf.getChannelData(1):abuf.getChannelData(0))),T=L.length;
  for(let i=0;i<T;i+=BS){const l=L.subarray(i,i+BS),r=ch>1?R.subarray(i,i+BS):l;const out=enc.encodeBuffer(l,r);if(out.length)parts.push(out);if((i&0x7FFF)===0)onP(Math.min(1,i/T))}
  const end=enc.flush();if(end.length)parts.push(end);return new Blob(parts,{type:'audio/mpeg'})}
async function encodeMp3(abuf,kbps,onP){try{return await audioBufferToMp3Worker(abuf,kbps,onP)}catch(e){console.warn('[mp3] worker failed; falling back',e);return audioBufferToMp3Main(abuf,kbps,onP)}}
function saveBlob(blob,filename){if(typeof saveAs==='function')return saveAs(blob,filename);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)}

/********* state *********/
let files=[]; let ctx=null; const playing=new Map(); let currentPlayingId=null;
let playbackRate=0.82, reverbMix=0.45, reverbDecay=4.2; // default: Slowed + Reverb
const EXPORT_TAIL_SECONDS=0;
let currentPreset='Slowed + Reverb';

/* player UI state */
const playerPanel=document.getElementById('playerPanel');
const nowPlayingTitle=document.getElementById('nowPlayingTitle');
const waveCanvas=document.getElementById('waveCanvas');
const playBar=document.getElementById('playBar');
const playTimeEl=document.getElementById('playTime');
const playTotalEl=document.getElementById('playTotal');
let currentBuffer=null;
let startedAtCtxTime=0;     // ctx.currentTime when started
let currentDuration=0;      // stretched duration (seconds)
let rafId=null;

/********* DOM refs *********/
const rate=document.getElementById('rate');
const mix=document.getElementById('mix');
const decay=document.getElementById('decay');
const rateVal=document.getElementById('rateVal');
const mixVal=document.getElementById('mixVal');
const decayVal=document.getElementById('decayVal');

const dropzone=document.getElementById('dropzone');
const fileInput=document.getElementById('fileInput');
const fileList=document.getElementById('fileList');
const fileCount=document.getElementById('fileCount');
const clearAllBtn=document.getElementById('clearAll');
const downloadAllBtn=document.getElementById('downloadAll');
const formatSelect=document.getElementById('formatSelect');
const bitrateSelect=document.getElementById('bitrateSelect');

const presetDefault=document.getElementById('presetDefault');
const presetSlowed=document.getElementById('presetSlowed');
const presetNightcore=document.getElementById('presetNightcore');
const presetFaded=document.getElementById('presetFaded');

/********* sticky export progress *********/
const progressWrap=document.getElementById('progressWrap');
const progressBar=document.getElementById('progressBar');
const progressText=document.getElementById('progressText');
function showProgress(text='Working…'){progressText.textContent=text;progressBar.style.width='0%';progressWrap.classList.remove('hidden')}
function hideProgress(){progressWrap.classList.add('hidden')}
function setProgress(frac,text){const pct=Math.max(0,Math.min(1,frac))*100;progressBar.style.width=pct+'%';if(text)progressText.textContent=text}

/********* presets *********/
const PRESETS=[
  {name:'Default',rate:1.00,mix:0.00,decay:2.0},
  {name:'Slowed + Reverb',rate:0.82,mix:0.45,decay:4.2},
  {name:'Nightcore',rate:1.25,mix:0.12,decay:2.0},
  {name:'FADED',rate:0.90,mix:0.25,decay:2.0},
];
const EPS=0.005;
function updatePresetNameFromSliders(){
  const p=PRESETS.find(p=>Math.abs(playbackRate-p.rate)<=EPS&&Math.abs(reverbMix-p.mix)<=0.01&&Math.abs(reverbDecay-p.decay)<=0.05);
  currentPreset=p?p.name:'Custom';
}
function applyPreset(p){
  playbackRate=p.rate; reverbMix=p.mix; reverbDecay=p.decay;
  rate.value=p.rate; mix.value=p.mix; decay.value=p.decay;
  rateVal.textContent=p.rate.toFixed(2)+'x';
  mixVal.textContent=Math.round(p.mix*100)+'%';
  decayVal.textContent=p.decay.toFixed(1)+'s';
  currentPreset=p.name;
  applyLiveChanges();
}
presetDefault.addEventListener('click',()=>applyPreset(PRESETS[0]));
presetSlowed.addEventListener('click', ()=>applyPreset(PRESETS[1]));
presetNightcore.addEventListener('click',()=>applyPreset(PRESETS[2]));
presetFaded.addEventListener('click',   ()=>applyPreset(PRESETS[3]));

/********* prevent browser opening dropped files *********/
['dragenter','dragover','dragleave','drop'].forEach(evt=>{
  document.addEventListener(evt,(e)=>{if(evt==='dragover'||evt==='drop')e.preventDefault()},false)
});
let dragDepth=0;
dropzone.addEventListener('dragenter',()=>{dragDepth++;dropzone.classList.add('hover')});
dropzone.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)dropzone.classList.remove('hover')});
dropzone.addEventListener('dragover',(e)=>{e.preventDefault()});
dropzone.addEventListener('drop',async(e)=>{
  e.preventDefault();dragDepth=0;dropzone.classList.remove('hover');
  const dt=e.dataTransfer;let dropped=[];
  if(dt?.items?.length){const all=await collectFilesFromItems(dt.items);dropped=all.length?all:Array.from(dt.files||[])}
  else if(dt?.files?.length){dropped=Array.from(dt.files)}
  if(!dropped.length)return;addFiles(dropped);
});
fileInput.addEventListener('change',(e)=>{if(e.target.files?.length)addFiles(e.target.files);e.target.value=""});
clearAllBtn.addEventListener('click',()=>{stopAllPreviews();files=[];renderList()});

/********* list UI *********/
function refreshCounts(){fileCount.textContent=String(files.length);clearAllBtn.disabled=!files.length;downloadAllBtn.disabled=!files.length}
function addFiles(listLike){
  const arr=Array.from(listLike),ok=arr.filter(isAudioLike),bad=arr.filter(f=>!isAudioLike(f));
  if(bad.length)console.warn(`[drop] Ignored ${bad.length} non-audio file(s).`);
  if(!ok.length)return;
  const mapped=ok.map(f=>({id:Math.random().toString(36).slice(2)+Date.now().toString(36),file:f,name:f.name,size:f.size}));
  files=files.concat(mapped);renderList();
  playExclusive(mapped[mapped.length-1]).catch(console.error);
}
function renderList(){
  refreshCounts();fileList.innerHTML='';
  for(const it of files){
    const row=document.createElement('div');row.className='file';
    row.innerHTML=`
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
    row.querySelector('[data-act="play"]').addEventListener('click',()=>playExclusive(it));
    row.querySelector('[data-act="stop"]').addEventListener('click',()=>stopPreview(it.id));
    row.querySelector('[data-act="download"]').addEventListener('click',()=>downloadOne(it));
    row.querySelector('[data-act="remove"]').addEventListener('click',()=>removeItem(it.id));
    fileList.appendChild(row);
  }
}
function removeItem(id){stopPreview(id);files=files.filter(f=>f.id!==id);renderList()}

/********* player / preview *********/
function secondsToClock(s){s=Math.max(0,s|0);const m=(s/60|0),ss=(s%60).toString().padStart(2,"0");return `${m}:${ss}`}
function updatePlayerUIStart(name,durationSec,buffer){
  nowPlayingTitle.textContent=`Now Playing: ${name}`;
  playTotalEl.textContent=secondsToClock(durationSec);
  playTimeEl.textContent='0:00'; playBar.style.width='0%';
  playerPanel.classList.remove('hidden');
  currentDuration=durationSec; currentBuffer=buffer;
  drawWaveform(buffer);
  if(rafId)cancelAnimationFrame(rafId);
  const tick=()=>{ if(!ctx||currentPlayingId==null) return;
    const elapsed = ctx.currentTime - startedAtCtxTime; // real-world time since start
    const clamped = Math.min(currentDuration, elapsed);
    playTimeEl.textContent = secondsToClock(clamped);
    playBar.style.width = (clamped / currentDuration * 100) + '%';
    if (clamped >= currentDuration) { playBar.style.width = '100%'; return; }
    rafId=requestAnimationFrame(tick);
  };
  rafId=requestAnimationFrame(tick);
}
function clearPlayerUI(){playerPanel.classList.add('hidden');if(rafId)cancelAnimationFrame(rafId);playBar.style.width='0%'}
function stopPreview(id){if(!playing.has(id))return;try{playing.get(id).src.stop()}catch{} playing.delete(id); if(currentPlayingId===id){currentPlayingId=null; clearPlayerUI();}}
function stopAllPreviews(){for(const id of Array.from(playing.keys()))stopPreview(id);currentPlayingId=null; clearPlayerUI();}

async function playExclusive(item){
  stopAllPreviews();
  if(!ctx) ctx=new (window.AudioContext||window.webkitAudioContext)();
  const arr=await readFileAsArrayBuffer(item.file);
  const buf=await ctx.decodeAudioData(arr);
  const src=ctx.createBufferSource(); src.buffer=buf; src.playbackRate.value=playbackRate;
  const dry=ctx.createGain(); const wet=ctx.createGain(); dry.gain.value=1-reverbMix; wet.gain.value=reverbMix;
  const conv=ctx.createConvolver(); conv.buffer=generateImpulseResponse(ctx,Math.min(6,Math.max(1.5,reverbDecay*1.2)),reverbDecay);
  src.connect(dry).connect(ctx.destination); src.connect(conv).connect(wet).connect(ctx.destination);
  src.onended=()=>{playing.delete(item.id); if(currentPlayingId===item.id){currentPlayingId=null; clearPlayerUI();}};
  playing.set(item.id,{src,dry,wet,convolver:conv});
  currentPlayingId=item.id;
  startedAtCtxTime=ctx.currentTime;
  const stretched = buf.duration / Math.max(0.001, playbackRate);
  updatePlayerUIStart(item.name, stretched, buf);
  src.start(0);
}

/* Draw waveform (mono from left channel) */
function drawWaveform(buffer){
  const c=waveCanvas, w=c.width, h=c.height, ctx2=c.getContext('2d');
  ctx2.clearRect(0,0,w,h);
  ctx2.fillStyle='#1a1a1a'; ctx2.fillRect(0,0,w,h);
  const data=buffer.getChannelData(0);
  const step=Math.ceil(data.length / w);
  ctx2.strokeStyle='#2b3a9e'; ctx2.lineWidth=1; ctx2.beginPath();
  for(let x=0;x<w;x++){
    let min=1, max=-1, start=x*step, end=Math.min(start+step,data.length);
    for(let i=start;i<end;i++){const v=data[i]; if(v<min)min=v; if(v>max)max=v;}
    const y1=(1+min)*0.5*h, y2=(1+max)*0.5*h;
    ctx2.moveTo(x,y1); ctx2.lineTo(x,y2);
  }
  ctx2.stroke();
}

/********* live controls *********/
function applyLiveChanges(){
  for (const [,g] of playing.entries()){
    try{ if(g.src?.playbackRate) g.src.playbackRate.value=playbackRate }catch{}
    try{ if(g.dry&&g.wet){ g.dry.gain.value=1-reverbMix; g.wet.gain.value=reverbMix } }catch{}
    try{ if(g.convolver&&ctx){ const tail=Math.min(6,Math.max(1.5,reverbDecay*1.2)); g.convolver.buffer=generateImpulseResponse(ctx,tail,reverbDecay) } }catch{}
  }
  updatePresetNameFromSliders();
}
rate.addEventListener('input',e=>{playbackRate=parseFloat(e.target.value);rateVal.textContent=playbackRate.toFixed(2)+'x';applyLiveChanges()});
mix.addEventListener('input',e=>{reverbMix=parseFloat(e.target.value);mixVal.textContent=Math.round(reverbMix*100)+'%';applyLiveChanges()});
decay.addEventListener('input',e=>{reverbDecay=parseFloat(e.target.value);decayVal.textContent=reverbDecay.toFixed(1)+'s';applyLiveChanges()});

/********* downloads *********/
downloadAllBtn.addEventListener('click',downloadAll);
async function downloadAll(){
  if(!files.length)return;
  const fmt=(formatSelect?.value||'wav').toLowerCase();
  const kbps=Number(bitrateSelect?.value||192);
  showProgress('Starting…');
  const zip=new JSZip();
  try{
    for(let i=0;i<files.length;i++){
      const it=files[i];
      setProgress(i/files.length,`Rendering… (${i}/${files.length}) — ${it.name}`);
      const rendered=await renderAudioBuffer(it.file);
      let blob;
      if(fmt==='wav'){ blob=audioBufferToWav(rendered); setProgress((i+1)/files.length,`Adding… (${i+1}/${files.length}) — ${it.name}`) }
      else{
        blob=await encodeMp3(rendered,kbps,(p)=>{const overall=(i+0.5+p*0.5)/files.length; setProgress(overall,`Encoding MP3… ${(p*100|0)}% (${i+1}/${files.length}) — ${it.name}`)})
      }
      const arrBuf=await blob.arrayBuffer();
      const base=it.name.replace(/\.[^/.]+$/,''); const ext=fmt==='mp3'?'mp3':'wav';
      zip.file(`${base}_[${currentPreset}].${ext}`,arrBuf);
      setProgress((i+1)/files.length,`Queued (${i+1}/${files.length}) — ${it.name}`);
    }
    setProgress(1,'Packaging ZIP…');
    const content=await zip.generateAsync({type:'blob'});
    saveBlob(content,`[${currentPreset}] Batch Download.zip`);
    setProgress(1,'Done ✓');
  }catch(e){console.error(e);alert('Render failed. See console for details.')}
  finally{setTimeout(hideProgress,800)}
}
async function downloadOne(item){
  const fmt=(formatSelect?.value||'wav').toLowerCase();
  const kbps=Number(bitrateSelect?.value||192);
  try{
    showProgress(`Rendering… — ${item.name}`); setProgress(0);
    const rendered=await renderAudioBuffer(item.file);
    let blob;
    if(fmt==='wav'){ blob=audioBufferToWav(rendered); setProgress(1,`Exporting WAV… — ${item.name}`)}
    else{ blob=await encodeMp3(rendered,kbps,(p)=>setProgress(p,`Encoding MP3… ${(p*100|0)}% — ${item.name}`)) }
    const base=item.name.replace(/\.[^/.]+$/,''); const ext=fmt==='mp3'?'mp3':'wav';
    saveBlob(blob,`${base}_[${currentPreset}].${ext}`);
    setProgress(1,`Done ✓ — ${item.name}`);
  }catch(e){console.error(e);alert('Render failed. See console for details.')}
  finally{setTimeout(hideProgress,800)}
}

/********* render (trim tail) *********/
async function renderAudioBuffer(file){
  const tmp=new (window.AudioContext||window.webkitAudioContext)();
  const arr=await readFileAsArrayBuffer(file);
  const srcBuf=await tmp.decodeAudioData(arr.slice(0));
  const rate=tmp.sampleRate; await tmp.close();

  const stretched=srcBuf.duration/Math.max(0.05,playbackRate); // output duration
  const tail=Math.min(6,Math.max(1.5,reverbDecay*1.2));
  const total=stretched+tail;

  const off=new OfflineAudioContext(srcBuf.numberOfChannels,Math.ceil(total*rate),rate);
  const src=off.createBufferSource(); src.buffer=srcBuf; src.playbackRate.value=playbackRate;
  const dry=off.createGain(), wet=off.createGain(); dry.gain.value=1-reverbMix; wet.gain.value=reverbMix;
  const conv=off.createConvolver(); conv.buffer=generateImpulseResponse(off,tail,reverbDecay);
  src.connect(dry).connect(off.destination); src.connect(conv).connect(wet).connect(off.destination); src.start(0);
  const rendered=await off.startRendering();

  const targetFrames=Math.min(rendered.length,Math.max(1,Math.floor((stretched+EXPORT_TAIL_SECONDS)*rate)));
  if(targetFrames>=rendered.length) return rendered;

  const trimmed=new AudioBuffer({length:targetFrames,numberOfChannels:rendered.numberOfChannels,sampleRate:rendered.sampleRate});
  for(let ch=0;ch<rendered.numberOfChannels;ch++){trimmed.getChannelData(ch).set(rendered.getChannelData(ch).subarray(0,targetFrames))}
  return trimmed;
}

/********* init: default format + preset *********/
(function init(){
  if (formatSelect) formatSelect.value='wav';   // default export WAV
  applyPreset(PRESETS[1]);                      // default preset: Slowed + Reverb
})();

/* tiny self-test */
(function(){try{if(!(typeof OfflineAudioContext==='function'||typeof webkitOfflineAudioContext==='function'))console.warn('[SelfTest] OfflineAudioContext not available')}catch{}})();
