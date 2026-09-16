(() => {
    const $ = id => document.getElementById(id);
    const colors = ['start', 'middle', 'end', 'field', 'surface', 'popup', 'dock', 'drop', 'cursor'];
    const presetStorageKey = 'virality_background_presets_v1';
    const activeStorageKey = 'virality_background_active_v1';
    const builtins = [
        {
            id: 'psp-blue', name: 'PSP blue', settings: {
                mode: 'gradient', angle: 155, start: '#071f65', middle: '#0c48a5', end: '#168bcc',
                field: '#174e91', surface: '#092956', popup: '#0b3777', dock: '#082b6a', drop: '#07358d', cursor: '#ffffff'
            }
        },
        {
            id: 'midnight', name: 'Midnight', settings: {
                mode: 'gradient', angle: 145, start: '#090d1f', middle: '#171c3e', end: '#34305c',
                field: '#202850', surface: '#11162f', popup: '#1a2040', dock: '#0c1128', drop: '#151b3d', cursor: '#c9d4ff'
            }
        },
        {
            id: 'interstellar', name: 'Interstellar', settings: {
                mode: 'gradient', angle: 155, start: '#0040ff', middle: '#000000', end: '#171717',
                field: '#171717', surface: '#171717', popup: '#171717', dock: '#171717', drop: '#171717', cursor: '#f1f3f4'
            }
        },
        {
            id: 'aubergine', name: 'Aubergine', settings: {
                mode: 'gradient', angle: 150, start: '#211326', middle: '#452342', end: '#7b405c',
                field: '#562b51', surface: '#2d1832', popup: '#3a2040', dock: '#25142a', drop: '#452342', cursor: '#ffd7e7'
            }
        },
        {
            id: 'forest', name: 'Forest', settings: {
                mode: 'gradient', angle: 160, start: '#0d211b', middle: '#164637', end: '#38745e',
                field: '#1d5847', surface: '#102d25', popup: '#173c31', dock: '#0d271f', drop: '#164637', cursor: '#d6f5e3'
            }
        },
        {
            id: 'graphite', name: 'Graphite', settings: {
                mode: 'single', angle: 155, start: '#202124', middle: '#202124', end: '#202124',
                field: '#35363a', surface: '#292a2d', popup: '#303134', dock: '#26272a', drop: '#303134', cursor: '#f1f3f4'
            }
        }
    ];
    let writable = true;
    let userPresets = [];
    let settings = structuredClone(builtins[0].settings);
    let selectedId = builtins[0].id;

    function normalize(value) {
        if (!value || typeof value !== 'object' || !['single', 'gradient'].includes(value.mode)) throw new Error('A background style is missing or invalid.');
        if (!Number.isInteger(value.angle) || value.angle < 0 || value.angle > 360) throw new Error('A gradient angle is invalid.');
        const normalized = { mode: value.mode, angle: value.angle };
        for (const key of colors) {
            if (typeof value[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(value[key])) throw new Error(`The ${key} color is invalid.`);
            normalized[key] = value[key].toLowerCase();
        }
        return normalized;
    }
    function fingerprint(value) {
        return JSON.stringify(normalize(value));
    }
    function allPresets() {
        return [...builtins, ...userPresets];
    }
    function selectedPreset() {
        return userPresets.find(preset => preset.id === selectedId);
    }
    function setStatus(message) {
        $('background-status').textContent = message;
    }
    function loadLibrary() {
        try {
            const saved = localStorage.getItem(presetStorageKey);
            if (!saved) return [];
            const value = JSON.parse(saved);
            if (!Array.isArray(value) || value.length > 100) throw new Error('Saved color presets are invalid.');
            return value.map(item => {
                if (!item || typeof item.id !== 'string' || !item.id.startsWith('user_') || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) {
                    throw new Error('A saved color preset is invalid.');
                }
                return { id: item.id, name: item.name.trim(), settings: normalize(item.settings) };
            });
        } catch (error) {
            writable = false;
            setStatus(`Saved color presets could not be loaded. ${error.message}`);
            return [];
        }
    }
    function loadActive() {
        try {
            const saved = localStorage.getItem(activeStorageKey);
            if (!saved) return;
            const value = JSON.parse(saved);
            settings = normalize(value.settings);
            selectedId = typeof value.selectedId === 'string' && allPresets().some(preset => preset.id === value.selectedId) ? value.selectedId : '';
        } catch (error) {
            setStatus(`The last background could not be restored. ${error.message}`);
        }
    }
    function persistLibrary(next) {
        if (!writable) {
            setStatus('Browser storage is unavailable. Existing colors still work for this tab.');
            return false;
        }
        try {
            localStorage.setItem(presetStorageKey, JSON.stringify(next));
            userPresets = next;
            return true;
        } catch (error) {
            setStatus(`Could not save color presets. ${error.message}`);
            return false;
        }
    }
    function persistActive() {
        if (!writable) return;
        try { localStorage.setItem(activeStorageKey, JSON.stringify({ selectedId, settings })); }
        catch (error) {
            writable = false;
            setStatus(`Could not save the active background. ${error.message}`);
        }
    }
    function apply() {
        const root = document.documentElement;
        const background = settings.mode === 'single'
            ? settings.start
            : `linear-gradient(${settings.angle}deg, ${settings.start} 0%, ${settings.middle} 48%, ${settings.end} 100%)`;
        root.style.setProperty('--page-background', background);
        root.style.setProperty('--page-color', settings.start);
        for (const key of ['field', 'surface', 'popup', 'dock', 'drop', 'cursor']) root.style.setProperty(`--${key}-bg`, settings[key]);
        document.querySelector('meta[name="theme-color"]').content = settings.start;
    }
    function syncInputs() {
        $('background-mode').value = settings.mode;
        $('background-angle').value = settings.angle;
        $('background-angle').nextElementSibling.value = `${settings.angle}°`;
        for (const key of colors) {
            const input = $(`background-${key}`);
            input.value = settings[key];
            input.nextElementSibling.value = settings[key].toUpperCase();
        }
        document.querySelectorAll('.gradient-only').forEach(element => {
            element.hidden = settings.mode === 'single';
            element.querySelectorAll('input').forEach(input => { input.disabled = settings.mode === 'single'; });
        });
        $('background-preset-select').value = selectedId;
        $('background-delete').disabled = !selectedPreset() || !writable;
        $('background-save').disabled = !writable;
        $('background-import').disabled = !writable;
        $('background-export').disabled = !userPresets.length;
    }
    function renderPresets() {
        const custom = new Option('Custom colors', '');
        const builtinGroup = document.createElement('optgroup');
        builtinGroup.label = 'Built-in';
        for (const preset of builtins) builtinGroup.append(new Option(preset.name, preset.id));
        const userGroup = document.createElement('optgroup');
        userGroup.label = 'My presets';
        for (const preset of userPresets) userGroup.append(new Option(preset.name, preset.id));
        $('background-preset-select').replaceChildren(custom, builtinGroup, userGroup);
        syncInputs();
    }
    function update(next, id = '') {
        settings = normalize(next);
        selectedId = id;
        apply();
        persistActive();
        syncInputs();
    }
    function uniqueName(name, collection) {
        let candidate = name, suffix = 2;
        while (collection.some(item => item.name.toLocaleLowerCase() === candidate.toLocaleLowerCase())) candidate = `${name} ${suffix++}`;
        return candidate;
    }
    function parseImport(text) {
        const value = JSON.parse(text);
        if (!value || value.format !== 'virality-background-presets' || value.version !== 1 || !Array.isArray(value.presets) || value.presets.length > 100) {
            throw new Error('Choose a Virality background preset file.');
        }
        return value.presets.map(item => {
            if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) throw new Error('An imported preset name is invalid.');
            return { name: item.name.trim(), settings: normalize(item.settings) };
        });
    }
    function download() {
        const payload = { format: 'virality-background-presets', version: 1, presets: userPresets.map(({ name, settings: presetSettings }) => ({ name, settings: presetSettings })) };
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'Virality background presets.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    userPresets = loadLibrary();
    loadActive();
    renderPresets();
    apply();

    $('background-mode').addEventListener('change', event => update({ ...settings, mode: event.target.value }));
    $('background-angle').addEventListener('input', event => update({ ...settings, angle: Number(event.target.value) }));
    document.querySelectorAll('[data-background-color]').forEach(input => input.addEventListener('input', event => {
        update({ ...settings, [event.target.dataset.backgroundColor]: event.target.value });
    }));
    $('background-preset-select').addEventListener('change', event => {
        const preset = allPresets().find(item => item.id === event.target.value);
        if (preset) update(structuredClone(preset.settings), preset.id);
    });
    $('background-reset').addEventListener('click', () => {
        update(structuredClone(builtins[0].settings), builtins[0].id);
        setStatus('Restored the original Virality colors.');
    });
    $('background-save').addEventListener('click', () => {
        const input = $('background-preset-name');
        const name = input.value.trim();
        const duplicate = allPresets().some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
        input.setCustomValidity(!name ? 'Enter a preset name.' : duplicate ? 'A preset already uses this name.' : '');
        if (!input.reportValidity()) return;
        const preset = { id: `user_${crypto.randomUUID()}`, name, settings: structuredClone(settings) };
        if (!persistLibrary([...userPresets, preset])) return;
        input.value = '';
        selectedId = preset.id;
        persistActive();
        renderPresets();
        setStatus(`Saved “${name}”.`);
    });
    $('background-preset-name').addEventListener('input', event => event.target.setCustomValidity(''));
    $('background-delete').addEventListener('click', () => {
        const preset = selectedPreset();
        if (!preset || !persistLibrary(userPresets.filter(item => item.id !== preset.id))) return;
        selectedId = '';
        persistActive();
        renderPresets();
        setStatus(`Deleted “${preset.name}”. Current colors were kept.`);
    });
    $('background-export').addEventListener('click', download);
    $('background-import').addEventListener('click', () => $('background-upload').click());
    $('background-upload').addEventListener('change', async event => {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;
        try {
            if (file.size > 1024 * 1024) throw new Error('Choose a preset file smaller than 1 MB.');
            const incoming = parseImport(await file.text());
            const next = [...userPresets];
            let added = 0, skipped = 0, renamed = 0;
            for (const item of incoming) {
                if (next.some(existing => fingerprint(existing.settings) === fingerprint(item.settings))) {
                    skipped++;
                    continue;
                }
                const name = uniqueName(item.name, [...builtins, ...next]);
                if (name !== item.name) renamed++;
                next.push({ id: `user_${crypto.randomUUID()}`, name, settings: item.settings });
                added++;
            }
            if (added && !persistLibrary(next)) return;
            renderPresets();
            setStatus(`Imported ${added}. Skipped ${skipped} identical presets. Renamed ${renamed}.`);
        } catch (error) {
            setStatus(`Import failed. ${error.message} Your presets were not changed.`);
        }
    });
})();
