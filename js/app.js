(() => {
    // shared state bucket
    const PSP = (window.PSP = window.PSP || {});

    // tone nodes
    PSP.player = null;
    PSP.reverb = null;
    PSP.analyzer = null;

    // playlist
    PSP.playlist = [];
    PSP.currentIndex = -1;

    // playback state
    PSP.isLoaded = false;
    PSP.isPlaying = false;

    PSP.audioOffset = 0;
    PSP.startedAt = 0;
    PSP.lastKnownRate = 1;

    // current preset label
    PSP.currentPresetName = "Default";

    // DOM
    PSP.speedS = document.getElementById('speed-slider');
    PSP.mixS   = document.getElementById('mix-slider');
    PSP.decayS = document.getElementById('decay-slider');

    PSP.canvas = document.getElementById('visualizer');
    PSP.ctx = PSP.canvas.getContext('2d');

    PSP.rowsRoot = document.getElementById('file-rows');
    PSP.playBtn = document.getElementById('master-play');

    PSP.presetsGroupEl = document.getElementById('presets-group');

    // marquee
    PSP.titleClip = document.getElementById('title-clip');
    PSP.titleTrack = document.getElementById('title-track');
    PSP.titleText = document.getElementById('title-text');

    // seek UI
    PSP.seekWrap = document.getElementById('seek-wrap');
    PSP.seekFill = document.getElementById('seek-fill');
    PSP.seekNotch = document.getElementById('seek-notch');
    PSP.isSeeking = false;

    // export UI refs
    PSP.exportFormatEl = document.getElementById('export-format');
    PSP.exportBitrateEl = document.getElementById('export-bitrate');
    PSP.batchBtn = document.getElementById('batch-btn');

    PSP.exportBar = document.getElementById('export-bar');
    PSP.exportTitleEl = document.getElementById('export-title');
    PSP.exportPctEl = document.getElementById('export-pct');
    PSP.exportFillEl = document.getElementById('export-fill');
    PSP.exportCancelBtn = document.getElementById('export-cancel');

    // util
    PSP.dur = function dur(){
        return (PSP.player && PSP.player.buffer && PSP.player.buffer.duration) ? PSP.player.buffer.duration : 0;
    };

    PSP.fmt = function fmt(s){
        s = Math.max(0, s);
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec < 10 ? '0' : ''}${sec}`;
    };

    PSP.resizeCanvas = function resizeCanvas(){
        const dpr = window.devicePixelRatio || 1;
        const rect = PSP.canvas.getBoundingClientRect();
        PSP.canvas.width = Math.floor(rect.width * dpr);
        PSP.canvas.height = Math.floor(rect.height * dpr);
        PSP.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // accurate audio position
    PSP.currentAudioPos = function currentAudioPos(){
        if (!PSP.isPlaying) return PSP.audioOffset;
        const now = Tone.now();
        const elapsed = now - PSP.startedAt;
        return PSP.audioOffset + (elapsed * PSP.lastKnownRate);
    };

    PSP.clampAudioPos = function clampAudioPos(x){
        const d = PSP.dur();
        if (!d) return 0;
        return Math.max(0, Math.min(d, x));
    };

    // drag/drop
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); });
    document.getElementById('audio-upload').addEventListener('change', (e) => handleFiles(e.target.files));

    function handleFiles(files){
        ([...files]).forEach(file => {
        if (file.type.startsWith('audio/')) {
            PSP.playlist.push({ name: file.name, url: URL.createObjectURL(file) });
        }
        });
        renderList();
        if (!PSP.isLoaded && PSP.playlist.length > 0) loadTrack(0);
    }

    // marquee
    function setTitle(text){
        PSP.titleText.textContent = text;
        updateMarquee();
    }
    PSP.setTitle = setTitle;

    function updateMarquee(){
        PSP.titleTrack.querySelectorAll('[data-dup="1"]').forEach(n => n.remove());
        PSP.titleClip.classList.remove('is-marquee');

        const clipW = PSP.titleClip.clientWidth;
        const textW = PSP.titleText.scrollWidth;

        if (textW > clipW + 8) {
        const dup = PSP.titleText.cloneNode(true);
        dup.setAttribute('data-dup', '1');
        PSP.titleTrack.appendChild(dup);

        const gap = 40;
        const distance = textW + gap;

        const pxPerSec = 90;
        const durS = Math.max(8, Math.min(24, distance / pxPerSec));

        PSP.titleTrack.style.setProperty('--marquee-distance', distance + 'px');
        PSP.titleTrack.style.setProperty('--marquee-duration', durS + 's');
        PSP.titleClip.classList.add('is-marquee');
        } else {
        PSP.titleTrack.style.setProperty('--marquee-distance', '0px');
        PSP.titleTrack.style.setProperty('--marquee-duration', '12s');
        }
    }
    PSP.updateMarquee = updateMarquee;

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => updateMarquee());
    } else {
        setTimeout(updateMarquee, 250);
    }

    window.addEventListener('resize', () => {
        PSP.resizeCanvas();
        requestAnimationFrame(updateMarquee);
    });

    // list
    function renderList(){
        PSP.rowsRoot.innerHTML = "";
        PSP.playlist.forEach((t, i) => {
        const div = document.createElement('div');
        div.className = `file-item ${i === PSP.currentIndex ? 'active-track' : ''}`;
        div.innerHTML = `
            <span title="${t.name}">${t.name}</span>
            <div class="file-actions">
            <button class="mini" title="Load" onclick="loadTrack(${i})">▶</button>
            <button class="mini" title="Download" onclick="downloadOne(${i})">⬇</button>
            <button class="mini" title="Remove" onclick="removeTrack(${i})">✕</button>
            </div>
        `;
        PSP.rowsRoot.appendChild(div);
        });

        if (typeof PSP.setExportingState === "function") PSP.setExportingState(PSP.isExporting);
    }
    PSP.renderList = renderList;

    function removeTrack(i){
        if (PSP.isExporting) return;

        const removed = PSP.playlist[i];
        if (removed && removed.url) {
        try { URL.revokeObjectURL(removed.url); } catch {}
        }

        if (i === PSP.currentIndex) {
        mediaStop();
        PSP.isLoaded = false;
        PSP.currentIndex = -1;
        setTitle("Drop audio to start");
        document.getElementById('time-display').innerText = "0:00 / 0:00";
        updateSeekUI(0);
        }

        PSP.playlist.splice(i, 1);
        if (PSP.currentIndex > i) PSP.currentIndex--;
        renderList();
    }
    window.removeTrack = removeTrack;

    // presets
    const PRESET_KEY = "psp_audio_editor_user_presets_v1";

    const builtinPresets = [
        { id: "default",  name: "Default",  values: { speed: 1.0,  mix: 0.0,  decay: 2.0 }, user: false },
        { id: "slowed",   name: "Slowed",   values: { speed: 0.82, mix: 0.45,  decay: 4.2 }, user: false },
        { id: "nightcore",name: "Nightcore",values: { speed: 1.25, mix: 0.12,  decay: 2.0 }, user: false },
        { id: "faded",    name: "Faded",    values: { speed: 0.9, mix: 0.25, decay: 2.0 }, user: false },
        { id: "perfect",  name: "Perfect!", values: { speed: 1.10, mix: 0.10, decay: 2.0 }, user: false },
    ];

    function loadUserPresets(){
        try{
        const raw = localStorage.getItem(PRESET_KEY);
        if(!raw) return [];
        const parsed = JSON.parse(raw);
        if(!Array.isArray(parsed)) return [];
        return parsed
            .filter(p => p && typeof p.name === "string" && p.values)
            .map(p => ({
            id: p.id || ("user_" + Math.random().toString(16).slice(2)),
            name: String(p.name).slice(0, 24),
            values: {
                speed: Number(p.values.speed) || 1,
                mix: Math.max(0, Math.min(1, Number(p.values.mix) || 0)),
                decay: Math.max(0.5, Math.min(10, Number(p.values.decay) || 1.5)),
            },
            user: true
            }));
        } catch {
        return [];
        }
    }

    function saveUserPresets(list){
        localStorage.setItem(PRESET_KEY, JSON.stringify(list.map(p => ({
        id: p.id,
        name: p.name,
        values: p.values
        }))));
    }

    let userPresets = loadUserPresets();

    function deleteUserPreset(id){
        userPresets = userPresets.filter(p => p.id !== id);
        saveUserPresets(userPresets);
        renderPresets();
    }

    function applyPresetValues(values){
        PSP.speedS.value = values.speed;
        PSP.mixS.value   = values.mix;
        PSP.decayS.value = values.decay;

        PSP.speedS.oninput(false);
        PSP.mixS.oninput(false);
        PSP.decayS.oninput(false);
    }

    function currentSettings(){
        return {
        speed: Number(PSP.speedS.value) || 1,
        mix: Number(PSP.mixS.value) || 0,
        decay: Number(PSP.decayS.value) || 1.5
        };
    }
    PSP.currentSettings = currentSettings;

    function saveCurrentPresetFlow(){
        const vals = currentSettings();

        let name = prompt("Name your preset:", "My Preset");
        if (name === null) return;
        name = name.trim();
        if (!name) return;
        if (name.length > 18) name = name.slice(0, 18);

        const newPreset = {
        id: "user_" + Date.now().toString(16),
        name,
        values: vals,
        user: true
        };

        userPresets.push(newPreset);
        saveUserPresets(userPresets);
        PSP.currentPresetName = name;
        renderPresets();
    }

    function renderPresets(){
        PSP.presetsGroupEl.innerHTML = "";

        const all = [...builtinPresets, ...userPresets];

        for (const p of all){
        const btn = document.createElement("button");
        btn.className = "btn";

        if (p.user) {
            const star = document.createElement("span");
            star.textContent = "★";
            star.style.opacity = "0.9";
            star.style.fontSize = "18px";
            btn.appendChild(star);

            const txt = document.createElement("span");
            txt.textContent = p.name;
            btn.appendChild(txt);
        } else {
            btn.textContent = p.name;
        }

        btn.addEventListener("click", (e) => {
            if (p.user && e.altKey){
            deleteUserPreset(p.id);
            return;
            }
            PSP.currentPresetName = p.name;
            applyPresetValues(p.values);
        });

        PSP.presetsGroupEl.appendChild(btn);
        }

        const saveBtn = document.createElement("button");
        saveBtn.className = "btn ps-blue";
        saveBtn.textContent = "+ Save Preset";
        saveBtn.addEventListener("click", () => saveCurrentPresetFlow());
        PSP.presetsGroupEl.appendChild(saveBtn);

        const hint = document.createElement("div");
        hint.className = "preset-hint";
        hint.textContent = "Hold Alt + Click a preset to delete it";
        PSP.presetsGroupEl.appendChild(hint);
    }
    PSP.renderPresets = renderPresets;

    // seek
    function updateSeekUI(progress01){
        const p = Math.max(0, Math.min(1, progress01 || 0));
        PSP.seekNotch.style.left = (p * 100) + "%";
        PSP.seekFill.style.width = (p * 100) + "%";
    }
    PSP.updateSeekUI = updateSeekUI;

    function seekToAudio(audioSec, keepPlaying){
        if (!PSP.isLoaded || !PSP.player) return;

        const d = PSP.dur();
        if (!d) return;

        PSP.audioOffset = PSP.clampAudioPos(audioSec);
        PSP.startedAt = Tone.now();

        const shouldPlay = (keepPlaying === undefined) ? PSP.isPlaying : keepPlaying;

        PSP.player.stop();
        if (shouldPlay) {
        PSP.isPlaying = true;
        PSP.player.start(Tone.now(), PSP.audioOffset);
        setPlayingUI(true);
        } else {
        PSP.isPlaying = false;
        setPlayingUI(false);
        }

        updateSeekUI(PSP.audioOffset / d);
    }
    PSP.seekToAudio = seekToAudio;

    function seekToProgress(p01){
        const d = PSP.dur();
        if (!d) return;
        seekToAudio(d * Math.max(0, Math.min(1, p01)), PSP.isPlaying);
    }

    function progressFromPointer(clientX){
        const rect = PSP.seekWrap.getBoundingClientRect();
        return (clientX - rect.left) / rect.width;
    }

    PSP.seekWrap.addEventListener('pointerdown', (e) => {
        if (!PSP.isLoaded) return;
        PSP.isSeeking = true;
        PSP.seekWrap.setPointerCapture(e.pointerId);
        seekToProgress(progressFromPointer(e.clientX));
    });
    PSP.seekWrap.addEventListener('pointermove', (e) => {
        if (!PSP.isSeeking) return;
        seekToProgress(progressFromPointer(e.clientX));
    });
    PSP.seekWrap.addEventListener('pointerup', () => { PSP.isSeeking = false; });
    PSP.seekWrap.addEventListener('pointercancel', () => { PSP.isSeeking = false; });

    // apply
    function apply(){
        if (!PSP.player) return;

        const newRate = Number(PSP.speedS.value) || 1;

        if (PSP.isPlaying) {
        PSP.audioOffset = PSP.clampAudioPos(PSP.currentAudioPos());
        PSP.startedAt = Tone.now();
        }

        PSP.lastKnownRate = newRate;
        PSP.player.playbackRate = newRate;

        PSP.reverb.wet.value = Number(PSP.mixS.value);
        PSP.reverb.decay = Number(PSP.decayS.value);
    }
    PSP.apply = apply;

    // preset label
    function markPresetCustom(){
        if (PSP.currentPresetName !== "Custom") PSP.currentPresetName = "Custom";
    }

    PSP.speedS.oninput = (markCustom = true) => {
        if (markCustom) markPresetCustom();
        document.getElementById('speed-val').innerText = PSP.speedS.value + 'x';
        apply();
    };
    PSP.mixS.oninput = (markCustom = true) => {
        if (markCustom) markPresetCustom();
        document.getElementById('mix-val').innerText = Math.round(PSP.mixS.value * 100) + '%';
        apply();
    };
    PSP.decayS.oninput = (markCustom = true) => {
        if (markCustom) markPresetCustom();
        document.getElementById('decay-val').innerText = PSP.decayS.value + 's';
        apply();
    };

    // media
    function setPlayingUI(on){
        PSP.playBtn.classList.toggle('is-playing', !!on);
    }

    function mediaToggle(){
        if (!PSP.isLoaded) return;
        if (PSP.isPlaying) mediaPause();
        else mediaPlay();
    }
    window.mediaToggle = mediaToggle;

    function mediaPlay(){
        if (!PSP.isLoaded || !PSP.player) return;
        if (PSP.isPlaying) return;

        const now = Tone.now();
        PSP.startedAt = now;
        PSP.isPlaying = true;

        PSP.player.stop();
        PSP.player.start(now, PSP.audioOffset);

        setPlayingUI(true);
    }
    window.mediaPlay = mediaPlay;

    function mediaPause(){
        if (!PSP.isLoaded || !PSP.player) return;
        if (!PSP.isPlaying) return;

        PSP.audioOffset = PSP.clampAudioPos(PSP.currentAudioPos());
        PSP.isPlaying = false;
        PSP.player.stop();

        setPlayingUI(false);
    }
    window.mediaPause = mediaPause;

    function mediaStop(){
        if (PSP.player) PSP.player.stop();
        PSP.isPlaying = false;
        PSP.audioOffset = 0;
        PSP.startedAt = Tone.now();
        setPlayingUI(false);
        updateSeekUI(0);
    }
    window.mediaStop = mediaStop;

    function mediaNext(){
        if (PSP.currentIndex < PSP.playlist.length - 1) loadTrack(PSP.currentIndex + 1);
    }
    window.mediaNext = mediaNext;

    function mediaPrev(){
        if (!PSP.isLoaded) return;

        const cur = PSP.currentAudioPos();
        if (cur > 3) {
        seekToAudio(0, true);
        } else if (PSP.currentIndex > 0) {
        loadTrack(PSP.currentIndex - 1);
        }
    }
    window.mediaPrev = mediaPrev;

    // load track
    async function loadTrack(index){
        if (index < 0 || index >= PSP.playlist.length) return;

        await Tone.start();

        if (!PSP.player) {
        PSP.reverb = new Tone.Reverb({ decay: 1.5, wet: 0 }).toDestination();
        PSP.player = new Tone.Player().connect(PSP.reverb);
        PSP.player.loop = false;

        PSP.analyzer = new Tone.Waveform(256);
        PSP.player.connect(PSP.analyzer);

        PSP.resizeCanvas();
        draw();
        }

        mediaStop();

        PSP.currentIndex = index;
        renderList();
        setTitle(PSP.playlist[index].name);

        await PSP.player.load(PSP.playlist[index].url);

        PSP.isLoaded = true;
        PSP.audioOffset = 0;
        PSP.startedAt = Tone.now();
        PSP.lastKnownRate = Number(PSP.speedS.value) || 1;

        apply();
        mediaPlay();
    }
    window.loadTrack = loadTrack;

    // visualizer + timer 
    function draw(){
        requestAnimationFrame(draw);

        const rect = PSP.canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        PSP.ctx.clearRect(0, 0, w, h);

        if (PSP.analyzer) {
        const buf = PSP.analyzer.getValue();
        PSP.ctx.beginPath();
        PSP.ctx.lineWidth = 3;
        PSP.ctx.strokeStyle = 'white';

        let x = 0;
        const slice = w / buf.length;

        for (let i = 0; i < buf.length; i++) {
            const y = (h / 2) + buf[i] * 60;
            if (i === 0) PSP.ctx.moveTo(x, y);
            else PSP.ctx.lineTo(x, y);
            x += slice;
        }
        PSP.ctx.stroke();
        }

        if (PSP.isLoaded && PSP.player && PSP.player.buffer && PSP.player.buffer.duration) {
        const d = PSP.dur();
        const cur = PSP.clampAudioPos(PSP.currentAudioPos());

        document.getElementById('time-display').innerText =
            `${PSP.fmt(cur)} / ${PSP.fmt(d)}`;

        if (!PSP.isSeeking) updateSeekUI(cur / d);

        if (cur >= d - 0.02) {
            mediaNext();
        }
        }
    }

    // init
    PSP.resizeCanvas();
    PSP.speedS.oninput(false); PSP.mixS.oninput(false); PSP.decayS.oninput(false);
    setTitle("Drop audio to start");
    renderList();
    updateSeekUI(0);
    renderPresets();
})();