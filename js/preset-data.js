(() => {
    const PSP = (window.PSP = window.PSP || {});
    const format = 'virality-presets';
    const version = 1;
    const limit = 500;
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    function object(value, keys, label) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
        const unknown = Object.keys(value).find(key => !keys.includes(key));
        if (unknown) throw new Error(`${label} contains an unsupported field: ${unknown}.`);
        return value;
    }
    function number(value, min, max, label, step) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
            throw new Error(`${label} must be between ${min} and ${max}.`);
        }
        if (step && Math.abs((value - min) / step - Math.round((value - min) / step)) > 1e-7) {
            throw new Error(`${label} must use increments of ${step}.`);
        }
        return value;
    }
    function text(value, max, label, required = true) {
        if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
            throw new Error(`${label} must be ${required ? '1' : '0'}–${max} characters.`);
        }
        return value.trim();
    }
    function enabled(value, label) {
        if (typeof value !== 'boolean') throw new Error(`${label} must be on or bypassed.`);
        return value;
    }
    function settings(value) {
        object(value, ['speed', 'mix', 'decay', 'eq', 'distortion', 'delay', 'preset', 'presetId'], 'Sound settings');
        const eq = object(value.eq, ['enabled', 'gains', 'preamp', 'preset'], 'Equalizer');
        const distortion = object(value.distortion, ['enabled', 'drive', 'tone', 'output', 'mix', 'preset'], 'Distortion');
        const delay = object(value.delay, ['enabled', 'time', 'feedback', 'mix', 'preset'], 'Delay');
        if (!Array.isArray(eq.gains) || eq.gains.length !== 10) throw new Error('Equalizer must contain 10 bands.');
        return {
            speed: number(value.speed, .5, 1.5, 'Speed', .01),
            mix: number(value.mix, 0, 1, 'Reverb mix', .01),
            decay: number(value.decay, .5, 10, 'Reverb decay', .1),
            eq: {
                enabled: enabled(eq.enabled, 'Equalizer'),
                gains: eq.gains.map(gain => number(gain, -12, 12, 'EQ gain', .5)),
                preamp: number(eq.preamp, -24, 6, 'EQ preamp', .5),
                preset: text(eq.preset, 80, 'EQ preset')
            },
            distortion: {
                enabled: enabled(distortion.enabled, 'Distortion'),
                drive: number(distortion.drive, 0, 36, 'Distortion drive', .5),
                tone: number(distortion.tone, 500, 16000, 'Distortion tone'),
                output: number(distortion.output, -24, 0, 'Distortion output', .5),
                mix: number(distortion.mix, 0, 1, 'Distortion mix', .01),
                preset: text(distortion.preset, 80, 'Distortion preset')
            },
            delay: {
                enabled: enabled(delay.enabled, 'Delay'),
                time: number(delay.time, .02, 1, 'Delay time', .001),
                feedback: number(delay.feedback, 0, .8, 'Delay feedback', .01),
                mix: number(delay.mix, 0, 1, 'Delay mix', .01),
                preset: text(delay.preset, 80, 'Delay preset')
            }
        };
    }
    function fingerprint(value) {
        const sound = settings(value);
        for (const effect of ['eq', 'distortion', 'delay']) delete sound[effect].preset;
        return JSON.stringify(sound);
    }
    function preset(value) {
        object(value, ['id', 'name', 'description', 'settings'], 'Preset');
        return {
            id: text(value.id, 100, 'Preset ID'),
            name: text(value.name, 80, 'Preset name'),
            description: text(value.description ?? '', 240, 'Description', false),
            settings: settings(value.settings)
        };
    }
    function parse(source) {
        let value;
        try { value = JSON.parse(source); }
        catch { throw new Error('This file is not valid JSON. Choose an exported Virality preset file.'); }
        object(value, ['format', 'version', 'presets'], 'Preset file');
        if (value.format !== format) throw new Error('This is not a Virality preset file.');
        if (value.version !== version) throw new Error('This preset version is not supported. Update Virality before importing it.');
        if (!Array.isArray(value.presets) || value.presets.length > limit) throw new Error(`A file can contain at most ${limit} presets.`);
        const result = value.presets.map((value, index) => {
            try { return preset(value); }
            catch (error) { throw new Error(`Preset ${index + 1}: ${error.message}`); }
        });
        if (new Set(result.map(item => item.id)).size !== result.length) throw new Error('The file contains duplicate preset IDs.');
        return result;
    }
    function serialize(presets) {
        if (presets.length > limit) throw new Error(`Your library can contain at most ${limit} presets.`);
        return JSON.stringify({ format, version, presets: presets.map(preset) }, null, 2);
    }
    function uniqueName(name, presets) {
        const used = new Set(presets.map(item => item.name.toLocaleLowerCase()));
        let result = name, suffix = 2;
        while (used.has(result.toLocaleLowerCase())) {
            const ending = ` (${suffix++})`;
            result = name.slice(0, 80 - ending.length) + ending;
        }
        return result;
    }
    function merge(existing, incoming, builtins = []) {
        const presets = [...existing];
        let skipped = 0, renamed = 0;
        for (const item of incoming) {
            if (presets.some(saved => saved.name === item.name && saved.description === item.description && fingerprint(saved.settings) === fingerprint(item.settings))) {
                skipped++;
                continue;
            }
            const name = uniqueName(item.name, [...builtins, ...presets]);
            if (name !== item.name) renamed++;
            presets.push({ ...item, id: `user_${crypto.randomUUID()}`, name, settings: settings(item.settings) });
        }
        if (presets.length > limit) throw new Error(`Your library can contain at most ${limit} presets. Export a backup before removing any.`);
        return { presets, added: presets.length - existing.length, skipped, renamed };
    }
    function migrate(source, defaults) {
        const saved = JSON.parse(source);
        if (!Array.isArray(saved)) throw new Error('Saved presets are not a list.');
        let skipped = 0;
        const presets = [];
        for (const item of saved) {
            if (!item || typeof item.name !== 'string' || !item.name.trim() || !item.values ||
                !['speed', 'mix', 'decay'].every(key => own(item.values, key) && Number.isFinite(Number(item.values[key])))) {
                skipped++;
                continue;
            }
            const clamp = (value, min, max, scale) => Math.round(Math.max(min, Math.min(max, Number(value))) * scale) / scale;
            const id = typeof item.id === 'string' && item.id.startsWith('user_') && item.id.length <= 100 && !presets.some(saved => saved.id === item.id)
                ? item.id : `user_${crypto.randomUUID()}`;
            presets.push({
                id, name: uniqueName(item.name.trim().slice(0, 24), presets), description: '',
                settings: settings({
                    ...defaults, speed: clamp(item.values.speed, .5, 1.5, 100),
                    mix: clamp(item.values.mix, 0, 1, 100), decay: clamp(item.values.decay, .5, 10, 10)
                })
            });
        }
        return { presets, skipped };
    }
    function builtins(defaults) {
        return [
            ['default', 'Default', 'Original speed with a flat EQ and no added effects.', 1, 0, 2],
            ['slowed', 'Slowed', 'Lower pitch, slower playback, and a long reverb.', .82, .45, 4.2],
            ['nightcore', 'Nightcore', 'Faster playback and higher pitch with light reverb.', 1.25, .12, 2],
            ['faded', 'Faded', 'A gentle slowdown with a softer reverb.', .9, .25, 2],
            ['perfect', 'Perfect!', 'A small speed lift with a touch of reverb.', 1.1, .1, 2]
        ].map(([id, name, description, speed, mix, decay]) => ({
            id, name, description, settings: settings({ ...defaults, speed, mix, decay })
        }));
    }
    PSP.presetData = { settings, fingerprint, parse, serialize, uniqueName, merge, migrate, builtins };
})();
