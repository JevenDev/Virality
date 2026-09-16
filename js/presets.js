(() => {
    const PSP = window.PSP;
    const data = PSP.presetData;
    const $ = id => document.getElementById(id);
    const storageKey = 'virality_presets_v2';
    const builtins = data.builtins(PSP.defaultSettings());
    let writable = true;
    let userPresets = load();
    let selectedId = builtins[0].id;
    let preview = null, editing = null;
    const all = () => [...builtins, ...userPresets];
    const selected = () => all().find(item => item.id === selectedId);
    const busy = () => PSP.isLoading || PSP.isExporting || PSP.isSessionBusy;
    function load() {
        try {
            const saved = localStorage.getItem(storageKey);
            if (saved !== null) {
                const presets = data.parse(saved);
                if (presets.some(item => builtins.some(builtin => builtin.id === item.id))) throw new Error('Saved preset IDs conflict with built-in presets.');
                return presets;
            }
            const legacy = localStorage.getItem('psp_audio_editor_user_presets_v1');
            if (!legacy) return [];
            const result = data.migrate(legacy, PSP.defaultSettings());
            if (result.presets.length) localStorage.setItem(storageKey, data.serialize(result.presets));
            if (result.skipped) PSP.notify(`${result.skipped} invalid old presets could not be migrated. The original saved data is still intact.`);
            return result.presets;
        } catch (error) {
            writable = false;
            $('presets-import-result').textContent = `Saved presets could not be loaded. ${error.message} Storage has been left untouched. Restore browser storage access and reload to save or import presets.`;
            PSP.notify('Saved presets are unavailable. See the message in Presets for details.');
            return [];
        }
    }
    function persist(next) {
        if (!writable) { PSP.notify('Preset storage is unavailable. Reload after restoring browser storage access.'); return false; }
        try { localStorage.setItem(storageKey, data.serialize(next)); }
        catch (error) { PSP.notify(`Could not save presets. ${error.message}`); return false; }
        userPresets = next;
        return true;
    }
    function title(settings) {
        const item = all().find(preset => preset.id === settings.presetId);
        return item ? item.name + (data.fingerprint(item.settings) === data.fingerprint(settings) ? '' : ' · Modified') : 'Custom';
    }
    const currentTrack = () => PSP.playlist[PSP.currentIndex] ?? null;
    const previewingCurrent = () => preview && preview.track === currentTrack();
    function committedSettings() {
        return previewingCurrent() ? structuredClone(preview.before) : PSP.captureSettings();
    }
    function settingsForTrack(track) {
        if (preview && !preview.track) {
            preview.track = track;
            preview.before = structuredClone(track.settings);
        }
        return preview?.track === track ? structuredClone(preview.settings) : track.settings;
    }
    function returnPreviewFocus() {
        if ($('preset-preview').contains(document.activeElement)) {
            document.querySelector('[role="tab"][aria-selected="true"]')?.focus();
        }
    }
    function cancelPreview() {
        if (!preview) return;
        const previous = preview;
        returnPreviewFocus();
        preview = null;
        if (previous.track === currentTrack()) PSP.applySettings(previous.before);
        else sync();
    }
    function previewPreset(item) {
        if (!item || busy()) return;
        PSP.saveCurrentSettings();
        const before = committedSettings();
        preview = {
            track: currentTrack(), before,
            settings: { ...data.settings(item.settings), preset: item.name, presetId: item.id }
        };
        PSP.applySettings(preview.settings);
    }
    function sync() {
        if (preview?.track && !PSP.playlist.includes(preview.track)) preview = null;
        const settings = PSP.captureSettings();
        PSP.currentPresetName = title(settings);
        if (previewingCurrent()) preview.settings = { ...settings, preset: PSP.currentPresetName };
        const label = previewingCurrent() ? `Previewing: ${PSP.currentPresetName}` : PSP.currentPresetName;
        $('preset-name').textContent = label;
        $('presets-current').textContent = previewingCurrent() ? label : `Current sound: ${label}`;
        $('preset-preview').hidden = !preview;
        document.body.classList.toggle('has-preset-preview', Boolean(preview));
        if (preview) {
            $('preset-preview-name').textContent = `Previewing ${preview.settings.preset}`;
            $('preset-preview-name').title = preview.settings.preset;
            $('preset-preview-target').textContent = preview.track
                ? `${preview.track.name}${previewingCurrent() ? '' : ' · Switch back to hear it'}`
                : 'Editor settings · Not applied';
            $('preset-preview-target').title = $('preset-preview-target').textContent;
        }
        $('preset-preview-apply').disabled = busy();
        $('preset-preview-undo').disabled = busy();
        $('presets-list').querySelectorAll('button').forEach(button => { button.disabled = busy(); });
        const item = selected();
        const isUser = userPresets.some(preset => preset.id === selectedId);
        $('presets-apply').disabled = !item || busy();
        $('presets-apply-all').disabled = !item || !PSP.playlist.length || busy();
        $('presets-update').disabled = Boolean(preview) || !isUser || !writable || busy() || data.fingerprint(item.settings) === data.fingerprint(settings);
        for (const id of ['presets-edit', 'presets-delete']) $(id).disabled = preview?.settings.presetId === selectedId || !isUser || !writable;
        $('presets-duplicate').disabled = !item || !writable;
        $('presets-export').disabled = !item;
        $('presets-export-all').disabled = !userPresets.length;
        $('presets-save').disabled = Boolean(preview) || !writable || busy();
        $('presets-import').disabled = !writable;
        const target = preview && preview.settings.presetId === item?.id ? preview.track : currentTrack();
        $('presets-target').textContent = target
            ? `Applies to: ${target.name}`
            : 'Applies to the editor. The next files you add will use this sound.';
    }
    function summary(settings) {
        const effects = [];
        if (settings.pitch) effects.push(`Pitch ${settings.pitch > 0 ? '+' : ''}${settings.pitch.toFixed(1)} st`);
        if (settings.mix > 0) effects.push('Reverb');
        if (settings.eq.enabled && (settings.eq.preamp || settings.eq.gains.some(gain => gain !== 0))) effects.push('EQ');
        if (settings.delay.enabled && settings.delay.mix > 0) effects.push('Delay');
        if (settings.distortion.enabled && settings.distortion.mix > 0) effects.push('Distortion');
        return `${settings.speed.toFixed(2)}× · ${effects.join(', ') || 'No added effects'}`;
    }
    function renderList() {
        const query = $('presets-search').value.trim().toLocaleLowerCase();
        const filter = $('presets-filter').value;
        const visible = all().filter(item =>
            (filter === 'all' || (filter === 'user') === userPresets.includes(item)) &&
            `${item.name} ${item.description} ${summary(item.settings)}`.toLocaleLowerCase().includes(query));
        if (!visible.some(item => item.id === selectedId)) selectedId = visible[0]?.id ?? null;
        $('presets-list').replaceChildren();
        for (const item of visible) {
            const row = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'preset-row';
            button.setAttribute('aria-pressed', String(item.id === selectedId));
            const name = document.createElement('span');
            name.className = 'preset-row-name';
            name.textContent = item.name;
            const details = document.createElement('span');
            details.className = 'preset-row-summary';
            details.textContent = summary(item.settings);
            const origin = document.createElement('span');
            origin.className = 'preset-row-origin';
            origin.textContent = userPresets.includes(item) ? 'My preset' : 'Built-in';
            button.append(name, details, origin);
            button.addEventListener('click', () => {
                selectedId = item.id;
                $('presets-list').querySelectorAll('button').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
                renderDetails();
                previewPreset(item);
                sync();
            });
            row.append(button);
            $('presets-list').append(row);
        }
        $('presets-count').textContent = `${visible.length} ${visible.length === 1 ? 'preset' : 'presets'}`;
        $('presets-empty').hidden = visible.length > 0;
        $('presets-empty').textContent = query ? 'No presets match your search.' : 'Save your current sound or import a preset to start your collection.';
    }
    function renderDetails() {
        const item = selected();
        $('presets-detail').hidden = !item;
        if (!item) return;
        $('presets-detail-name').textContent = item.name;
        $('presets-description').textContent = item.description || 'No description.';
        $('presets-origin').textContent = userPresets.includes(item) ? 'My preset' : 'Built-in preset';
        const s = item.settings;
        const percent = value => `${Math.round(value * 100)}%`;
        const db = value => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
        const state = value => value ? 'On' : 'Bypassed';
        const rows = [
            ['Speed', `${s.speed.toFixed(2)}× (also changes pitch)`],
            ['Pitch shift', `${s.pitch > 0 ? '+' : ''}${s.pitch.toFixed(1)} semitones (speed unchanged)`],
            ['Reverb', `${s.mix ? 'On' : 'Off'} · ${percent(s.mix)} mix · ${s.decay.toFixed(1)} s decay`],
            ['Equalizer', `${state(s.eq.enabled)} · ${db(s.eq.preamp)} preamp`],
            ['Delay', `${state(s.delay.enabled)} · ${Math.round(s.delay.time * 1000)} ms · ${percent(s.delay.feedback)} feedback · ${percent(s.delay.mix)} mix`],
            ['Distortion', `${state(s.distortion.enabled)} · ${db(s.distortion.drive)} drive · ${Math.round(s.distortion.tone)} Hz tone · ${db(s.distortion.output)} output · ${percent(s.distortion.mix)} mix`]
        ];
        $('presets-values').replaceChildren();
        for (const [label, value] of rows) {
            const row = document.createElement('div'), term = document.createElement('dt'), detail = document.createElement('dd');
            term.textContent = label;
            detail.textContent = value;
            row.append(term, detail);
            $('presets-values').append(row);
        }
        $('presets-bands').replaceChildren();
        ['31 Hz', '63 Hz', '125 Hz', '250 Hz', '500 Hz', '1 kHz', '2 kHz', '4 kHz', '8 kHz', '16 kHz'].forEach((label, index) => {
            const row = document.createElement('div'), term = document.createElement('dt'), detail = document.createElement('dd');
            term.textContent = label;
            detail.textContent = db(s.eq.gains[index]);
            row.append(term, detail);
            $('presets-bands').append(row);
        });
    }
    function refresh() { renderList(); renderDetails(); sync(); }
    function reveal(id) {
        selectedId = id;
        $('presets-search').value = '';
        $('presets-filter').value = 'all';
        refresh();
    }
    function libraryChanged(id = selectedId) {
        for (const track of PSP.playlist) track.settings.preset = title(track.settings);
        PSP.saveCurrentSettings();
        reveal(id);
    }
    function commitSound(settings, tracks, editor) {
        PSP.history.transaction('apply preset', () => {
            tracks.forEach(track => { track.settings = structuredClone(settings); });
            if (editor || tracks.includes(currentTrack())) PSP.applySettings(settings);
        });
        PSP.renderList();
    }
    function commitPreview(toAll = false) {
        if (!preview || busy()) return;
        const pending = preview;
        returnPreviewFocus();
        preview = null;
        const tracks = toAll ? PSP.playlist : pending.track ? [pending.track] : [];
        commitSound(pending.settings, tracks, !pending.track && PSP.currentIndex < 0);
        PSP.notify(toAll ? `Applied “${pending.settings.preset}” to ${tracks.length} tracks.` : `Applied “${pending.settings.preset}”.`);
    }
    function applyPreset(item, toAll = false) {
        if (!item || busy()) return;
        if (preview?.settings.presetId === item.id) { commitPreview(toAll); return; }
        cancelPreview();
        PSP.saveCurrentSettings();
        const settings = { ...data.settings(item.settings), preset: item.name, presetId: item.id };
        const tracks = toAll ? PSP.playlist : currentTrack() ? [currentTrack()] : [];
        commitSound(settings, tracks, PSP.currentIndex < 0);
        PSP.notify(toAll ? `Applied “${item.name}” to ${tracks.length} tracks.` : `Applied “${item.name}”.`);
    }
    function openEditor(mode) {
        const item = selected();
        if (!writable || (mode !== 'save' && !item) || (mode === 'save' && (preview || busy()))) return;
        editing = {
            mode, id: mode === 'edit' ? item.id : `user_${crypto.randomUUID()}`,
            settings: mode === 'save' ? data.settings(PSP.captureSettings()) : data.settings(item.settings)
        };
        $('preset-dialog-title').textContent = mode === 'edit' ? 'Edit preset details' : mode === 'duplicate' ? 'Duplicate preset' : 'Save current sound';
        $('preset-input').value = mode === 'save' ? '' : mode === 'duplicate' ? data.uniqueName(item.name, all()) : item.name;
        $('preset-description-input').value = mode === 'save' ? '' : item.description;
        $('preset-input').setCustomValidity('');
        $('preset-dialog-error').textContent = '';
        $('preset-dialog').showModal();
    }
    function download(presets, name) {
        const url = URL.createObjectURL(new Blob([data.serialize(presets)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') + '.virality.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    $('preset-form').addEventListener('submit', event => {
        event.preventDefault();
        if (!editing) return;
        const name = $('preset-input').value.trim();
        if (!name || all().some(item => item.id !== editing.id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
            $('preset-input').setCustomValidity(name ? 'A preset already uses this name.' : 'Enter a preset name.');
            $('preset-input').reportValidity();
            return;
        }
        const item = { id: editing.id, name, description: $('preset-description-input').value.trim(), settings: editing.settings };
        const next = editing.mode === 'edit' ? userPresets.map(preset => preset.id === item.id ? item : preset) : [...userPresets, item];
        if (!persist(next)) { $('preset-dialog-error').textContent = 'Could not save. Check browser storage access or free up space, then try again.'; return; }
        if (editing.mode === 'save' && data.fingerprint(PSP.captureSettings()) === data.fingerprint(editing.settings)) {
            PSP.setPresetIdentity(item.id, name);
        }
        $('preset-dialog').close();
        libraryChanged(item.id);
        PSP.notify(`Saved “${name}”.`);
    });
    $('preset-input').addEventListener('input', () => $('preset-input').setCustomValidity(''));
    $('preset-cancel').addEventListener('click', () => $('preset-dialog').close());
    $('presets-save').addEventListener('click', () => openEditor('save'));
    $('presets-edit').addEventListener('click', () => openEditor('edit'));
    $('presets-duplicate').addEventListener('click', () => openEditor('duplicate'));
    $('presets-update').addEventListener('click', () => {
        if (preview || busy()) return;
        const item = selected();
        if (!item || !userPresets.includes(item)) return;
        const settings = data.settings(PSP.captureSettings());
        if (!persist(userPresets.map(preset => preset.id === item.id ? { ...item, settings } : preset))) return;
        PSP.setPresetIdentity(item.id, item.name);
        libraryChanged();
        PSP.notify(`Updated “${item.name}” from the current sound.`);
    });
    $('presets-delete').addEventListener('click', () => {
        const item = selected();
        if (!item || !userPresets.includes(item)) return;
        $('preset-delete-name').textContent = `Delete “${item.name}”? Tracks will keep their current sound settings.`;
        $('preset-delete-dialog').dataset.presetId = item.id;
        $('preset-delete-dialog').showModal();
    });
    $('preset-delete-cancel').addEventListener('click', () => $('preset-delete-dialog').close());
    $('preset-delete-confirm').addEventListener('click', () => {
        const id = $('preset-delete-dialog').dataset.presetId;
        if (!persist(userPresets.filter(item => item.id !== id))) return;
        $('preset-delete-dialog').close();
        libraryChanged();
        $('presets-search').focus();
        PSP.notify('Preset deleted. Track settings were preserved.');
    });
    $('presets-apply').addEventListener('click', () => applyPreset(selected()));
    $('presets-apply-all').addEventListener('click', () => applyPreset(selected(), true));
    $('presets-search').addEventListener('input', refresh);
    $('presets-filter').addEventListener('change', refresh);
    $('presets-export').addEventListener('click', () => { const item = selected(); if (item) download([item], item.name); });
    $('presets-export-all').addEventListener('click', () => download(userPresets, 'My presets'));
    $('presets-import').addEventListener('click', () => $('presets-upload').click());
    $('presets-upload').addEventListener('change', async event => {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;
        try {
            if (file.size > 1024 * 1024) throw new Error('Choose a preset file smaller than 1 MB.');
            const incoming = data.parse(await file.text());
            const result = data.merge(userPresets, incoming, builtins);
            if (result.added && !persist(result.presets)) return;
            libraryChanged(result.presets.at(-1)?.id);
            $('presets-import-result').textContent = `Imported ${result.added}. Skipped ${result.skipped} identical presets. Renamed ${result.renamed} to keep existing names.`;
        } catch (error) {
            $('presets-import-result').textContent = `Import failed. ${error.message} Your library was not changed.`;
        }
    });
    $('reset-effects').addEventListener('click', () => preview ? previewPreset(builtins[0]) : applyPreset(builtins[0]));
    $('preset-preview-apply').addEventListener('click', () => commitPreview());
    $('preset-preview-undo').addEventListener('click', () => {
        if (busy()) return;
        cancelPreview();
        PSP.notify('Preview undone. Your previous sound settings are restored.');
    });
    new ResizeObserver(() => {
        document.documentElement.style.setProperty('--preset-preview-height', `${$('preset-preview').getBoundingClientRect().height}px`);
    }).observe($('preset-preview'));
    PSP.presets = { sync, committedSettings, settingsForTrack, hasPreview: () => Boolean(preview), resetPreview: () => { preview = null; } };
    refresh();
})();
