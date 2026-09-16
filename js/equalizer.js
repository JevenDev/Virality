(() => {
    const PSP = (window.PSP = window.PSP || {});
    const $ = id => document.getElementById(id);
    const frequencies = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    const labels = ['31', '63', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
    const state = { enabled: true, gains: frequencies.map(() => 0), preamp: 0 };
    const presets = [
        { name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        { name: 'Bass boost', gains: [5, 5, 3, 1, 0, 0, 0, 0, 0, 0] },
        { name: 'Vocals', gains: [-3, -2, -1, 0, 1, 3, 4, 2, 0, -1] },
        { name: 'Bright', gains: [-1, -1, 0, 0, 0, 1, 2, 3, 4, 3] },
        { name: 'Warm', gains: [2, 3, 2, 1, 0, 0, -1, -2, -3, -3] }
    ];
    let presetName = 'Flat';
    let responseContext, responseFilters;
    const sampleFrequencies = new Float32Array(240);
    const magnitude = new Float32Array(240);
    const phase = new Float32Array(240);
    const formatDb = value => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
    const filterFrequency = (frequency, sampleRate) => Math.min(frequency, sampleRate * .45);

    function createChain(context, settings) {
        const input = new Tone.Gain({ context, gain: settings.enabled ? 10 ** (settings.preamp / 20) : 1 });
        const filters = frequencies.map((frequency, index) => new Tone.Filter({
            context, type: 'peaking', frequency: filterFrequency(frequency, context.sampleRate),
            Q: 1.4, gain: settings.enabled ? settings.gains[index] : 0
        }));
        let output = input;
        filters.forEach(filter => { output.connect(filter); output = filter; });
        return {
            input, output,
            update(settings) {
                input.gain.rampTo(settings.enabled ? 10 ** (settings.preamp / 20) : 1, .03);
                filters.forEach((filter, index) => filter.gain.rampTo(settings.enabled ? settings.gains[index] : 0, .03));
            },
            dispose() { input.dispose(); filters.forEach(filter => filter.dispose()); }
        };
    }
    PSP.eq = {
        defaults: () => ({ enabled: true, gains: frequencies.map(() => 0), preamp: 0, preset: 'Flat' }),
        snapshot: () => ({ ...state, gains: [...state.gains], preset: presetName }),
        restore(settings) {
            state.enabled = settings.enabled;
            state.gains = [...settings.gains];
            state.preamp = settings.preamp;
            presetName = settings.preset;
            render();
        },
        createChain
    };

    function frequencyResponse(includePreamp = true) {
        const sampleRate = PSP.context?.sampleRate || 48000;
        if (!responseContext || responseContext.sampleRate !== sampleRate) {
            responseContext = new OfflineAudioContext(1, 128, sampleRate);
            responseFilters = frequencies.map(frequency => {
                const filter = responseContext.createBiquadFilter();
                filter.type = 'peaking';
                filter.frequency.value = filterFrequency(frequency, sampleRate);
                filter.Q.value = 1.4;
                return filter;
            });
            for (let i = 0; i < sampleFrequencies.length; i++) sampleFrequencies[i] = 20 * (Math.min(20000, sampleRate * .49) / 20) ** (i / (sampleFrequencies.length - 1));
        }
        const response = new Float32Array(sampleFrequencies.length).fill(includePreamp ? state.preamp : 0);
        responseFilters.forEach((filter, index) => {
            filter.gain.value = state.gains[index];
            filter.getFrequencyResponse(sampleFrequencies, magnitude, phase);
            for (let i = 0; i < response.length; i++) response[i] += 20 * Math.log10(Math.max(magnitude[i], .000001));
        });
        return response;
    }
    function autoGain() {
        const peak = Math.max(...frequencyResponse(false));
        state.preamp = Math.max(-24, Math.min(0, -Math.ceil(peak * 2) / 2));
    }
    function render() {
        $('eq-enabled').setAttribute('aria-pressed', String(state.enabled));
        $('eq-enabled').textContent = state.enabled ? 'EQ on' : 'Bypassed';
        $('equalizer').classList.toggle('eq-bypassed', !state.enabled);
        $('eq-preset-name').textContent = presetName;
        document.querySelectorAll('[data-eq-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.eqPreset === presetName)));
        frequencies.forEach((frequency, index) => {
            const slider = $(`eq-band-${index}`);
            slider.value = state.gains[index];
            slider.setAttribute('aria-valuetext', formatDb(state.gains[index]));
            $(`eq-value-${index}`).textContent = formatDb(state.gains[index]);
        });
        $('eq-preamp').value = state.preamp;
        $('eq-preamp').setAttribute('aria-valuetext', formatDb(state.preamp));
        $('eq-preamp').style.setProperty('--fill', `${(state.preamp + 24) / 30 * 100}%`);
        $('eq-preamp-value').textContent = formatDb(state.preamp);
        const response = frequencyResponse();
        const path = Array.from(response, (gain, i) => `${i ? 'L' : 'M'}${(i / (response.length - 1) * 900).toFixed(2)},${(120 - Math.max(-24, Math.min(24, state.enabled ? gain : 0)) * 5).toFixed(2)}`).join(' ');
        $('eq-curve').setAttribute('d', path);
        $('eq-graph').setAttribute('aria-label', state.enabled ? `Equalizer response, ${presetName}, preamp ${formatDb(state.preamp)}` : 'Equalizer bypassed, flat response');
        $('eq-headroom').textContent = !state.enabled ? 'Bypassed for playback and export.' : Math.max(...response) > .2 ? 'Boosts can clip. Use Auto gain for more headroom.' : 'Applied to playback and exports.';
    }
    function apply() {
        PSP.processing?.update(PSP.captureSettings());
        PSP.saveCurrentSettings();
        render();
    }
    const bands = document.createDocumentFragment();
    frequencies.forEach((frequency, index) => {
        const band = document.createElement('div');
        band.className = 'eq-band';
        const output = document.createElement('output');
        output.id = `eq-value-${index}`;
        output.htmlFor = `eq-band-${index}`;
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = `eq-band-${index}`;
        slider.min = -12;
        slider.max = 12;
        slider.step = .5;
        slider.value = 0;
        slider.setAttribute('aria-label', `${frequency} Hz gain`);
        slider.setAttribute('aria-orientation', 'vertical');
        slider.addEventListener('input', () => {
            state.gains[index] = Number(slider.value);
            presetName = 'Custom';
            apply();
        });
        slider.addEventListener('dblclick', () => { state.gains[index] = 0; presetName = 'Custom'; apply(); });
        const label = document.createElement('label');
        label.htmlFor = slider.id;
        label.textContent = labels[index];
        band.append(output, slider, label);
        bands.append(band);
    });
    $('eq-bands').append(bands);
    presets.forEach(preset => {
        const button = document.createElement('button');
        button.className = 'btn';
        button.textContent = preset.name;
        button.dataset.eqPreset = preset.name;
        button.addEventListener('click', () => {
            state.gains = [...preset.gains];
            presetName = preset.name;
            autoGain();
            apply();
        });
        $('eq-presets').append(button);
    });
    $('eq-preamp').addEventListener('input', event => { state.preamp = Number(event.target.value); apply(); });
    $('eq-auto-gain').addEventListener('click', () => { autoGain(); apply(); });
    $('eq-enabled').addEventListener('click', () => { state.enabled = !state.enabled; apply(); });
    $('eq-reset').addEventListener('click', () => {
        state.gains.fill(0);
        state.preamp = 0;
        state.enabled = true;
        presetName = 'Flat';
        apply();
    });
    document.addEventListener('playbackchange', render);
    render();
})();
