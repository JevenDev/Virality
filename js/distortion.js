(() => {
    const PSP = (window.PSP = window.PSP || {});
    const $ = id => document.getElementById(id);
    const defaults = () => ({ enabled: false, drive: 12, tone: 8000, output: -9, mix: .5, preset: 'Off' });
    const state = defaults();
    const presets = [
        { preset: 'Warm', drive: 6, tone: 6500, output: -6, mix: .35 },
        { preset: 'Crunch', drive: 18, tone: 4500, output: -9, mix: .7 },
        { preset: 'Fuzz', drive: 30, tone: 2400, output: -12, mix: 1 }
    ];
    const shaperInputRange = 64;
    const gain = db => 10 ** (db / 20);
    const formatDb = db => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
    const toneFrequency = (frequency, context) => Math.min(frequency, context.sampleRate * .45);
    const graphInput = .1;
    const graphX = 264;
    const graphHandleScale = () => {
        const { width, height } = $('distortion-graph').getBoundingClientRect();
        return width && height ? height * 480 / (width * 280) : 1;
    };

    function createChain(context, settings) {
        const amount = settings.enabled ? settings.mix : 0;
        const input = new Tone.Gain({ context, gain: 1 });
        const output = new Tone.Gain({ context, gain: 1 });
        const dry = new Tone.Gain({ context, gain: 1 - amount });
        const drive = new Tone.Gain({ context, gain: gain(settings.drive) / shaperInputRange });
        const shaper = new Tone.WaveShaper({ context, length: 8193, mapping: value => Math.tanh(value * shaperInputRange), oversample: '4x' });
        const tone = new Tone.Filter({ context, type: 'lowpass', frequency: toneFrequency(settings.tone, context), Q: Math.SQRT1_2, rolloff: -12 });
        const wet = new Tone.Gain({ context, gain: amount * gain(settings.output) });
        input.connect(dry);
        dry.connect(output);
        input.connect(drive);
        drive.connect(shaper);
        shaper.connect(tone);
        tone.connect(wet);
        wet.connect(output);
        return {
            input, output,
            update(next, immediate = false) {
                const amount = next.enabled ? next.mix : 0;
                const set = (param, value) => {
                    if (immediate) { param.cancelScheduledValues(0); param.value = value; }
                    else param.rampTo(value, .03);
                };
                set(drive.gain, gain(next.drive) / shaperInputRange);
                set(tone.frequency, toneFrequency(next.tone, context));
                set(dry.gain, 1 - amount);
                set(wet.gain, amount * gain(next.output));
            },
            dispose() { [input, output, dry, drive, shaper, tone, wet].forEach(node => node.dispose()); }
        };
    }
    PSP.distortion = {
        defaults,
        snapshot: () => ({ ...state }),
        restore(settings) { Object.assign(state, settings); render(); },
        createChain
    };

    function render() {
        $('distortion-enabled').setAttribute('aria-pressed', String(state.enabled));
        $('distortion-enabled').textContent = state.enabled ? 'Distortion on' : 'Bypassed';
        $('distortion').classList.toggle('distortion-bypassed', !state.enabled || state.mix === 0);
        $('distortion-preset-name').textContent = state.preset;
        document.querySelectorAll('[data-distortion-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.distortionPreset === state.preset)));
        const values = { drive: state.drive, tone: Math.log(state.tone / 500) / Math.log(32) * 100, output: state.output, mix: state.mix * 100 };
        const labels = { drive: formatDb(state.drive), tone: state.tone >= 1000 ? `${(state.tone / 1000).toFixed(1)} kHz` : `${Math.round(state.tone)} Hz`, output: formatDb(state.output), mix: `${Math.round(state.mix * 100)}%` };
        Object.entries(values).forEach(([key, value]) => {
            const slider = $(`distortion-${key}`);
            slider.value = value;
            slider.setAttribute('aria-valuetext', labels[key]);
            slider.style.setProperty('--fill', `${(value - Number(slider.min)) / (Number(slider.max) - Number(slider.min)) * 100}%`);
            $(`distortion-${key}-value`).textContent = labels[key];
        });
        const curve = Array.from({ length: 241 }, (_, i) => {
            const input = i / 120 - 1;
            return `${i ? 'L' : 'M'}${i * 2},${(140 - Math.tanh(input * gain(state.drive)) * 140).toFixed(2)}`;
        }).join(' ');
        $('distortion-curve').setAttribute('d', curve);
        const handle = $('distortion-drive-handle');
        if (handle) {
            handle.setAttribute('transform', `translate(${graphX} ${(140 - Math.tanh(graphInput * gain(state.drive)) * 140).toFixed(2)}) scale(${graphHandleScale().toFixed(4)} 1)`);
            handle.setAttribute('aria-valuenow', state.drive);
            handle.setAttribute('aria-valuetext', formatDb(state.drive));
            handle.classList.toggle('graph-handle-active', state.drive !== defaults().drive);
        }
        $('distortion-graph').setAttribute('aria-label', `Soft clipping curve at ${formatDb(state.drive)} drive, before tone, output and mix${state.enabled ? '' : ', bypassed'}`);
        $('distortion-status').textContent = !state.enabled ? 'Bypassed for playback and export.' : state.mix === 0 ? 'Mix is dry. Increase it to hear distortion.' : 'Applied to playback and exports.';
    }
    function apply() {
        PSP.processing?.update(PSP.captureSettings());
        PSP.saveCurrentSettings();
        render();
    }
    function setDrive(value) {
        const next = Math.max(0, Math.min(36, Math.round(value * 2) / 2));
        if (next === state.drive) return;
        state.drive = next;
        state.preset = 'Custom';
        apply();
    }
    const graph = $('distortion-graph');
    const driveHandle = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    driveHandle.id = 'distortion-drive-handle';
    driveHandle.classList.add('graph-control', 'distortion-graph-handle');
    driveHandle.setAttribute('tabindex', '0');
    driveHandle.setAttribute('role', 'slider');
    driveHandle.setAttribute('aria-label', 'Distortion drive');
    driveHandle.setAttribute('aria-valuemin', '0');
    driveHandle.setAttribute('aria-valuemax', '36');
    driveHandle.setAttribute('aria-orientation', 'vertical');
    const driveHit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    driveHit.classList.add('graph-handle-hit');
    driveHit.setAttribute('r', '18');
    const drivePoint = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    drivePoint.classList.add('graph-handle');
    drivePoint.setAttribute('r', '7');
    driveHandle.append(driveHit, drivePoint);
    graph.append(driveHandle);
    const beginGesture = () => document.dispatchEvent(new CustomEvent('soundgesturestart', { detail: { control: driveHandle, label: 'distortion drive' } }));
    const endGesture = () => document.dispatchEvent(new Event('soundgestureend'));
    function driveFromPointer(event) {
        const rect = graph.getBoundingClientRect();
        const y = (event.clientY - rect.top) / rect.height * 280;
        const minimum = Math.tanh(graphInput);
        const maximum = Math.tanh(graphInput * gain(36));
        const output = Math.max(minimum, Math.min(maximum, (140 - y) / 140));
        setDrive(20 * Math.log10(Math.atanh(output) / graphInput));
    }
    let draggingDrive = false, driveOrigin = null, driveFromHandle = false, driveMoved = false;
    graph.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        draggingDrive = true;
        driveOrigin = { x: event.clientX, y: event.clientY };
        driveFromHandle = Boolean(event.target.closest('#distortion-drive-handle'));
        driveMoved = false;
        beginGesture();
        graph.setPointerCapture(event.pointerId);
        if (!driveFromHandle) driveFromPointer(event);
    });
    graph.addEventListener('pointermove', event => {
        if (!draggingDrive) return;
        if (Math.hypot(event.clientX - driveOrigin.x, event.clientY - driveOrigin.y) >= 2) driveMoved = true;
        if (driveMoved) driveFromPointer(event);
    });
    function stopDriveDrag(event) {
        if (!draggingDrive) return;
        if (event.type === 'pointerup' && (!driveFromHandle || driveMoved)) driveFromPointer(event);
        draggingDrive = false;
        driveOrigin = null;
        if (graph.hasPointerCapture(event.pointerId)) graph.releasePointerCapture(event.pointerId);
        endGesture();
        driveHandle.focus({ preventScroll: true });
    }
    graph.addEventListener('pointerup', stopDriveDrag);
    graph.addEventListener('pointercancel', stopDriveDrag);
    driveHandle.addEventListener('keydown', event => {
        const changes = { ArrowUp: .5, ArrowRight: .5, ArrowDown: -.5, ArrowLeft: -.5, PageUp: 3, PageDown: -3 };
        let value = changes[event.key] === undefined ? null : state.drive + changes[event.key];
        if (event.key === 'Home') value = 0;
        if (event.key === 'End') value = 36;
        if (value === null) return;
        event.preventDefault();
        beginGesture();
        setDrive(value);
        endGesture();
    });
    graph.addEventListener('dblclick', event => {
        event.preventDefault();
        beginGesture();
        setDrive(defaults().drive);
        endGesture();
    });
    ['drive', 'tone', 'output', 'mix'].forEach(key => {
        $(`distortion-${key}`).addEventListener('input', event => {
            const value = Number(event.target.value);
            state[key] = key === 'tone' ? 500 * 32 ** (value / 100) : key === 'mix' ? value / 100 : value;
            state.preset = 'Custom';
            apply();
        });
    });
    presets.forEach(preset => {
        const button = document.createElement('button');
        button.className = 'btn';
        button.textContent = preset.preset;
        button.dataset.distortionPreset = preset.preset;
        button.addEventListener('click', () => { Object.assign(state, preset, { enabled: true }); apply(); });
        $('distortion-presets').append(button);
    });
    $('distortion-enabled').addEventListener('click', () => {
        state.enabled = !state.enabled;
        if (state.preset === 'Off') state.preset = 'Custom';
        apply();
    });
    $('distortion-reset').addEventListener('click', () => { Object.assign(state, defaults()); apply(); });
    new ResizeObserver(render).observe(graph);
    render();
})();
