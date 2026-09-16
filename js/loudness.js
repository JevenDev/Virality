(() => {
    const PSP = window.PSP;
    const $ = id => document.getElementById(id);
    const entries = [];
    let running = false, generation = 0, activeJob = null, selected = null;
    const format = value => value === null || value === undefined ? 'N/A' : value === -Infinity ? '−∞' : value.toFixed(1);
    const isActive = () => $('dock-loudness').getAttribute('aria-selected') === 'true';
    const status = message => { $('lufs-status').textContent = message; };
    function updateControls() {
        $('lufs-cancel').hidden = !running;
        $('lufs-clear').disabled = !entries.length;
        $('lufs-copy').disabled = $('lufs-download').disabled = !entries.some(entry => entry.result);
        $('lufs-current').disabled = !PSP.playlist[PSP.currentIndex];
    }
    function renderRows() {
        const focusedRow = [...$('lufs-rows').children].findIndex(row => row.contains(document.activeElement));
        $('lufs-empty').hidden = entries.length > 0;
        $('lufs-table-wrap').hidden = !entries.length;
        $('lufs-rows').replaceChildren(...entries.map(entry => {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            const button = document.createElement('button');
            button.className = 'text-button lufs-file';
            button.textContent = entry.name;
            button.disabled = !entry.result;
            button.setAttribute('aria-pressed', String(entry === selected));
            button.addEventListener('click', () => { selected = entry; renderRows(); renderDetail(); });
            cell.append(button);
            row.append(cell);
            for (const value of entry.result
                ? [PSP.fmt(entry.result.duration), format(entry.result.integrated), format(entry.result.lra), format(entry.result.truePeak), 'Complete']
                : ['', '', '', '', entry.state]) {
                const td = document.createElement('td');
                td.textContent = value;
                row.append(td);
            }
            row.classList.toggle('lufs-selected', entry === selected);
            return row;
        }));
        if (focusedRow >= 0) $('lufs-rows').children[focusedRow]?.querySelector('button').focus({ preventScroll: true });
        updateControls();
    }
    function renderGraph(result) {
        const top = Math.max(0, Math.ceil(Math.max(result.maxMomentary ?? -70, result.maxShortTerm ?? -70) / 10) * 10);
        const bottom = -70;
        const y = value => 220 * (top - Math.max(bottom, Math.min(top, value))) / (top - bottom);
        function path(points) {
            // preserve each display bucket's extrema so short peaks survive long-file plotting
            const stride = Math.max(1, Math.ceil(points.length / 900));
            const reduced = [];
            for (let i = 0; i < points.length; i += stride) {
                const bucket = points.slice(i, i + stride);
                let low = bucket[0], high = bucket[0];
                bucket.forEach(point => {
                    if (point.value < low.value) low = point;
                    if (point.value > high.value) high = point;
                });
                reduced.push(...[low, high].sort((a, b) => a.time - b.time));
            }
            return reduced.map((point, i) => `${i ? 'L' : 'M'}${(point.time / result.duration * 900).toFixed(2)} ${y(point.value).toFixed(2)}`).join(' ');
        }
        $('lufs-momentary').setAttribute('d', path(result.momentary));
        $('lufs-short-term').setAttribute('d', path(result.shortTerm));
        $('lufs-axis-top').textContent = `${top} LUFS`;
        $('lufs-axis-middle').textContent = String((top + bottom) / 2);
        $('lufs-graph-end').textContent = PSP.fmt(result.duration);
        $('lufs-graph').setAttribute('aria-label', `Loudness over ${PSP.fmt(result.duration)}. Maximum momentary ${format(result.maxMomentary)} LUFS, maximum short-term ${format(result.maxShortTerm)} LUFS.`);
    }
    function renderTarget() {
        const result = selected?.result;
        const input = $('lufs-target');
        if (!result || !Number.isFinite(result.integrated)) {
            $('lufs-gain').textContent = 'A measurable integrated loudness is needed to compare a target.';
            return;
        }
        if (!input.value || !input.checkValidity()) {
            $('lufs-gain').textContent = 'Enter a target between −70 and 0 LUFS.';
            return;
        }
        const gain = Number(input.value) - result.integrated;
        const peak = result.truePeak + gain;
        $('lufs-gain').textContent = `${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB to reach this target. Predicted true peak: ${format(peak)} dBTP.${peak > 0 ? ' This would exceed 0 dBTP and needs peak control.' : ''} Audio is unchanged.`;
    }
    function renderDetail() {
        const result = selected?.result;
        $('lufs-detail').hidden = !result;
        if (!result) return;
        $('lufs-name').textContent = selected.name;
        $('lufs-meta').textContent = `${result.channels === 1 ? 'Mono' : 'Stereo'} · ${PSP.fmt(result.duration)} · Original file · Analyzed at 48 kHz`;
        for (const [id, key] of [['integrated', 'integrated'], ['range', 'lra'], ['true-peak', 'truePeak'], ['sample-peak', 'samplePeak'], ['max-momentary', 'maxMomentary'], ['max-short', 'maxShortTerm']]) {
            $(`lufs-${id}`).textContent = format(result[key]);
        }
        $('lufs-reading-note').textContent = result.duration < .4
            ? 'At least 0.4 seconds is needed for integrated and momentary loudness. Peak readings are available.'
            : !Number.isFinite(result.integrated)
                ? 'No audio above the −70 LUFS gate. Integrated loudness is −∞ and loudness range is unavailable.'
                : result.duration < 3.1 ? 'At least 3.1 seconds is needed for loudness range. Short-term loudness needs 3 seconds.'
                    : 'Integrated loudness covers the whole file. LRA describes its loudness variation.';
        renderGraph(result);
        renderTarget();
    }
    function measure(buffer, entry, version) {
        return new Promise((resolve, reject) => {
            const worker = new Worker('./js/loudness-worker.js?v=1.0');
            const finish = (error, result) => {
                worker.terminate();
                if (activeJob?.worker === worker) activeJob = null;
                if (error) reject(error); else resolve(result);
            };
            activeJob = { worker, cancel: () => finish(new DOMException('Analysis cancelled.', 'AbortError')) };
            worker.onerror = event => { event.preventDefault(); finish(new Error('Could not run the loudness analyzer. Reload and try again.')); };
            worker.onmessage = event => {
                if (version !== generation) return;
                if (event.data.error) finish(new Error(event.data.error));
                else if (event.data.result) finish(null, event.data.result);
                else if (event.data.percent !== undefined) {
                    $('lufs-progress').value = event.data.percent;
                    status(`Analyzing ${entry.name} · ${Math.round(event.data.percent)}%`);
                }
            };
            try {
                const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice());
                worker.postMessage({ channels, sampleRate: buffer.sampleRate }, channels.map(channel => channel.buffer));
            } catch (error) { finish(error); }
        });
    }
    async function runQueue() {
        if (running) return;
        running = true;
        const version = generation;
        $('lufs-progress').hidden = false;
        updateControls();
        try {
            for (const entry of entries) {
                if (entry.state !== 'Queued') continue;
                entry.state = 'Decoding…';
                $('lufs-progress').removeAttribute('value');
                status(`Reading ${entry.name}…`);
                renderRows();
                try {
                    const bytes = await entry.file.arrayBuffer();
                    if (version !== generation) return;
                    const context = new OfflineAudioContext(2, 1, 48000);
                    let buffer;
                    try { buffer = await context.decodeAudioData(bytes); }
                    catch { throw new Error('Cannot decode this file. Try WAV, MP3, FLAC, M4A or OGG supported by your browser.'); }
                    if (version !== generation) return;
                    if (buffer.numberOfChannels > 2) throw new Error('Only mono and stereo files are supported.');
                    if (buffer.duration > 1800) throw new Error('Choose a file up to 30 minutes long.');
                    entry.state = 'Analyzing…';
                    renderRows();
                    entry.result = await measure(buffer, entry, version);
                    if (version !== generation) return;
                    entry.state = 'Complete';
                    selected = entry;
                    renderDetail();
                } catch (error) {
                    if (version !== generation) return;
                    entry.state = error.message;
                } finally {
                    entry.file = null;
                }
                renderRows();
            }
            const count = entries.filter(entry => entry.result).length;
            const failed = entries.filter(entry => entry.state !== 'Complete').length;
            status(`${count} ${count === 1 ? 'file' : 'files'} measured.${failed ? ` ${failed} not measured. See the file list for details.` : ''}`);
        } finally {
            if (version === generation) {
                running = false;
                $('lufs-progress').hidden = true;
                updateControls();
            }
        }
    }
    function addFiles(files) {
        let added = 0;
        for (const file of files) {
            if (!file.size || file.size > 100 * 1024 * 1024) {
                entries.push({ name: file.name, state: file.size ? 'File exceeds 100 MB.' : 'File is empty.' });
                continue;
            }
            entries.push({ name: file.name, file, state: 'Queued' });
            added++;
        }
        renderRows();
        if (added) runQueue();
        else status('No files queued. Choose a non-empty audio file up to 100 MB.');
    }
    function cancel() {
        generation++;
        activeJob?.cancel();
        for (const entry of entries) {
            if (entry.file) { entry.state = 'Cancelled'; entry.file = null; }
        }
        running = false;
        $('lufs-progress').hidden = true;
        renderRows();
        status('Analysis cancelled. Completed measurements are kept.');
    }
    function report() {
        const clean = text => String(text).replace(/[\r\n\t]/g, ' ');
        return ['Virality loudness report', 'Original files, decoded at 48 kHz. BS.1770-4 loudness, EBU Tech 3342 LRA, 4x true peak.',
            'File\tDuration\tIntegrated LUFS\tLRA LU\tTrue peak dBTP\tSample peak dBFS\tMax momentary LUFS\tMax short-term LUFS',
            ...entries.filter(entry => entry.result).map(entry => {
                const r = entry.result;
                return [clean(entry.name), r.duration.toFixed(3) + ' s', ...[r.integrated, r.lra, r.truePeak, r.samplePeak, r.maxMomentary, r.maxShortTerm].map(format)].join('\t');
            })].join('\n');
    }
    $('lufs-browse').addEventListener('click', () => $('lufs-upload').click());
    $('lufs-upload').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
    $('lufs-current').addEventListener('click', async () => {
        const track = PSP.playlist[PSP.currentIndex];
        if (!track) return;
        const version = generation;
        try {
            const response = await fetch(track.url);
            if (!response.ok) throw new Error('Could not read the selected track.');
            const blob = await response.blob();
            if (version === generation) addFiles([new File([blob], track.name, { type: blob.type })]);
        } catch (error) { if (version === generation) PSP.notify(error.message); }
    });
    $('lufs-cancel').addEventListener('click', cancel);
    $('lufs-clear').addEventListener('click', () => {
        cancel();
        entries.length = 0;
        selected = null;
        renderRows();
        renderDetail();
        status('Choose audio files to measure.');
    });
    $('lufs-target').addEventListener('input', renderTarget);
    $('lufs-copy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(report()); PSP.notify('Loudness report copied.'); }
        catch { PSP.notify('Clipboard unavailable. Use Download report instead.'); }
    });
    $('lufs-download').addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([report()], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'virality-loudness-report.txt';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    document.addEventListener('playbackchange', updateControls);
    PSP.loudness = { addFiles, isActive };
    updateControls();
})();
