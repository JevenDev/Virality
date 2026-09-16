(() => {
    const PSP = window.PSP;
    const libraries = new Map();
    let hideTimer;
    PSP.exportCancelToken = { cancelled: false };

    function loadLibrary(name, url) {
        if (window[name]) return Promise.resolve();
        if (!libraries.has(name)) {
            libraries.set(name, new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = url;
                const timeout = setTimeout(() => fail(), 20000);
                function fail() {
                    clearTimeout(timeout);
                    libraries.delete(name);
                    script.remove();
                    reject(new Error(`Could not load ${name}. Check your connection and try again.`));
                }
                script.onload = () => {
                    clearTimeout(timeout);
                    if (window[name]) resolve(); else fail();
                };
                script.onerror = fail;
                document.head.append(script);
            }));
        }
        return libraries.get(name);
    }
    function setFormatVisibility() { PSP.exportBitrateEl.hidden = PSP.exportFormatEl.value !== 'mp3'; }
    PSP.exportFormatEl.addEventListener('change', setFormatVisibility);
    setFormatVisibility();
    function setExportingState(on) {
        PSP.isExporting = Boolean(on);
        PSP.exportFormatEl.disabled = on;
        PSP.exportBitrateEl.disabled = on;
        PSP.batchBtn.disabled = on || !PSP.playlist.length;
        for (const id of ['add-files', 'browse-files', 'workspace-add', 'audio-upload']) document.getElementById(id).disabled = on;
        document.querySelectorAll('.mini[title="Download"], .mini[title="Remove"]').forEach(button => { button.disabled = on; });
        PSP.exportCancelBtn.disabled = !on;
        PSP.exportCancelBtn.textContent = 'Cancel';
        PSP.updateWorkspace();
    }
    PSP.setExportingState = setExportingState;
    function throwIfCancelled() {
        if (PSP.exportCancelToken.cancelled) {
            const error = new Error('Export cancelled');
            error.name = 'ExportCancelled';
            throw error;
        }
    }
    PSP.exportCancelBtn.addEventListener('click', () => {
        PSP.exportCancelToken.cancelled = true;
        PSP.exportCancelBtn.disabled = true;
        PSP.exportCancelBtn.textContent = 'Cancelling…';
    });
    function safeFilePart(value) { return String(value).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'track'; }
    function exportName(track, settings) { return `[${safeFilePart(settings.preset)}] ${safeFilePart(track.name.replace(/\.[^/.]+$/, ''))}.${settings.format}`; }
    function uniqueName(filename, used) {
        let result = filename, suffix = 2;
        const dot = filename.lastIndexOf('.');
        while (used.has(result.toLowerCase())) result = `${filename.slice(0, dot)} (${suffix++})${filename.slice(dot)}`;
        used.add(result.toLowerCase());
        return result;
    }
    function updateExportBar(title, percent) {
        const progress = Math.round(Math.max(0, Math.min(100, percent)));
        PSP.exportTitleEl.textContent = title;
        PSP.exportPctEl.textContent = `${progress}%`;
        PSP.exportFillEl.style.width = `${progress}%`;
        document.getElementById('export-progress').setAttribute('aria-valuenow', String(progress));
    }
    const yieldToUI = () => new Promise(resolve => setTimeout(resolve, 0));
    async function renderProcessedBuffer(track, settings, progress) {
        throwIfCancelled();
        let audioBuffer;
        if (PSP.isLoaded && PSP.playlist[PSP.currentIndex] === track) audioBuffer = PSP.player.buffer.get();
        else {
            const response = await fetch(track.url);
            if (!response.ok) throw new Error(`Could not read ${track.name}.`);
            audioBuffer = await PSP.context.rawContext.decodeAudioData(await response.arrayBuffer());
        }
        throwIfCancelled();
        progress(10);
        const tail = PSP.processingTail(settings);
        let player, processing;
        try {
            const rendered = await Tone.Offline(async context => {
                processing = PSP.createProcessingChain(context, settings);
                processing.output.toDestination();
                player = new Tone.Player({ context, url: audioBuffer }).connect(processing.input);
                player.playbackRate = settings.speed;
                await processing.ready;
                throwIfCancelled();
                player.start(0);
            }, audioBuffer.duration / settings.speed + tail, 2, audioBuffer.sampleRate);
            throwIfCancelled();
            progress(60);
            return rendered;
        } finally {
            player?.dispose();
            processing?.dispose();
        }
    }
    async function audioBufferToWav(buffer, progress) {
        const channels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const length = buffer.length;
        const blockAlign = channels * 2;
        const dataSize = length * blockAlign;
        const output = new ArrayBuffer(44 + dataSize);
        const view = new DataView(output);
        const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
        write(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        write(8, 'WAVE');
        write(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, channels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true);
        write(36, 'data');
        view.setUint32(40, dataSize, true);
        const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
        let offset = 44;
        for (let start = 0; start < length; start += 65536) {
            throwIfCancelled();
            const end = Math.min(length, start + 65536);
            for (let i = start; i < end; i++) {
                for (let channel = 0; channel < channels; channel++) {
                    const sample = Math.max(-1, Math.min(1, data[channel][i]));
                    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
                    offset += 2;
                }
            }
            progress(60 + end / length * 40);
            await yieldToUI();
        }
        return new Blob([output], { type: 'audio/wav' });
    }
    async function audioBufferToMp3(buffer, bitrate, progress) {
        const channels = Math.min(2, buffer.numberOfChannels);
        const encoder = new lamejs.Mp3Encoder(channels, buffer.sampleRate, bitrate);
        const left = buffer.getChannelData(0);
        const right = channels > 1 ? buffer.getChannelData(1) : null;
        const data = [];
        const blockSize = 1152;
        const to16 = value => { const sample = Math.max(-1, Math.min(1, value)); return sample < 0 ? sample * 0x8000 : sample * 0x7fff; };
        for (let start = 0, block = 0; start < left.length; start += blockSize, block++) {
            throwIfCancelled();
            const length = Math.min(blockSize, left.length - start);
            const l = new Int16Array(length);
            const r = right ? new Int16Array(length) : null;
            for (let i = 0; i < length; i++) { l[i] = to16(left[start + i]); if (r) r[i] = to16(right[start + i]); }
            const chunk = r ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l);
            if (chunk.length) data.push(new Uint8Array(chunk));
            // yield between encoding batches so progress and cancellation remain interactive
            if (block % 24 === 0) { progress(60 + start / left.length * 39); await yieldToUI(); }
        }
        throwIfCancelled();
        const final = encoder.flush();
        if (final.length) data.push(new Uint8Array(final));
        progress(100);
        return new Blob(data, { type: 'audio/mpeg' });
    }
    async function exportTrackToBlob(track, settings, progress) {
        const rendered = await renderProcessedBuffer(track, settings, progress);
        try {
            return settings.format === 'wav' ? await audioBufferToWav(rendered, progress) : await audioBufferToMp3(rendered, settings.bitrate, progress);
        } finally { rendered.dispose(); }
    }
    function triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    async function runExport(tracks, batch) {
        if (PSP.isSessionBusy || PSP.isExporting || !tracks.length) return;
        PSP.saveCurrentSettings();
        const format = PSP.exportFormatEl.value;
        const bitrate = Number(PSP.exportBitrateEl.value);
        const jobs = tracks.map(track => ({ track, settings: { ...structuredClone(track.settings), format, bitrate } }));
        clearTimeout(hideTimer);
        PSP.exportCancelToken = { cancelled: false };
        setExportingState(true);
        PSP.exportBar.hidden = false;
        updateExportBar('Preparing export…', 0);
        try {
            await PSP.ensureAudio();
            if (format === 'mp3') await loadLibrary('lamejs', 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js');
            if (batch) await loadLibrary('JSZip', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
            throwIfCancelled();
            const zip = batch ? new JSZip() : null;
            const used = new Set();
            for (let i = 0; i < tracks.length; i++) {
                const { track, settings } = jobs[i];
                const filename = uniqueName(exportName(track, settings), used);
                const blob = await exportTrackToBlob(track, settings, percent => {
                    updateExportBar(`Exporting ${i + 1}/${tracks.length}: ${tracks[i].name}`, (i + percent / 100) / tracks.length * (batch ? 95 : 100));
                });
                throwIfCancelled();
                if (zip) zip.file(filename, blob); else triggerDownload(blob, filename);
            }
            if (zip) {
                const blob = await zip.generateAsync({ type: 'blob' }, metadata => {
                    throwIfCancelled();
                    updateExportBar('Creating ZIP…', 95 + metadata.percent * .05);
                });
                throwIfCancelled();
                triggerDownload(blob, 'Virality exports.zip');
            }
            updateExportBar('Export complete. Your download is ready.', 100);
        } catch (error) {
            if (error.name === 'ExportCancelled') updateExportBar('Export cancelled', 0);
            else {
                console.error('Audio export failed:', error);
                updateExportBar('Export failed. Try another file or format.', 0);
                PSP.notify(error.message || 'Could not export audio. Try another file or format.');
            }
        } finally {
            setExportingState(false);
            hideTimer = setTimeout(() => { PSP.exportBar.hidden = true; }, 3500);
        }
    }
    window.downloadOne = index => {
        const track = PSP.playlist[index];
        if (track) return runExport([track], false);
    };
    window.batchDownload = () => runExport([...PSP.playlist], true);
    PSP.batchBtn.addEventListener('click', window.batchDownload);
    setExportingState(false);
})();
