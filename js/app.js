(() => {
    const PSP = (window.PSP = window.PSP || {});
    const $ = id => document.getElementById(id);
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    Object.assign(PSP, {
        playlist: [], currentIndex: -1, isLoaded: false, isPlaying: false,
        isLoading: false, isExporting: false, audioOffset: 0, startedAt: 0,
        lastKnownRate: 1, currentPresetName: 'Default', repeat: false,
        speedS: $('speed-slider'), mixS: $('mix-slider'), decayS: $('decay-slider'),
        exportFormatEl: $('export-format'), exportBitrateEl: $('export-bitrate'),
        batchBtn: $('batch-btn'), exportBar: $('export-bar'),
        exportTitleEl: $('export-title'), exportPctEl: $('export-pct'),
        exportFillEl: $('export-fill'), exportCancelBtn: $('export-cancel')
    });
    const canvas = $('visualizer');
    const ctx = canvas.getContext('2d');
    let canvasWidth = 0, canvasHeight = 0, frame = 0, lastFrame = 0;
    let loadVersion = 0, loadController = null, audioReady = null;
    let noticeTimer, dragDepth = 0, previousVolume = 80;
    let selectedPreset = 'default';
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    PSP.fmt = seconds => {
        const s = Math.max(0, Math.floor(seconds || 0));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    PSP.notify = message => {
        clearTimeout(noticeTimer);
        $('notice').textContent = message;
        $('notice').hidden = false;
        noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6500);
    };
    function fillRange(input) {
        const percent = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100;
        input.style.setProperty('--fill', `${percent}%`);
    }
    function icon(name) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('icon');
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(svg.namespaceURI, 'use');
        use.setAttribute('href', `#i-${name}`);
        svg.append(use);
        return svg;
    }
    function trackMeta(track) {
        const count = track.settings ? PSP.describeEffects(track.settings).filter(effect => effect.active).length : 0;
        return `${track.name.split('.').pop().toUpperCase()} · ${(track.size / 1048576).toFixed(1)} MB${track.duration ? ` · ${PSP.fmt(track.duration)}` : ''}${count ? ` · ${count} ${count === 1 ? 'effect' : 'effects'}` : ''}`;
    }
    PSP.dur = () => PSP.isLoaded ? PSP.player.buffer.duration : 0;
    PSP.currentAudioPos = () => PSP.audioOffset + (PSP.isPlaying ? (PSP.context.now() - PSP.startedAt) * PSP.lastKnownRate : 0);
    PSP.currentSettings = () => ({ speed: Number(PSP.speedS.value), mix: Number(PSP.mixS.value), decay: Number(PSP.decayS.value) });
    PSP.defaultSettings = () => ({ speed: 1, mix: 0, decay: 2, eq: PSP.eq.defaults(), distortion: PSP.distortion.defaults(), delay: PSP.delay.defaults(), preset: 'Default', presetId: 'default' });
    PSP.captureSettings = () => ({ ...PSP.currentSettings(), eq: PSP.eq.snapshot(), distortion: PSP.distortion.snapshot(), delay: PSP.delay.snapshot(), preset: PSP.currentPresetName, presetId: selectedPreset });
    PSP.saveCurrentSettings = () => {
        const track = PSP.playlist[PSP.currentIndex];
        if (track) {
            track.settings = PSP.captureSettings();
            const meta = document.querySelector('.file-item.active-track .track-meta');
            if (!track.error) {
                if (meta) meta.textContent = trackMeta(track);
                $('track-detail').textContent = trackMeta(track);
            }
        }
        updateWorkspace();
    };
    function restoreSettings(settings) {
        PSP.speedS.value = settings.speed;
        PSP.mixS.value = settings.mix;
        PSP.decayS.value = settings.decay;
        PSP.currentPresetName = settings.preset;
        selectedPreset = settings.presetId;
        PSP.eq.restore(settings.eq);
        PSP.distortion.restore(settings.distortion);
        PSP.delay.restore(settings.delay);
        updateSettings();
    }
    function updateWorkspace() {
        $('workspace-track').value = PSP.currentIndex < 0 ? '' : String(PSP.currentIndex);
        $('workspace-play').disabled = !PSP.isLoaded;
        $('workspace-play').textContent = PSP.isPlaying ? 'Pause' : 'Play';
        $('workspace-play').setAttribute('aria-label', PSP.isPlaying ? 'Pause selected track' : 'Play selected track');
        $('workspace-export').disabled = PSP.isExporting || PSP.isLoading || PSP.currentIndex < 0;
        const fragment = document.createDocumentFragment();
        const descriptions = PSP.describeEffects(PSP.captureSettings());
        if (!descriptions.length) {
            const original = document.createElement('span');
            original.textContent = 'Original sound';
            fragment.append(original);
        }
        descriptions.forEach(effect => {
            const link = document.createElement('a');
            link.href = `#${effect.page}`;
            link.textContent = effect.label;
            link.className = effect.active ? 'active-effect' : 'bypassed-effect';
            fragment.append(link);
        });
        $('workspace-chain').replaceChildren(fragment);
    }
    PSP.updateWorkspace = updateWorkspace;
    $('workspace-track').addEventListener('change', event => {
        if (event.target.value !== '') loadTrack(Number(event.target.value));
    });
    $('workspace-play').addEventListener('click', () => mediaToggle());
    $('workspace-add').addEventListener('click', () => $('audio-upload').click());
    $('workspace-export').addEventListener('click', () => window.downloadOne(PSP.currentIndex));

    PSP.ensureAudio = async () => {
        if (!window.Tone) throw new Error('The audio engine could not load. Check your connection and reload.');
        if (!audioReady) {
            PSP.context = Tone.getContext();
            audioReady = (async () => {
                PSP.output = new Tone.Gain({ context: PSP.context, gain: Number($('volume-slider').value) / 100 }).toDestination();
                PSP.processing = PSP.createProcessingChain(PSP.context, PSP.captureSettings());
                PSP.processing.output.connect(PSP.output);
                PSP.player = new Tone.Player({ context: PSP.context }).connect(PSP.processing.input);
                PSP.analyzer = new Tone.Waveform({ context: PSP.context, size: 256 });
                PSP.player.connect(PSP.analyzer);
                await PSP.processing.ready;
            })();
        }
        await PSP.context.resume();
        await audioReady;
    };

    function updateMarquee() {
        $('title-track').querySelectorAll('[data-duplicate]').forEach(node => node.remove());
        $('title-clip').classList.remove('is-marquee');
        const width = $('title-text').scrollWidth;
        if (width > $('title-clip').clientWidth + 8 && !reducedMotion.matches) {
            const duplicate = document.createElement('span');
            duplicate.className = 'title-text';
            duplicate.textContent = $('title-text').textContent;
            duplicate.dataset.duplicate = 'true';
            duplicate.setAttribute('aria-hidden', 'true');
            $('title-track').append(duplicate);
            $('title-track').style.setProperty('--marquee-distance', `${width + 40}px`);
            $('title-track').style.setProperty('--marquee-duration', `${Math.max(12, (width + 40) / 45)}s`);
            $('title-clip').classList.add('is-marquee');
        }
    }
    function setTitle(text) {
        $('title-text').textContent = text;
        $('title-clip').title = text;
        updateMarquee();
    }
    function updatePlaybackUI() {
        $('master-play').classList.toggle('is-playing', PSP.isPlaying);
        $('master-play').setAttribute('aria-label', PSP.isPlaying ? 'Pause' : 'Play');
        $('master-play').title = `${PSP.isPlaying ? 'Pause' : 'Play'} (Space)`;
        $('master-play').disabled = !PSP.isLoaded;
        $('previous-button').disabled = !PSP.isLoaded;
        $('next-button').disabled = PSP.currentIndex < 0 || PSP.currentIndex >= PSP.playlist.length - 1;
        $('seek-slider').disabled = !PSP.isLoaded;
        $('playback-state').textContent = PSP.isLoading ? 'Loading audio…' : PSP.isPlaying ? 'Now playing' : PSP.isLoaded ? 'Paused' : 'Audio player';
        $('track-position').textContent = PSP.currentIndex < 0 ? 'No track selected' : `Track ${PSP.currentIndex + 1} of ${PSP.playlist.length}`;
        $('waveform-idle').hidden = PSP.isLoaded || PSP.isLoading;
        updateTime();
        drawWaveform();
        updateWorkspace();
        document.dispatchEvent(new Event('playbackchange'));
    }
    function updateTime() {
        const duration = PSP.dur();
        const current = clamp(PSP.currentAudioPos(), 0, duration);
        $('time-current').textContent = PSP.fmt(current);
        $('time-total').textContent = PSP.fmt(duration);
        $('seek-slider').value = duration ? Math.round(current / duration * 1000) : 0;
        $('seek-slider').setAttribute('aria-valuetext', `${PSP.fmt(current)} of ${PSP.fmt(duration)}`);
        fillRange($('seek-slider'));
    }
    function renderList() {
        const fragment = document.createDocumentFragment();
        PSP.playlist.forEach((track, index) => {
            const row = document.createElement('div');
            row.className = `file-item${index === PSP.currentIndex ? ' active-track' : ''}`;
            row.setAttribute('role', 'listitem');
            if (index === PSP.currentIndex) row.setAttribute('aria-current', 'true');
            const number = document.createElement('span');
            number.className = 'track-number';
            number.textContent = String(index + 1).padStart(2, '0');
            const info = document.createElement('div');
            info.className = 'track-info';
            const name = document.createElement('span');
            name.className = 'track-name';
            name.textContent = track.name;
            name.title = track.name;
            const meta = document.createElement('span');
            meta.className = 'track-meta';
            meta.textContent = track.error ? 'Cannot decode this file. Try another format.' : trackMeta(track);
            info.append(name, meta);
            const actions = document.createElement('div');
            actions.className = 'file-actions';
            for (const [action, symbol, handler] of [
                ['Load', 'music', () => loadTrack(PSP.playlist.indexOf(track))],
                ['Download', 'download', () => window.downloadOne(PSP.playlist.indexOf(track))],
                ['Remove', 'close', () => removeTrack(PSP.playlist.indexOf(track))]
            ]) {
                const button = document.createElement('button');
                button.className = 'mini';
                button.title = action;
                button.setAttribute('aria-label', `${action} ${track.name}`);
                button.append(icon(symbol));
                button.addEventListener('click', handler);
                actions.append(button);
            }
            row.append(number, info, actions);
            fragment.append(row);
        });
        $('file-rows').replaceChildren(fragment);
        const placeholder = new Option('Select a track', '');
        placeholder.disabled = true;
        $('workspace-track').replaceChildren(placeholder, ...PSP.playlist.map((track, index) => new Option(track.name, String(index))));
        $('workspace-track').disabled = !PSP.playlist.length;
        $('track-count').textContent = `${PSP.playlist.length} ${PSP.playlist.length === 1 ? 'track' : 'tracks'}`;
        $('empty-library').hidden = PSP.playlist.length > 0;
        PSP.batchBtn.disabled = PSP.isExporting || !PSP.playlist.length;
        PSP.setExportingState?.(PSP.isExporting);
        updatePlaybackUI();
    }
    PSP.renderList = renderList;

    function handleFiles(files) {
        if (PSP.isExporting) { PSP.notify('Wait for the export to finish before adding tracks.'); return; }
        let added = 0, skipped = 0;
        const initialSettings = PSP.currentIndex < 0 ? PSP.captureSettings() : PSP.defaultSettings();
        for (const file of files) {
            if (!file.size || !(file.type.startsWith('audio/') || /\.(mp3|wav|flac|m4a|aac|ogg|opus|aiff?|webm)$/i.test(file.name))) { skipped++; continue; }
            if (PSP.playlist.some(track => track.name === file.name && track.size === file.size && track.modified === file.lastModified)) { skipped++; continue; }
            PSP.playlist.push({ name: file.name, size: file.size, modified: file.lastModified, url: URL.createObjectURL(file), settings: structuredClone(initialSettings) });
            added++;
        }
        renderList();
        if (skipped) PSP.notify(`${added} added. ${skipped} duplicate, empty, or unsupported ${skipped === 1 ? 'file skipped' : 'files skipped'}.`);
        if (added && !PSP.isLoaded && !PSP.isLoading) loadTrack(0);
    }
    $('audio-upload').addEventListener('change', event => { handleFiles(event.target.files); event.target.value = ''; });
    for (const id of ['add-files', 'browse-files']) $(id).addEventListener('click', () => $('audio-upload').click());
    window.addEventListener('dragenter', event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        dragDepth++;
        $('drop-overlay').querySelector('h2').textContent = PSP.loudness?.isActive() ? 'Drop to check loudness' : 'Drop to add to your library';
        $('drop-overlay').hidden = false;
    });
    window.addEventListener('dragover', event => { event.preventDefault(); });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; } });
    window.addEventListener('drop', event => {
        event.preventDefault();
        dragDepth = 0;
        $('drop-overlay').hidden = true;
        if (PSP.loudness?.isActive()) PSP.loudness.addFiles(event.dataTransfer.files);
        else handleFiles(event.dataTransfer.files);
    });
    window.addEventListener('blur', () => { dragDepth = 0; $('drop-overlay').hidden = true; });

    function stop() {
        PSP.isPlaying = false;
        PSP.player?.stop();
        PSP.audioOffset = 0;
        cancelAnimationFrame(frame);
        frame = 0;
    }
    async function loadTrack(index) {
        const track = PSP.playlist[index];
        if (!track) return;
        PSP.saveCurrentSettings();
        const version = ++loadVersion;
        loadController?.abort();
        loadController = new AbortController();
        const signal = loadController.signal;
        stop();
        PSP.isLoaded = false;
        PSP.isLoading = true;
        PSP.currentIndex = index;
        restoreSettings(track.settings);
        setTitle(track.name.replace(/\.[^/.]+$/, ''));
        $('track-detail').textContent = trackMeta(track);
        renderList();
        try {
            await PSP.ensureAudio();
            if (version !== loadVersion) return;
            const response = await fetch(track.url, { signal });
            if (!response.ok) throw new Error('Could not read the selected file.');
            const buffer = await PSP.context.rawContext.decodeAudioData(await response.arrayBuffer());
            // only the latest selection may replace the shared player buffer
            if (version !== loadVersion) return;
            PSP.player.buffer = buffer;
            PSP.isLoaded = true;
            PSP.isLoading = false;
            track.duration = buffer.duration;
            track.error = false;
            apply(true);
            await PSP.processing.ready;
            if (version !== loadVersion) return;
            $('track-detail').textContent = trackMeta(track);
            renderList();
            mediaPlay();
        } catch (error) {
            if (version !== loadVersion || error.name === 'AbortError') return;
            PSP.isLoading = false;
            PSP.isLoaded = false;
            track.error = true;
            renderList();
            PSP.notify(window.Tone ? `Cannot play ${track.name}. Try a supported audio file.` : error.message);
        }
    }
    window.loadTrack = loadTrack;
    function removeTrack(index) {
        if (PSP.isExporting || index < 0 || index >= PSP.playlist.length) return;
        const track = PSP.playlist[index];
        const wasCurrent = index === PSP.currentIndex;
        if (wasCurrent) {
            loadVersion++;
            loadController?.abort();
            stop();
            PSP.isLoaded = false;
            PSP.isLoading = false;
            PSP.currentIndex = -1;
            restoreSettings(PSP.defaultSettings());
            if (PSP.player) PSP.player.buffer.dispose();
            setTitle('Add a track');
            $('track-detail').textContent = 'Adjust speed and reverb, then export.';
        } else if (index < PSP.currentIndex) PSP.currentIndex--;
        PSP.playlist.splice(index, 1);
        URL.revokeObjectURL(track.url);
        renderList();
    }
    window.removeTrack = removeTrack;
    function mediaPlay() {
        if (!PSP.isLoaded || PSP.isPlaying) return;
        if (PSP.audioOffset >= PSP.dur() - .02) PSP.audioOffset = 0;
        PSP.context.resume().catch(() => PSP.notify('Audio is paused by your browser. Press Play to resume.'));
        PSP.startedAt = PSP.context.now();
        PSP.player.start(PSP.startedAt, PSP.audioOffset);
        PSP.isPlaying = true;
        updatePlaybackUI();
        startAnimation();
    }
    function mediaPause() {
        if (!PSP.isPlaying) return;
        PSP.audioOffset = clamp(PSP.currentAudioPos(), 0, PSP.dur());
        PSP.isPlaying = false;
        PSP.player.stop();
        cancelAnimationFrame(frame);
        frame = 0;
        updatePlaybackUI();
    }
    function mediaToggle() { if (PSP.isPlaying) mediaPause(); else mediaPlay(); }
    function mediaNext() { if (PSP.currentIndex < PSP.playlist.length - 1) loadTrack(PSP.currentIndex + 1); }
    function mediaPrev() {
        if (!PSP.isLoaded) return;
        if (PSP.currentAudioPos() > 3 || PSP.currentIndex === 0) seekToAudio(0);
        else loadTrack(PSP.currentIndex - 1);
    }
    function seekToAudio(seconds) {
        if (!PSP.isLoaded) return;
        const playing = PSP.isPlaying;
        PSP.player.stop();
        PSP.audioOffset = clamp(seconds, 0, PSP.dur());
        PSP.startedAt = PSP.context.now();
        if (playing && PSP.audioOffset < PSP.dur()) PSP.player.start(PSP.startedAt, PSP.audioOffset);
        updateTime();
    }
    Object.assign(window, { mediaPlay, mediaPause, mediaToggle, mediaNext, mediaPrev });
    PSP.seekToAudio = seekToAudio;
    $('master-play').addEventListener('click', mediaToggle);
    $('previous-button').addEventListener('click', mediaPrev);
    $('next-button').addEventListener('click', mediaNext);
    $('seek-slider').addEventListener('input', event => seekToAudio(Number(event.target.value) / 1000 * PSP.dur()));
    function toggleRepeat() {
        PSP.repeat = !PSP.repeat;
        $('repeat-button').setAttribute('aria-pressed', String(PSP.repeat));
    }
    $('repeat-button').addEventListener('click', toggleRepeat);
    function updateVolume() {
        const volume = Number($('volume-slider').value);
        if (PSP.output) PSP.output.gain.rampTo(volume / 100, .03);
        $('volume-val').textContent = `${volume}%`;
        $('mute-button').setAttribute('aria-label', volume ? 'Mute' : 'Unmute');
        $('mute-button').setAttribute('aria-pressed', String(!volume));
        fillRange($('volume-slider'));
    }
    function toggleMute() {
        const volume = Number($('volume-slider').value);
        if (volume) previousVolume = volume;
        $('volume-slider').value = volume ? 0 : previousVolume;
        updateVolume();
    }
    $('volume-slider').addEventListener('input', updateVolume);
    $('mute-button').addEventListener('click', toggleMute);

    const PRESET_KEY = 'psp_audio_editor_user_presets_v1';
    const builtinPresets = [
        { id: 'default', name: 'Default', values: { speed: 1, mix: 0, decay: 2 } },
        { id: 'slowed', name: 'Slowed', values: { speed: .82, mix: .45, decay: 4.2 } },
        { id: 'nightcore', name: 'Nightcore', values: { speed: 1.25, mix: .12, decay: 2 } },
        { id: 'faded', name: 'Faded', values: { speed: .9, mix: .25, decay: 2 } },
        { id: 'perfect', name: 'Perfect!', values: { speed: 1.1, mix: .1, decay: 2 } }
    ];
    function loadUserPresets() {
        try {
            const saved = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]');
            if (!Array.isArray(saved)) return [];
            return saved.filter(p => p && typeof p.name === 'string' && p.values && ['speed', 'mix', 'decay'].every(key => Number.isFinite(Number(p.values[key])))).map((p, index) => ({
                id: typeof p.id === 'string' && p.id.startsWith('user_') ? p.id : `user_${index}`, name: p.name.slice(0, 24), user: true,
                values: { speed: clamp(Number(p.values.speed), .5, 1.5), mix: clamp(Number(p.values.mix), 0, 1), decay: clamp(Number(p.values.decay), .5, 10) }
            }));
        } catch { PSP.notify('Saved presets are unavailable in this browser. You can still edit audio.'); return []; }
    }
    let userPresets = loadUserPresets();
    function saveUserPresets(next) {
        try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)); userPresets = next; return true; }
        catch { PSP.notify('Could not save presets. Browser storage may be full or disabled.'); return false; }
    }
    function selectPreset(preset) {
        selectedPreset = preset.id;
        PSP.currentPresetName = preset.name;
        PSP.speedS.value = preset.values.speed;
        PSP.mixS.value = preset.values.mix;
        PSP.decayS.value = preset.values.decay;
        updateSettings();
        apply();
        PSP.saveCurrentSettings();
    }
    function updatePresetSelection() {
        $('preset-name').textContent = PSP.currentPresetName;
        document.querySelectorAll('[data-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.preset === selectedPreset)));
    }
    function renderPresets() {
        $('presets-group').replaceChildren();
        for (const preset of [...builtinPresets, ...userPresets]) {
            const wrapper = document.createElement('div');
            wrapper.className = `preset${preset.user ? ' user-preset' : ''}`;
            const button = document.createElement('button');
            button.textContent = preset.name;
            button.title = `${preset.name}: ${preset.values.speed}×, ${Math.round(preset.values.mix * 100)}% reverb, ${preset.values.decay}s decay`;
            button.dataset.preset = preset.id;
            button.addEventListener('click', () => selectPreset(preset));
            wrapper.append(button);
            if (preset.user) {
                const remove = document.createElement('button');
                remove.className = 'delete-preset';
                remove.setAttribute('aria-label', `Delete preset ${preset.name}`);
                remove.append(icon('close'));
                remove.addEventListener('click', () => {
                    if (!saveUserPresets(userPresets.filter(p => p.id !== preset.id))) return;
                    if (selectedPreset === preset.id) { selectedPreset = null; PSP.currentPresetName = 'Custom'; }
                    renderPresets();
                    $('reset-effects').focus();
                });
                wrapper.append(remove);
            }
            $('presets-group').append(wrapper);
        }
        const wrapper = document.createElement('div');
        wrapper.className = 'preset';
        const save = document.createElement('button');
        save.textContent = '+ Save';
        save.setAttribute('aria-label', 'Save preset');
        save.addEventListener('click', () => { $('preset-input').value = ''; $('preset-dialog').showModal(); });
        wrapper.append(save);
        $('presets-group').append(wrapper);
        updatePresetSelection();
    }
    $('preset-cancel').addEventListener('click', () => $('preset-dialog').close());
    $('preset-form').addEventListener('submit', event => {
        event.preventDefault();
        const name = $('preset-input').value.trim();
        if (!name) { $('preset-input').setCustomValidity('Enter a preset name.'); $('preset-input').reportValidity(); return; }
        const preset = { id: `user_${Date.now()}`, name, values: PSP.currentSettings(), user: true };
        if (!saveUserPresets([...userPresets, preset])) return;
        selectedPreset = preset.id;
        PSP.currentPresetName = name;
        PSP.saveCurrentSettings();
        $('preset-dialog').close();
        renderPresets();
        PSP.notify(`Saved “${name}”.`);
    });
    $('preset-input').addEventListener('input', () => $('preset-input').setCustomValidity(''));
    $('reset-effects').addEventListener('click', () => selectPreset(builtinPresets[0]));
    function updateSettings() {
        $('speed-val').textContent = `${Number(PSP.speedS.value).toFixed(2)}×`;
        $('mix-val').textContent = `${Math.round(PSP.mixS.value * 100)}%`;
        $('decay-val').textContent = `${Number(PSP.decayS.value).toFixed(1)}s`;
        for (const slider of [PSP.speedS, PSP.mixS, PSP.decayS]) fillRange(slider);
        updatePresetSelection();
    }
    function apply(immediate = false) {
        if (!PSP.player) return;
        if (PSP.isPlaying) {
            PSP.audioOffset = clamp(PSP.currentAudioPos(), 0, PSP.dur());
            PSP.startedAt = PSP.context.now();
        }
        PSP.lastKnownRate = Number(PSP.speedS.value);
        PSP.player.playbackRate = PSP.lastKnownRate;
        PSP.processing.update(PSP.captureSettings(), { immediate });
    }
    for (const slider of [PSP.speedS, PSP.mixS, PSP.decayS]) slider.addEventListener('input', () => {
        selectedPreset = null;
        PSP.currentPresetName = 'Custom';
        updateSettings();
        apply();
        PSP.saveCurrentSettings();
    });

    function drawWaveform() {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        if (!PSP.isLoaded || !canvasWidth || !canvasHeight) return;
        const values = PSP.analyzer.getValue();
        ctx.beginPath();
        ctx.strokeStyle = '#eaf6ff';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < values.length; i++) {
            const x = i / (values.length - 1) * canvasWidth;
            const y = canvasHeight / 2 + values[i] * canvasHeight * .42;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    function tick(timestamp) {
        frame = 0;
        if (document.hidden || !PSP.isPlaying) return;
        if (timestamp - lastFrame > (reducedMotion.matches ? 250 : 33)) {
            lastFrame = timestamp;
            updateTime();
            if (!reducedMotion.matches) drawWaveform();
        }
        if (PSP.currentAudioPos() >= PSP.dur()) { finishTrack(); return; }
        frame = requestAnimationFrame(tick);
    }
    function startAnimation() { if (!frame && !document.hidden) frame = requestAnimationFrame(tick); }
    function finishTrack() {
        if (!PSP.isPlaying || !PSP.isLoaded) return;
        PSP.player.stop();
        PSP.isPlaying = false;
        PSP.audioOffset = PSP.dur();
        if (PSP.repeat) { PSP.audioOffset = 0; mediaPlay(); }
        else if (PSP.currentIndex < PSP.playlist.length - 1) mediaNext();
        else updatePlaybackUI();
    }
    // the queue must also advance when requestAnimationFrame is suspended in a hidden tab
    setInterval(() => { if (PSP.isPlaying && PSP.currentAudioPos() >= PSP.dur()) finishTrack(); }, 250);
    new ResizeObserver(() => {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(devicePixelRatio || 1, 2);
        canvasWidth = rect.width;
        canvasHeight = rect.height;
        canvas.width = Math.round(canvasWidth * dpr);
        canvas.height = Math.round(canvasHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawWaveform();
        updateMarquee();
    }).observe(canvas);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
        else { updateTime(); startAnimation(); }
    });
    reducedMotion.addEventListener('change', updateMarquee);
    document.fonts.ready.then(updateMarquee);
    for (const id of ['help-button', 'shortcuts-button']) $(id).addEventListener('click', () => $('help-dialog').showModal());
    document.addEventListener('keydown', event => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || document.querySelector('dialog[open]') || event.target.closest('input, select, textarea, button, a, [contenteditable="true"]')) return;
        if (event.code === 'Space') { event.preventDefault(); mediaToggle(); }
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            if (event.shiftKey) { if (event.key === 'ArrowLeft') mediaPrev(); else mediaNext(); }
            else seekToAudio(PSP.currentAudioPos() + (event.key === 'ArrowLeft' ? -5 : 5));
        } else if (event.key.toLowerCase() === 'm') toggleMute();
        else if (event.key.toLowerCase() === 'r') toggleRepeat();
    });
    document.querySelectorAll('.xmb-nav a').forEach(link => link.addEventListener('click', () => {
        document.querySelectorAll('.xmb-nav a').forEach(item => item.classList.toggle('selected', item === link));
    }));
    function updateClock() {
        const now = new Date();
        $('system-clock').dateTime = now.toISOString();
        $('system-clock').textContent = `${now.getMonth() + 1}/${now.getDate()}  ${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }
    updateClock();
    setInterval(updateClock, 60000);
    renderPresets();
    updateSettings();
    updateVolume();
    renderList();
})();
