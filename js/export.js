(() => {
    const PSP = (window.PSP = window.PSP || {});

    // export UI visibility
    function setExportUIVisibility(){
        PSP.exportBitrateEl.style.display = (PSP.exportFormatEl.value === "mp3") ? "inline-block" : "none";
    }
    PSP.exportFormatEl.addEventListener("change", setExportUIVisibility);
    setExportUIVisibility();

    // export hardening
    PSP.isExporting = false;
    PSP.exportCancelToken = { cancelled: false };

    function resetCancelButton(){
        if (!PSP.exportCancelBtn) return;
        PSP.exportCancelBtn.disabled = !PSP.isExporting;
        PSP.exportCancelBtn.textContent = "Cancel";
    }

    function setExportingState(on){
        PSP.isExporting = !!on;

        PSP.exportFormatEl.disabled = PSP.isExporting;
        PSP.exportBitrateEl.disabled = PSP.isExporting;
        if (PSP.batchBtn) PSP.batchBtn.disabled = PSP.isExporting;

        document.querySelectorAll('.mini[title="Download"], .mini[title="Remove"]').forEach(btn => {
        btn.disabled = PSP.isExporting;
        });

        if (PSP.exportCancelBtn) PSP.exportCancelBtn.disabled = !PSP.isExporting;
        if (!PSP.isExporting) resetCancelButton();
    }
    PSP.setExportingState = setExportingState;

    function throwIfCancelled(){
        if (PSP.exportCancelToken.cancelled) {
        const err = new Error("Export cancelled");
        err.name = "ExportCancelled";
        throw err;
        }
    }

    if (PSP.exportCancelBtn){
        PSP.exportCancelBtn.addEventListener('click', () => {
        if (!PSP.isExporting) return;
        PSP.exportCancelToken.cancelled = true;
        PSP.exportCancelBtn.disabled = true;
        PSP.exportCancelBtn.textContent = "Cancelling…";
        });
    }

    // naming + overlay
    function safeFilePart(s){
        return String(s)
        .replace(/[\\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
    }

    function stripExtension(filename){
        const name = String(filename || "");
        return name.replace(/\.[^/.]+$/, "");
    }

    function exportNameForTrack(trackTitle){
        const preset = safeFilePart(PSP.currentPresetName || "Preset");
        const rawTitle = stripExtension(trackTitle || "track");
        const title = safeFilePart(rawTitle);
        const ext = PSP.exportFormatEl.value;
        return `[${preset}] ${title}.${ext}`;
    }

    function showExportBar(title){
        PSP.exportTitleEl.textContent = title;
        PSP.exportPctEl.textContent = "0%";
        PSP.exportFillEl.style.width = "0%";
        PSP.exportBar.style.display = "block";
        resetCancelButton();
    }
    function updateExportBar(title, pct){
        if (title) PSP.exportTitleEl.textContent = title;
        const p = Math.max(0, Math.min(100, pct || 0));
        PSP.exportPctEl.textContent = `${Math.round(p)}%`;
        PSP.exportFillEl.style.width = `${p}%`;
    }
    function hideExportBar(){
        PSP.exportBar.style.display = "none";
        resetCancelButton();
    }

    // render/export helpers
    async function fetchArrayBuffer(url){
        const res = await fetch(url);
        return await res.arrayBuffer();
    }

    async function renderProcessedBuffer(trackUrl, settings, onProgress){
        throwIfCancelled();

        const srcData = await fetchArrayBuffer(trackUrl);
        throwIfCancelled();

        const audioBuffer = await Tone.getContext().rawContext.decodeAudioData(srcData.slice(0));
        throwIfCancelled();

        const rate = Number(settings.speed) || 1;
        const wet = Number(settings.mix) || 0;
        const decay = Number(settings.decay) || 1.5;

        const baseDur = audioBuffer.duration / rate;
        const tail = Math.min(6, Math.max(1.0, decay * 0.6));
        const total = baseDur + tail;

        onProgress?.(10);

        const rendered = await Tone.Offline(async () => {
        const rvb = new Tone.Reverb({ decay, wet }).toDestination();
        const p = new Tone.Player(audioBuffer).connect(rvb);
        p.playbackRate = rate;
        p.start(0);
        }, total);

        throwIfCancelled();
        onProgress?.(60);

        return rendered;
    }

    function audioBufferToWav(buffer){
        const numCh = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const length = buffer.length;
        const bytesPerSample = 2;
        const blockAlign = numCh * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = length * blockAlign;

        const buf = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buf);

        const writeStr = (off, str) => { for (let i=0;i<str.length;i++) view.setUint8(off+i, str.charCodeAt(i)); };

        writeStr(0, "RIFF");
        view.setUint32(4, 36 + dataSize, true);
        writeStr(8, "WAVE");
        writeStr(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numCh, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true);
        writeStr(36, "data");
        view.setUint32(40, dataSize, true);

        let offset = 44;
        const chData = [];
        for (let c=0;c<numCh;c++) chData.push(buffer.getChannelData(c));

        for (let i=0;i<length;i++){
        for (let c=0;c<numCh;c++){
            let s = chData[c][i];
            s = Math.max(-1, Math.min(1, s));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            offset += 2;
        }
        }

        return new Blob([buf], { type:"audio/wav" });
    }

    function audioBufferToMp3(buffer, kbps, onProgress){
        if (!window.lamejs) throw new Error("MP3 encoder not loaded.");

        const numCh = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const bitrate = Number(kbps) || 192;

        const mp3enc = new lamejs.Mp3Encoder(numCh, sampleRate, bitrate);

        const left = buffer.getChannelData(0);
        const right = (numCh > 1) ? buffer.getChannelData(1) : null;

        const blockSize = 1152;
        let mp3Data = [];

        const floatTo16 = (f) => {
        const v = Math.max(-1, Math.min(1, f));
        return v < 0 ? (v * 0x8000) : (v * 0x7FFF);
        };

        const totalBlocks = Math.ceil(left.length / blockSize);

        for (let b=0; b<totalBlocks; b++){
        throwIfCancelled();

        const start = b * blockSize;
        const end = Math.min(left.length, start + blockSize);

        const l = new Int16Array(end - start);
        const r = (numCh > 1) ? new Int16Array(end - start) : null;

        for (let i=0;i<l.length;i++){
            l[i] = floatTo16(left[start + i]);
            if (r) r[i] = floatTo16(right[start + i]);
        }

        const chunk = (numCh > 1) ? mp3enc.encodeBuffer(l, r) : mp3enc.encodeBuffer(l);
        if (chunk.length) mp3Data.push(new Uint8Array(chunk));

        if (onProgress) {
            const pct = 60 + (b / totalBlocks) * 35;
            onProgress(pct);
        }
        }

        const end = mp3enc.flush();
        if (end.length) mp3Data.push(new Uint8Array(end));

        onProgress?.(100);
        return new Blob(mp3Data, { type:"audio/mpeg" });
    }

    function triggerDownload(blob, filename){
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    async function exportTrackToBlob(track, settings, onProgress){
        throwIfCancelled();

        const fmt = PSP.exportFormatEl.value;
        const kbps = Number(PSP.exportBitrateEl.value) || 192;

        const rendered = await renderProcessedBuffer(track.url, settings, (p) => {
        throwIfCancelled();
        onProgress?.(p);
        });

        throwIfCancelled();

        if (fmt === "wav") {
        onProgress?.(85);
        const wavBlob = audioBufferToWav(rendered);
        onProgress?.(100);
        return wavBlob;
        } else {
        return audioBufferToMp3(rendered, kbps, (p) => {
            throwIfCancelled();
            onProgress?.(p);
        });
        }
    }

    async function downloadOne(index){
        if (PSP.isExporting) return;
        if (index < 0 || index >= PSP.playlist.length) return;

        const track = PSP.playlist[index];
        const filename = exportNameForTrack(track.name);
        const settings = PSP.currentSettings();

        PSP.exportCancelToken = { cancelled: false };
        setExportingState(true);

        try{
        showExportBar(`Exporting ${filename}`);
        updateExportBar(`Exporting ${filename}`, 0);

        throwIfCancelled();

        const blob = await exportTrackToBlob(track, settings, (p) => {
            updateExportBar(`Exporting ${filename}`, p);
        });

        throwIfCancelled();

        triggerDownload(blob, filename);
        updateExportBar(`Finished ${filename}`, 100);
        setTimeout(hideExportBar, 700);

        } catch (err){
        console.error(err);

        if (err && err.name === "ExportCancelled") {
            updateExportBar(`Cancelled: ${filename}`, 100);
            setTimeout(hideExportBar, 600);
        } else {
            updateExportBar(`Export failed: ${track.name}`, 100);
            setTimeout(hideExportBar, 1200);
            alert("Export failed. Check console for details.");
        }
        } finally {
        setExportingState(false);
        resetCancelButton();
        }
    }

    async function batchDownload(){
        if (PSP.isExporting) return;
        if (!PSP.playlist.length) return;

        const settings = PSP.currentSettings();
        const preset = safeFilePart(PSP.currentPresetName || "Preset");
        const zipName = `${preset} batch download.zip`;

        const zip = new JSZip();

        PSP.exportCancelToken = { cancelled: false };
        setExportingState(true);

        try{
        showExportBar(`Batch exporting: ${zipName}`);
        updateExportBar(`Batch exporting: ${zipName}`, 0);

        for (let i=0;i<PSP.playlist.length;i++){
            throwIfCancelled();

            const track = PSP.playlist[i];
            const filename = exportNameForTrack(track.name);

            const base = (i / PSP.playlist.length) * 100;
            const span = (1 / PSP.playlist.length) * 100;

            const blob = await exportTrackToBlob(track, settings, (p) => {
            const overall = base + (p/100) * span;
            updateExportBar(`Exporting ${filename}`, overall);
            });

            throwIfCancelled();
            zip.file(filename, blob);
        }

        throwIfCancelled();
        updateExportBar(`Zipping…`, 98);

        const zipBlob = await zip.generateAsync({ type:"blob" }, (meta) => {
            throwIfCancelled();
            const pct = 98 + (meta.percent * 0.02);
            updateExportBar(`Zipping…`, pct);
        });

        throwIfCancelled();

        triggerDownload(zipBlob, zipName);
        updateExportBar(`Finished ${zipName}`, 100);
        setTimeout(hideExportBar, 900);

        } catch (err){
        console.error(err);

        if (err && err.name === "ExportCancelled") {
            updateExportBar(`Cancelled: ${zipName}`, 100);
            setTimeout(hideExportBar, 700);
        } else {
            updateExportBar(`Batch export failed`, 100);
            setTimeout(hideExportBar, 1200);
            alert("Batch export failed. Check console for details.");
        }
        } finally {
        setExportingState(false);
        resetCancelButton();
        }
    }

    // expose for inline onclicks
    window.downloadOne = downloadOne;
    window.batchDownload = batchDownload;

    // if app.js already rendered list before export.js loaded, re-apply disabled state
    if (typeof PSP.renderList === "function") PSP.renderList();
})();