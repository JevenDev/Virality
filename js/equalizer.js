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
    function responseAt(frequency, response) {
        const position = Math.log(frequency / sampleFrequencies[0]) / Math.log(sampleFrequencies.at(-1) / sampleFrequencies[0]) * (response.length - 1);
        const before = Math.floor(position);
        const after = Math.min(response.length - 1, before + 1);
        const amount = position - before;
        return response[before] * (1 - amount) + response[after] * amount;
    }
    function autoGain() {
        const peak = Math.max(...frequencyResponse(false));
        state.preamp = Math.max(-24, Math.min(0, -Math.ceil(peak * 2) / 2));
    }
    const bandX = frequency => Math.log(frequency / 20) / Math.log(1000) * 900;
    const graphHandleScale = () => {
        const { width, height } = $('eq-graph').getBoundingClientRect();
        return width && height ? height * 900 / (width * 240) : 1;
    };
    function render() {
        $('eq-enabled').setAttribute('aria-pressed', String(state.enabled));
        $('eq-enabled').textContent = state.enabled ? 'EQ on' : 'Bypassed';
        $('equalizer').classList.toggle('eq-bypassed', !state.enabled);
        $('eq-preset-name').textContent = presetName;
        document.querySelectorAll('[data-eq-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.eqPreset === presetName)));
        const response = frequencyResponse();
        frequencies.forEach((frequency, index) => {
            const slider = $(`eq-band-${index}`);
            slider.value = state.gains[index];
            slider.setAttribute('aria-valuetext', formatDb(state.gains[index]));
            $(`eq-value-${index}`).textContent = formatDb(state.gains[index]);
            const handle = $(`eq-graph-band-${index}`);
            if (handle) {
                const graphGain = Math.max(-24, Math.min(24, responseAt(frequency, response)));
                handle.setAttribute('transform', `translate(${bandX(frequency).toFixed(2)} ${(120 - graphGain * 5).toFixed(2)}) scale(${graphHandleScale().toFixed(4)} 1)`);
                handle.setAttribute('aria-valuenow', state.gains[index]);
                handle.setAttribute('aria-valuetext', formatDb(state.gains[index]));
                handle.classList.toggle('graph-handle-active', state.gains[index] !== 0);
            }
        });
        $('eq-preamp').value = state.preamp;
        $('eq-preamp').setAttribute('aria-valuetext', formatDb(state.preamp));
        $('eq-preamp').style.setProperty('--fill', `${(state.preamp + 24) / 30 * 100}%`);
        $('eq-preamp-value').textContent = formatDb(state.preamp);
        const path = Array.from(response, (gain, i) => `${i ? 'L' : 'M'}${(i / (response.length - 1) * 900).toFixed(2)},${(120 - Math.max(-24, Math.min(24, gain)) * 5).toFixed(2)}`).join(' ');
        $('eq-curve').setAttribute('d', path);
        $('eq-graph').setAttribute('aria-label', `${state.enabled ? 'Equalizer response' : 'Equalizer bypassed, configured response'}, ${presetName}, preamp ${formatDb(state.preamp)}`);
        $('eq-headroom').textContent = !state.enabled ? 'Bypassed for playback and export.' : Math.max(...response) > .2 ? 'Boosts can clip. Use Auto gain for more headroom.' : 'Applied to playback and exports.';
    }
    function apply() {
        PSP.processing?.update(PSP.captureSettings());
        PSP.saveCurrentSettings();
        render();
    }
    function setBand(index, gain) {
        const next = Math.max(-12, Math.min(12, Math.round(gain * 2) / 2));
        if (next === state.gains[index]) return;
        state.gains[index] = next;
        presetName = 'Custom';
        apply();
    }
    function beginGesture(control, index) {
        document.dispatchEvent(new CustomEvent('soundgesturestart', { detail: { control, label: `EQ ${labels[index]} band` } }));
    }
    function endGesture() { document.dispatchEvent(new Event('soundgestureend')); }
    const graph = $('eq-graph');
    const graphHandles = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    graphHandles.classList.add('eq-graph-handles');
    frequencies.forEach((frequency, index) => {
        const control = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        control.id = `eq-graph-band-${index}`;
        control.classList.add('graph-control');
        control.dataset.eqBand = index;
        control.setAttribute('tabindex', '0');
        control.setAttribute('role', 'slider');
        control.setAttribute('aria-label', `${frequency} Hz gain`);
        control.setAttribute('aria-valuemin', '-12');
        control.setAttribute('aria-valuemax', '12');
        control.setAttribute('aria-orientation', 'vertical');
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        hit.classList.add('graph-handle-hit');
        hit.setAttribute('r', '18');
        const point = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        point.classList.add('graph-handle');
        point.setAttribute('r', '7');
        control.append(hit, point);
        graphHandles.append(control);
    });
    graph.append(graphHandles);
    const graphPoint = event => {
        const rect = graph.getBoundingClientRect();
        return { x: (event.clientX - rect.left) / rect.width * 900, y: (event.clientY - rect.top) / rect.height * 240 };
    };
    const nearestBand = x => frequencies.reduce((nearest, frequency, index) =>
        Math.abs(bandX(frequency) - x) < Math.abs(bandX(frequencies[nearest]) - x) ? index : nearest, 0);
    let draggedBand = null, dragOrigin = null, dragFromHandle = false, dragMoved = false;
    function updateGraphBand(event) {
        const { y } = graphPoint(event);
        const targetResponse = (120 - y) / 5;
        const currentResponse = responseAt(frequencies[draggedBand], frequencyResponse());
        setBand(draggedBand, state.gains[draggedBand] + targetResponse - currentResponse);
    }
    graph.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        const selected = event.target.closest('[data-eq-band]');
        dragOrigin = { x: event.clientX, y: event.clientY };
        dragFromHandle = Boolean(selected);
        dragMoved = false;
        draggedBand = selected ? Number(selected.dataset.eqBand) : nearestBand(graphPoint(event).x);
        const control = $(`eq-graph-band-${draggedBand}`);
        beginGesture(control, draggedBand);
        graph.setPointerCapture(event.pointerId);
        if (!dragFromHandle) updateGraphBand(event);
    });
    graph.addEventListener('pointermove', event => {
        if (draggedBand === null) return;
        if (Math.hypot(event.clientX - dragOrigin.x, event.clientY - dragOrigin.y) >= 2) dragMoved = true;
        if (dragMoved) updateGraphBand(event);
    });
    function stopGraphDrag(event) {
        if (draggedBand === null) return;
        if (event.type === 'pointerup' && (!dragFromHandle || dragMoved)) updateGraphBand(event);
        const control = $(`eq-graph-band-${draggedBand}`);
        draggedBand = null;
        dragOrigin = null;
        if (graph.hasPointerCapture(event.pointerId)) graph.releasePointerCapture(event.pointerId);
        endGesture();
        control.focus({ preventScroll: true });
    }
    graph.addEventListener('pointerup', stopGraphDrag);
    graph.addEventListener('pointercancel', stopGraphDrag);
    graph.addEventListener('keydown', event => {
        const control = event.target.closest('[data-eq-band]');
        if (!control) return;
        const index = Number(control.dataset.eqBand);
        const changes = { ArrowUp: .5, ArrowRight: .5, ArrowDown: -.5, ArrowLeft: -.5, PageUp: 2, PageDown: -2 };
        let value = changes[event.key] === undefined ? null : state.gains[index] + changes[event.key];
        if (event.key === 'Home') value = -12;
        if (event.key === 'End') value = 12;
        if (event.key === '0') value = 0;
        if (value === null) return;
        event.preventDefault();
        beginGesture(control, index);
        setBand(index, value);
        endGesture();
    });
    graph.addEventListener('dblclick', event => {
        event.preventDefault();
        const selected = event.target.closest('[data-eq-band]');
        const index = selected ? Number(selected.dataset.eqBand) : nearestBand(graphPoint(event).x);
        const control = $(`eq-graph-band-${index}`);
        beginGesture(control, index);
        setBand(index, 0);
        endGesture();
    });
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
    new ResizeObserver(render).observe(graph);
    render();
})();
