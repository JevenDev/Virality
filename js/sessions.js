(() => {
    const PSP = window.PSP;
    const $ = id => document.getElementById(id);
    let pending = null, sessionName = 'Virality session';
    const busy = () => PSP.isLoading || PSP.isExporting || PSP.isSessionBusy;
    function sync() {
        for (const id of ['session-save', 'session-open', 'session-backup']) $(id).disabled = Boolean(busy());
        $('session-confirm').disabled = !pending || Boolean(busy());
        $('session-cancel').disabled = Boolean(PSP.isSessionBusy);
    }
    function setBusy(on) {
        PSP.isSessionBusy = on;
        for (const selector of ['.workspace', '.page-stack', '.tool-dock']) document.querySelector(selector).inert = on;
        PSP.updateWorkspace();
    }
    function download(blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = sessionName.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') + '.virality';
        ($('session-dialog').open ? $('session-dialog') : document.body).append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    async function save() {
        if (busy()) return;
        PSP.saveCurrentSettings();
        const tracks = PSP.playlist.map(track => ({
            source: track.file, url: track.url, name: track.name, size: track.size,
            modified: track.modified, settings: structuredClone(track.settings)
        }));
        const state = {
            format: 'virality-session', version: 1,
            currentIndex: PSP.currentIndex, editorSettings: PSP.committedSettings(),
            position: PSP.isLoaded ? Math.max(0, Math.min(PSP.dur(), PSP.currentAudioPos())) : 0,
            volume: Number($('volume-slider').value), repeat: PSP.repeat,
            export: { format: PSP.exportFormatEl.value, bitrate: Number(PSP.exportBitrateEl.value) },
            page: document.querySelector('.dock-item[aria-selected="true"]')?.dataset.tool || 'music'
        };
        setBusy(true);
        $('session-status').textContent = 'Saving session, including original audio…';
        try {
            const audio = [];
            for (const track of tracks) {
                if (track.source) audio.push(track.source);
                else {
                    const response = await fetch(track.url);
                    if (!response.ok) throw new Error(`Could not read ${track.name}.`);
                    audio.push(await response.blob());
                }
            }
            state.tracks = tracks.map((track, index) => ({
                name: track.name, size: track.size, modified: track.modified,
                type: audio[index].type, settings: track.settings
            }));
            download(PSP.sessionData.pack(state, audio));
            $('session-status').textContent = PSP.presets.hasPreview()
                ? 'Session download started with saved settings. Pending preset previews were not included.'
                : 'Session download started with audio and sound settings.';
            $('session-error').textContent = '';
        } catch (error) {
            $('session-status').textContent = `Could not save session. ${error.message}`;
            if ($('session-dialog').open) $('session-error').textContent = $('session-status').textContent;
        } finally { setBusy(false); }
    }
    $('session-save').addEventListener('click', save);
    $('session-backup').addEventListener('click', save);
    $('session-open').addEventListener('click', () => { if (!busy()) $('session-upload').click(); });
    $('session-upload').addEventListener('change', async event => {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file || busy()) return;
        setBusy(true);
        $('session-status').textContent = 'Reading session…';
        try {
            const prepared = await PSP.sessionData.unpack(file);
            pending = { ...prepared, name: file.name.replace(/\.virality$/i, '').slice(0, 80) || 'Virality session' };
            const count = prepared.manifest.tracks.length;
            $('session-summary').textContent = `${file.name} · ${count} ${count === 1 ? 'track' : 'tracks'} · ${(file.size / 1048576).toFixed(1)} MB including audio.`;
            $('session-error').textContent = '';
            $('session-status').textContent = '';
            $('session-dialog').showModal();
        } catch (error) {
            $('session-status').textContent = `Could not open session. ${error.message} Your current session was not changed.`;
        } finally { setBusy(false); }
    });
    $('session-cancel').addEventListener('click', () => $('session-dialog').close());
    $('session-dialog').addEventListener('cancel', event => { if (PSP.isSessionBusy) event.preventDefault(); });
    $('session-dialog').addEventListener('close', () => { pending = null; sync(); });
    $('session-confirm').addEventListener('click', async () => {
        if (!pending || busy()) return;
        const prepared = pending;
        setBusy(true);
        $('session-error').textContent = 'Restoring audio…';
        try {
            let decoded = null;
            if (prepared.manifest.currentIndex >= 0) {
                await PSP.ensureAudio();
                decoded = await PSP.context.rawContext.decodeAudioData(await prepared.audio[prepared.manifest.currentIndex].arrayBuffer());
            }
            await PSP.restoreSession(prepared.manifest, prepared.audio, decoded);
            sessionName = prepared.name;
            $('session-dialog').close();
            $('session-status').textContent = `Opened ${sessionName}. Playback is paused. Undo history starts from this session.`;
        } catch (error) {
            $('session-error').textContent = `Could not restore session. ${error.message}`;
        } finally { setBusy(false); }
    });
    PSP.sessions = { sync };
    sync();
})();
