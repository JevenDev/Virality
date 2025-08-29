// ======= helpers =======
const prettyBytes = (num) => {
  if (Math.abs(num) < 1024) return num + " B";
  const units = ["KB","MB","GB","TB"]; let u=-1;
  do { num/=1024; ++u; } while (Math.abs(num) >= 1024 && u < units.length-1);
  return num.toFixed(1) + " " + units[u];
};

const readFileAsArrayBuffer = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsArrayBuffer(file);
});

// accept by extension when MIME is empty
const AUDIO_EXT = new Set([".mp3",".wav",".m4a",".aac",".flac",".ogg",".oga",".opus",".webm",".wma",".aiff",".aif",".caf"]);
function isAudioLike(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith("audio/")) return true;
  const name = (file.name || "").toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  return AUDIO_EXT.has(ext);
}

// Directory traversal (Chrome/Edge)
async function collectFilesFromItems(items) {
  const out = [];
  const promises = [];
  for (const item of items) {
    if (item.kind === "file") {
      const entry = item.getAsEntry?.() || item.webkitGetAsEntry?.();
      if (entry && entry.isDirectory) {
        promises.push(walkDirectory(entry, out));
      } else {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  await Promise.all(promises);
  return out;
}
function walkDirectory(dirEntry, out) {
  return new Promise((resolve) => {
    const reader = dirEntry.createReader();
    const readBatch = () => {
      reader.readEntries(async (entries) => {
        if (!entries.length) return resolve();
        for (const ent of entries) {
          if (ent.isFile) {
            await new Promise((res) => ent.file((f) => { out.push(f); res(); }, () => res()));
          } else if (ent.isDirectory) {
            await walkDirectory(ent, out);
          }
        }
        readBatch();
      }, () => resolve());
    };
    readBatch();
  });
}

function generateImpulseResponse(ctx, duration = 3, decay = 3) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * Math.max(0.1, duration)));
  const impulse = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return impulse;
}

function audioBufferToWav(abuf) {
  const numCh = abuf.numberOfChannels;
  const length = abuf.length * numCh * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const writeStr = (off, str) => { for (let i=0;i<str.length;i++) view.setUint8(off+i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + abuf.length * numCh * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12,'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, abuf.sampleRate, true);
  view.setUint32(28, abuf.sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36,'data');
  view.setUint32(40, abuf.length * numCh * 2, true);
  let offset = 44;
  const channels = Array.from({length:numCh}, (_,c) => abuf.getChannelData(c));
  for (let i=0;i<abuf.length;i++) {
    for (let ch=0; ch<numCh; ch++) {
      let s = Math.max(-1, Math.min(1, channels[ch][i]));
      s = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(offset, s, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

// ---- MP3 via Web Worker (off main thread) + fallback ----
function createMp3WorkerURL() {
  const code = `
    importScripts('https://cdn.jsdelivr.net/npm/lamejs@1.2.0/lame.min.js');

    function encode(leftI16, rightI16, channels, sampleRate, kbps, postProgress) {
      const Mp3Encoder = (self.lamejs && self.lamejs.Mp3Encoder) || (typeof lamejs !== 'undefined' && lamejs.Mp3Encoder);
      if (!Mp3Encoder) throw new Error('lamejs not available in worker');
      const enc = new Mp3Encoder(channels, sampleRate, kbps);
      const blockSize = 1152;
      let mp3Data = [];
      const total = leftI16.length;

      for (let i = 0; i < total; i += blockSize) {
        const l = leftI16.subarray(i, i + blockSize);
        const r = channels > 1 ? rightI16.subarray(i, i + blockSize) : l;
        const out = enc.encodeBuffer(l, r);
        if (out.length) mp3Data.push(out);
        if ((i & 0x7FFF) === 0) postProgress(Math.min(1, i / total));
      }
      const end = enc.flush();
      if (end.length) mp3Data.push(end);
      return new Blob(mp3Data, { type: 'audio/mpeg' });
    }

    self.onmessage = (e) => {
      const { type, left, right, channels, sampleRate, kbps } = e.data || {};
      if (type !== 'encode') return;
      try {
        const blob = encode(left, right, channels, sampleRate, kbps, (p) => {
          self.postMessage({ type: 'progress', value: p });
        });
        self.postMessage({ type: 'done', blob });
      } catch (err) {
        setTimeout(() => { throw err; });
      }
    };
  `;
  return URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
}

function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return out;
}

function audioBufferToMp3Worker(abuf, kbps = 192, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    try {
      const url = createMp3WorkerURL();
      const worker = new Worker(url);
      URL.revokeObjectURL(url);

      const channels = abuf.numberOfChannels;
      const sampleRate = abuf.sampleRate;
      const leftI16 = floatTo16BitPCM(abuf.getChannelData(0).slice());
      const rightI16 = floatTo16BitPCM((channels > 1 ? abuf.getChannelData(1) : abuf.getChannelData(0)).slice());

      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') onProgress(m.value);
        else if (m.type === 'done') { worker.terminate(); resolve(m.blob); }
      };
      worker.onerror = (err) => { worker.terminate(); reject(err); };

      worker.postMessage({ type: 'encode', left: leftI16, right: rightI16, channels, sampleRate, kbps: Number(kbps) || 192 },
                         [leftI16.buffer, rightI16.buffer]);
    } catch (e) { reject(e); }
  });
}

function audioBufferToMp3Main(abuf, kbps = 192, onProgress = () => {}) {
  if (!window.lamejs || !window.lamejs.Mp3Encoder) {
    throw new Error('lamejs not loaded on main thread');
  }
  const channels = abuf.numberOfChannels;
  const sampleRate = abuf.sampleRate;
  const enc = new lamejs.Mp3Encoder(channels, sampleRate, Number(kbps) || 192);
  const blockSize = 1152;
  let mp3Data = [];

  const leftI16 = floatTo16BitPCM(abuf.getChannelData(0));
  const rightI16 = floatTo16BitPCM((channels > 1 ? abuf.getChannelData(1) : abuf.getChannelData(0)));
  const total = leftI16.length;

  for (let i = 0; i < total; i += blockSize) {
    const l = leftI16.subarray(i, i + blockSize);
    const r = channels > 1 ? rightI16.subarray(i, i + blockSize) : l;
    const out = enc.encodeBuffer(l, r);
    if (out.length) mp3Data.push(out);
    if ((i & 0x7FFF) === 0) onProgress(Math.min(1, i / total));
  }
  const end = enc.flush();
  if (end.length) mp3Data.push(end);
  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

async function encodeMp3(abuf, kbps, onProgress) {
  try {
    return await audioBufferToMp3Worker(abuf, kbps, onProgress);
  } catch (err) {
    console.warn('[mp3] worker failed, falling back to main thread:', err);
    return audioBufferToMp3Main(abuf, kbps, onProgress);
  }
}

// FileSaver fallback
function saveBlob(blob, filename) {
  if (typeof saveAs === 'function') return saveAs(blob, filename);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ======= state =======
let files = []; // {id, file, name, size}
let ctx = null;
const playing = new Map(); // id -> {src, dry, wet, convolver}
let currentPlayingId = null;

let playbackRate = 0.85;
let reverbMix = 0.35;
let reverbDecay = 3.5;

// Keep 0s of tail in exports (set to >0 for tiny ambience if wanted)
const EXPORT_TAIL_SECONDS = 0;

// Track current preset name for filenames
let currentPreset = 'Slowed + Reverb';

// ======= DOM refs =======
const rate = document.getElementById('rate');
const mix = document.getElementById('mix');
const decay = document.getElementById('decay');
const rateVal = document.getElementById('rateVal');
const mixVal = document.getElementById('mixVal');
const decayVal = document.getElementById('decayVal');

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const fileCount = document.getElementById('fileCount');
const clearAllBtn = document.getElementById('clearAll');
const downloadAllBtn = document.getElementById('downloadAll');
const formatSelect = document.getElementById('formatSelect');
const bitrateSelect = document.getElementById('bitrateSelect');

const presetDefault = document.getElementById('presetDefault');
const presetSlowed = document.getElementById('presetSlowed');
const presetNightcore = document.getElementById('presetNightcore');
const presetFaded = document.getElementById('presetFaded');

const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

// ----- Sticky progress helpers -----
function showProgress(text = 'Working…') {
  progressText.textContent = text;
  progressBar.style.width = '0%';
  progressWrap.classList.remove('hidden');
}
function hideProgress() {
  progressWrap.classList.add('hidden');
}
function setProgress(fraction, text) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  progressBar.style.width = pct + '%';
  if (text) progressText.textContent = text;
}

// ======= presets =======
const PRESETS = [
  { name: 'Default', rate: 1.00, mix: 0.00, decay: 2.0 },
  { name: 'Slowed + Reverb', rate: 0.82, mix: 0.45, decay: 4.2 },
  { name: 'Nightcore', rate: 1.25, mix: 0.12, decay: 2.0 },
  { name: 'FADED', rate: 0.90, mix: 0.25, decay: 2.0 },
];
const EPS = 0.005;

// detect if sliders match a preset (to keep filename tags accurate)
function updatePresetNameFromSliders() {
  const p = PRESETS.find(p =>
    Math.abs(playbackRate - p.rate) <= EPS &&
    Math.abs(reverbMix - p.mix) <= 0.01 &&
    Math.abs(reverbDecay - p.decay) <= 0.05
  );
  currentPreset = p ? p.name : 'Custom';
}

function applyPreset(p) {
  playbackRate = p.rate; reverbMix = p.mix; reverbDecay = p.decay;
  rate.value = p.rate; mix.value = p.mix; decay.value = p.decay;
  rateVal.textContent = p.rate.toFixed(2)+'x';
  mixVal.textContent = Math.round(p.mix*100)+'%';
  decayVal.textContent = p.decay.toFixed(1)+'s';
  currentPreset = p.name;
  applyLiveChanges();
}
presetDefault.addEventListener('click', () => applyPreset(PRESETS[0]));
presetSlowed.addEventListener('click',  () => applyPreset(PRESETS[1]));
presetNightcore.addEventListener('click',() => applyPreset(PRESETS[2]));
presetFaded.addEventListener('click',   () => applyPreset(PRESETS[3]));

// ======= prevent browser from opening dropped files =======
['dragenter','dragover','dragleave','drop'].forEach(evt => {
  document.addEventListener(evt, (e) => {
    if (evt === 'dragover' || evt === 'drop') e.preventDefault();
  }, false);
});

// ======= dropzone hover depth =======
let dragDepth = 0;
dropzone.addEventListener('dragenter', () => { dragDepth++; dropzone.classList.add('hover'); });
dropzone.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropzone.classList.remove('hover'); });
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); });

// Drop handler
dropzone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove('hover');

  const dt = e.dataTransfer;
  let dropped = [];

  if (dt && dt.items && dt.items.length) {
    const all = await collectFilesFromItems(dt.items);
    dropped = all.length ? all : Array.from(dt.files || []);
  } else if (dt && dt.files && dt.files.length) {
    dropped = Array.from(dt.files);
  }

  if (!dropped.length) return;
  addFiles(dropped);
});

// File input (allow same-file reselect)
fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length) addFiles(e.target.files);
  e.target.value = "";
});
clearAllBtn.addEventListener('click', () => { stopAllPreviews(); files = []; renderList(); });

// ======= UI helpers =======
function refreshCounts() {
  fileCount.textContent = String(files.length);
  clearAllBtn.disabled = files.length === 0;
  downloadAllBtn.disabled = files.length === 0;
}

function addFiles(fileListLike) {
  const inputArr = Array.from(fileListLike);
  const accepted = inputArr.filter(isAudioLike);
  const rejected = inputArr.filter(f => !isAudioLike(f));
  if (rejected.length) console.warn(`[drop] Ignored ${rejected.length} non-audio file(s).`);
  if (!accepted.length) return;

  const mapped = accepted.map(f => ({ id: Math.random().toString(36).slice(2)+Date.now().toString(36), file: f, name: f.name, size: f.size }));
  files = files.concat(mapped);
  renderList();

  // Auto-play most recent, exclusively
  const toPlay = mapped[mapped.length - 1];
  playExclusive(toPlay).catch(console.error);
}

function renderList() {
  refreshCounts();
  fileList.innerHTML = '';
  for (const it of files) {
    const row = document.createElement('div');
    row.className = 'file';
    row.innerHTML = `
      <div class="meta">
        <div class="logo" style="width:28px;height:28px;">🎵</div>
        <div>
          <div class="name">${it.name}</div>
          <div class="size">${prettyBytes(it.size)}</div>
        </div>
      </div>
      <div class="actions">
        <button class="btn" data-act="play">Play</button>
        <button class="btn" data-act="stop">Stop</button>
        <button class="btn" data-act="download">Download</button>
        <button class="btn" data-act="remove">Remove</button>
      </div>`;
    row.querySelector('[data-act="play"]').addEventListener('click', () => playExclusive(it));
    row.querySelector('[data-act="stop"]').addEventListener('click', () => stopPreview(it.id));
    row.querySelector('[data-act="download"]').addEventListener('click', () => downloadOne(it));
    row.querySelector('[data-act="remove"]').addEventListener('click', () => removeItem(it.id));
    fileList.appendChild(row);
  }
}

function removeItem(id) {
  stopPreview(id);
  files = files.filter(f => f.id !== id);
  renderList();
}

function stopPreview(id) {
  if (!playing.has(id)) return;
  try { playing.get(id).src.stop(); } catch {}
  playing.delete(id);
  if (currentPlayingId === id) currentPlayingId = null;
}

function stopAllPreviews() {
  for (const id of Array.from(playing.keys())) stopPreview(id);
  currentPlayingId = null;
}

// ======= live controls =======
function applyLiveChanges() {
  for (const [, g] of playing.entries()) {
    try { if (g.src && g.src.playbackRate) g.src.playbackRate.value = playbackRate; } catch {}
    try { if (g.dry && g.wet) { g.dry.gain.value = 1 - reverbMix; g.wet.gain.value = reverbMix; } } catch {}
    try { if (g.convolver && ctx) { const tail = Math.min(6, Math.max(1.5, reverbDecay * 1.2)); g.convolver.buffer = generateImpulseResponse(ctx, tail, reverbDecay); } } catch {}
  }
  updatePresetNameFromSliders();
}

rate.addEventListener('input', e => { playbackRate = parseFloat(e.target.value); rateVal.textContent = playbackRate.toFixed(2)+'x'; applyLiveChanges(); });
mix.addEventListener('input', e => { reverbMix = parseFloat(e.target.value); mixVal.textContent = Math.round(reverbMix*100)+'%'; applyLiveChanges(); });
decay.addEventListener('input', e => { reverbDecay = parseFloat(e.target.value); decayVal.textContent = reverbDecay.toFixed(1)+'s'; applyLiveChanges(); });

function applyPresetAndUI(index) { applyPreset(PRESETS[index]); }
presetDefault.addEventListener('click', () => applyPresetAndUI(0));
presetSlowed.addEventListener('click',  () => applyPresetAndUI(1));
presetNightcore.addEventListener('click',() => applyPresetAndUI(2));
presetFaded.addEventListener('click',   () => applyPresetAndUI(3));

// ======= exclusive play logic =======
async function playExclusive(item) {
  stopAllPreviews();
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  const arr = await readFileAsArrayBuffer(item.file);
  const buf = await ctx.decodeAudioData(arr);
  const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = playbackRate;
  const dry = ctx.createGain(); const wet = ctx.createGain(); dry.gain.value = 1 - reverbMix; wet.gain.value = reverbMix;
  const conv = ctx.createConvolver(); conv.buffer = generateImpulseResponse(ctx, Math.min(6, Math.max(1.5, reverbDecay * 1.2)), reverbDecay);
  src.connect(dry).connect(ctx.destination); src.connect(conv).connect(wet).connect(ctx.destination);
  src.onended = () => { playing.delete(item.id); if (currentPlayingId === item.id) currentPlayingId = null; };
  playing.set(item.id, { src, dry, wet, convolver: conv });
  currentPlayingId = item.id;
  src.start(0);
}

// ======= batch & per-track rendering =======
downloadAllBtn.addEventListener('click', downloadAll);

async function downloadAll() {
  if (!files.length) return;
  const fmt = (formatSelect?.value || 'wav').toLowerCase();
  const kbps = Number(bitrateSelect?.value || 192);

  showProgress(`Starting…`);

  const zip = new JSZip();
  try {
    for (let i = 0; i < files.length; i++) {
      const it = files[i];

      // Phase 1: render
      setProgress(i / files.length, `Rendering… (${i}/${files.length}) — ${it.name}`);
      const rendered = await renderAudioBuffer(it.file);

      // Phase 2: encode or wav
      let blob;
      if (fmt === 'wav') {
        blob = audioBufferToWav(rendered);
        setProgress((i + 1) / files.length, `Adding to ZIP… (${i+1}/${files.length}) — ${it.name}`);
      } else {
        blob = await encodeMp3(rendered, kbps, (p) => {
          const overall = (i + 0.5 + (p * 0.5)) / files.length;
          setProgress(overall, `Encoding MP3… ${(p*100|0)}% (${i+1}/${files.length}) — ${it.name}`);
        });
      }

      const arrBuf = await blob.arrayBuffer();
      const base = it.name.replace(/\.[^/.]+$/, '');
      const ext = fmt === 'mp3' ? 'mp3' : 'wav';
      // Use preset name in exported filename
      zip.file(`${base}_[${currentPreset}].${ext}`, arrBuf);

      setProgress((i + 1) / files.length, `Queued (${i+1}/${files.length}) — ${it.name}`);
    }

    setProgress(1, `Packaging ZIP…`);
    const zipName = `[${currentPreset}] Batch Download.zip`;
    const content = await zip.generateAsync({ type: 'blob' });
    saveBlob(content, zipName);
    setProgress(1, `Done ✓`);
  } catch (e) {
    console.error(e); alert('Render failed. See console for details.');
  } finally {
    setTimeout(hideProgress, 800);
  }
}

async function downloadOne(item) {
  const fmt = (formatSelect?.value || 'wav').toLowerCase();
  const kbps = Number(bitrateSelect?.value || 192);
  try {
    showProgress(`Rendering… — ${item.name}`);
    setProgress(0);

    const rendered = await renderAudioBuffer(item.file);

    let blob;
    if (fmt === 'wav') {
      blob = audioBufferToWav(rendered);
      setProgress(1, `Exporting WAV… — ${item.name}`);
    } else {
      blob = await encodeMp3(rendered, kbps, (p) => {
        setProgress(p, `Encoding MP3… ${(p*100|0)}% — ${item.name}`);
      });
    }

    const base = item.name.replace(/\.[^/.]+$/, '');
    const ext = fmt === 'mp3' ? 'mp3' : 'wav';
    saveBlob(blob, `${base}_[${currentPreset}].${ext}`);
    setProgress(1, `Done ✓ — ${item.name}`);
  } catch (e) {
    console.error(e); alert('Render failed. See console for details.');
  } finally {
    setTimeout(hideProgress, 800);
  }
}

// ======= Core render (TRIM tail for export) =======
async function renderAudioBuffer(file) {
  // Decode in a temp context
  const tmp = new (window.AudioContext || window.webkitAudioContext)();
  const arr = await readFileAsArrayBuffer(file);
  const srcBuffer = await tmp.decodeAudioData(arr.slice(0));
  const rate = tmp.sampleRate;
  await tmp.close();

  // Duration after speed change
  const stretchedDuration = srcBuffer.duration / Math.max(0.05, playbackRate);

  // Render with extra tail so reverb sounds natural during processing
  const renderTail = Math.min(6, Math.max(1.5, reverbDecay * 1.2));
  const total = stretchedDuration + renderTail;

  const off = new OfflineAudioContext(srcBuffer.numberOfChannels, Math.ceil(total * rate), rate);
  const src = off.createBufferSource(); src.buffer = srcBuffer; src.playbackRate.value = playbackRate;
  const dry = off.createGain(); const wet = off.createGain(); dry.gain.value = 1 - reverbMix; wet.gain.value = reverbMix;
  const conv = off.createConvolver(); conv.buffer = generateImpulseResponse(off, renderTail, reverbDecay);
  src.connect(dry).connect(off.destination); src.connect(conv).connect(wet).connect(off.destination); src.start(0);

  const rendered = await off.startRendering();

  // Trim export to stretched content + optional small export tail
  const targetFrames = Math.min(
    rendered.length,
    Math.max(1, Math.floor((stretchedDuration + EXPORT_TAIL_SECONDS) * rate))
  );
  if (targetFrames >= rendered.length) return rendered;

  const trimmed = new AudioBuffer({
    length: targetFrames,
    numberOfChannels: rendered.numberOfChannels,
    sampleRate: rendered.sampleRate,
  });
  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    trimmed.getChannelData(ch).set(rendered.getChannelData(ch).subarray(0, targetFrames));
  }
  return trimmed;
}

// ======= init: force WAV + apply Slowed + Reverb preset =======
(function init() {
  if (formatSelect) formatSelect.value = 'wav';      // default export format
  applyPreset(PRESETS[1]);                           // default preset: Slowed + Reverb
})();

// ======= tiny self-test & CSS check =======
(function selfTest() {
  try {
    const haveOAC = typeof OfflineAudioContext === 'function' || typeof webkitOfflineAudioContext === 'function';
    if (!haveOAC) console.warn('[SelfTest] OfflineAudioContext is not available — rendering may not work in this browser.');
  } catch {}
  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (!bg) {
      console.warn('[CSS] style.css not loaded. Check the file name/path.');
      document.body.style.border = '4px solid red';
    }
  } catch {}
})();
