(() => {
    const PSP = (window.PSP = window.PSP || {});
    const $ = id => document.getElementById(id);
    const defaults = () => ({ enabled: false, time: .3, feedback: .35, mix: .3, preset: 'Off' });
    const state = defaults();
    const presets = [
        { preset: 'Slapback', time: .09, feedback: 0, mix: .25 },
        { preset: 'Repeats', time: .3, feedback: .35, mix: .3 },
        { preset: 'Space', time: .6, feedback: .6, mix: .4 }
    ];
    const graphHandleScale = () => {
        const { width, height } = $('delay-graph').getBoundingClientRect();
        return width && height ? height * 480 / (width * 260) : 1;
    };
    function tail(settings = defaults()) {
        if (!settings.enabled || settings.mix === 0) return 0;
        // retain repeats until their combined remaining amplitude falls below -60 dB
        const repeats = settings.feedback > 0
            ? Math.max(1, Math.ceil(Math.log(.001 * (1 - settings.feedback) / settings.mix) / Math.log(settings.feedback))) : 1;
        return settings.time * repeats + .01;
    }
    function createChain(context, settings = defaults()) {
        const input = new Tone.Gain({ context, gain: 1 });
        const output = new Tone.Gain({ context, gain: 1 });
        const amount = settings.enabled ? settings.mix : 0;
        const dry = new Tone.Gain({ context, gain: 1 - amount });
        const send = new Tone.Gain({ context, gain: amount > 0 ? 1 : 0 });
        const feedback = new Tone.Gain({ context, gain: amount > 0 ? settings.feedback : 0 });
        const wet = new Tone.Gain({ context, gain: amount });
        let delay, repeats;
        let active = amount > 0;
        function resetDelay(time) {
            send.disconnect();
            feedback.disconnect();
            delay?.dispose();
            repeats?.dispose();
            delay = new Tone.Delay({ context, delayTime: 128 / context.sampleRate, maxDelay: 1 });
            // match the first repeat to the feedback loop's extra rendering quantum
            repeats = new Tone.Delay({ context, delayTime: Math.max(0, time - 128 / context.sampleRate), maxDelay: 1 });
            send.connect(delay);
            delay.connect(repeats);
            feedback.connect(repeats);
            repeats.connect(feedback);
            repeats.connect(wet);
        }
        input.connect(dry);
        dry.connect(output);
        input.connect(send);
        wet.connect(output);
        resetDelay(settings.time);
        return {
            input, output,
            update(next = defaults(), immediate = false) {
                const amount = next.enabled ? next.mix : 0;
                // clear buffered audio on track changes and when leaving bypass
                if (immediate || (amount > 0 && !active)) resetDelay(next.time);
                active = amount > 0;
                const set = (param, value) => {
                    if (immediate) { param.cancelScheduledValues(0); param.value = value; }
                    else param.rampTo(value, .03);
                };
                set(repeats.delayTime, Math.max(0, next.time - 128 / context.sampleRate));
                set(send.gain, active ? 1 : 0);
                set(feedback.gain, active ? next.feedback : 0);
                set(dry.gain, 1 - amount);
                set(wet.gain, amount);
            },
            dispose() { [input, output, dry, send, feedback, wet, delay, repeats].forEach(node => node.dispose()); }
        };
    }
    PSP.delay = {
        defaults,
        snapshot: () => ({ ...state }),
        restore(settings) { Object.assign(state, defaults(), settings); render(); },
        createChain,
        tail
    };
    function render() {
        const active = state.enabled && state.mix > 0;
        $('delay-enabled').setAttribute('aria-pressed', String(state.enabled));
        $('delay-enabled').textContent = state.enabled ? 'Delay on' : 'Bypassed';
        $('delay').classList.toggle('delay-bypassed', !active);
        $('delay-preset-name').textContent = state.preset;
        document.querySelectorAll('[data-delay-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.delayPreset === state.preset)));
        const values = { time: Math.round(state.time * 1000), feedback: Math.round(state.feedback * 100), mix: Math.round(state.mix * 100) };
        Object.entries(values).forEach(([key, value]) => {
            const slider = $(`delay-${key}`);
            const label = `${value}${key === 'time' ? ' ms' : '%'}`;
            slider.value = value;
            slider.setAttribute('aria-valuetext', label);
            slider.style.setProperty('--fill', `${(value - Number(slider.min)) / (Number(slider.max) - Number(slider.min)) * 100}%`);
            $(`delay-${key}-value`).textContent = label;
        });
        const repeats = [];
        for (let i = 1; i * state.time <= 4; i++) {
            const level = state.mix * state.feedback ** (i - 1);
            if (level < .001) break;
            const x = 8 + i * state.time / 4 * 464;
            repeats.push(`M${x.toFixed(2)} 240V${(240 - level * 220).toFixed(2)}`);
        }
        $('delay-dry').setAttribute('d', `M8 240V${240 - (active ? 1 - state.mix : 1) * 220}`);
        $('delay-repeats').setAttribute('d', repeats.join(' '));
        const positions = [
            { x: 8 + state.time / 4 * 464, y: 240 - state.mix * 220 },
            { x: 8 + state.time / 2 * 464, y: 240 - state.mix * state.feedback * 220 }
        ];
        positions.forEach(({ x, y }, index) => {
            const handle = $(`delay-graph-handle-${index + 1}`);
            if (!handle) return;
            handle.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${graphHandleScale().toFixed(4)} 1)`);
            handle.classList.toggle('graph-handle-active', index === 0
                ? state.time !== defaults().time || state.mix !== defaults().mix
                : state.time !== defaults().time || state.feedback !== defaults().feedback);
            handle.setAttribute('aria-label', index === 0
                ? `First repeat, ${values.time} milliseconds and ${values.mix}% mix. Use arrow keys to edit.`
                : `Second repeat, ${values.time} milliseconds and ${values.feedback}% feedback. Use arrow keys to edit.`);
        });
        $('delay-graph').setAttribute('aria-label', `Delay repeats over four seconds, ${values.time} milliseconds apart, ${values.feedback}% feedback and ${values.mix}% mix${active ? '' : ', bypassed'}`);
        $('delay-status').textContent = !state.enabled ? 'Bypassed for playback and export.' : state.mix === 0 ? 'Mix is dry. Increase it to hear delay.' : 'Applied to playback and exports, including the repeat tail.';
    }
    function apply() {
        PSP.processing?.update(PSP.captureSettings());
        PSP.saveCurrentSettings();
        render();
    }
    const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
    function setGraphValues(control, time, amount) {
        const nextTime = Math.round(clamp(time, .02, 1) * 1000) / 1000;
        const nextAmount = Math.round(clamp(amount, 0, control === 'mix' ? 1 : .8) * 100) / 100;
        if (nextTime === state.time && nextAmount === state[control]) return;
        state.time = nextTime;
        state[control] = nextAmount;
        state.preset = 'Custom';
        apply();
    }
    const graph = $('delay-graph');
    const graphHandles = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    graphHandles.classList.add('delay-graph-handles');
    ['mix', 'feedback'].forEach((controlName, index) => {
        const control = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        control.id = `delay-graph-handle-${index + 1}`;
        control.classList.add('graph-control', 'delay-graph-handle');
        control.dataset.delayControl = controlName;
        control.setAttribute('tabindex', '0');
        control.setAttribute('role', 'group');
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
        return { x: (event.clientX - rect.left) / rect.width * 480, y: (event.clientY - rect.top) / rect.height * 260 };
    };
    const beginGesture = (control, label) => document.dispatchEvent(new CustomEvent('soundgesturestart', { detail: { control, label } }));
    const endGesture = () => document.dispatchEvent(new Event('soundgestureend'));
    let draggedControl = null, dragOrigin = null, dragFromHandle = false, dragMoved = false;
    function updateDelayGraph(event) {
        const point = graphPoint(event);
        const repeat = draggedControl === 'mix' ? 1 : 2;
        const time = (point.x - 8) / 464 * 4 / repeat;
        const level = clamp((240 - point.y) / 220, 0, 1);
        const amount = draggedControl === 'mix' ? level : state.mix > .01 ? level / state.mix : level;
        setGraphValues(draggedControl, time, amount);
    }
    graph.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        const selected = event.target.closest('[data-delay-control]');
        dragOrigin = { x: event.clientX, y: event.clientY };
        dragFromHandle = Boolean(selected);
        dragMoved = false;
        if (selected) draggedControl = selected.dataset.delayControl;
        else {
            const point = graphPoint(event);
            const firstX = 8 + state.time / 4 * 464;
            const secondX = 8 + state.time / 2 * 464;
            draggedControl = Math.abs(point.x - firstX) <= Math.abs(point.x - secondX) ? 'mix' : 'feedback';
        }
        const control = graph.querySelector(`[data-delay-control="${draggedControl}"]`);
        beginGesture(control, draggedControl === 'mix' ? 'delay time and mix' : 'delay time and feedback');
        graph.setPointerCapture(event.pointerId);
        if (!dragFromHandle) updateDelayGraph(event);
    });
    graph.addEventListener('pointermove', event => {
        if (!draggedControl) return;
        if (Math.hypot(event.clientX - dragOrigin.x, event.clientY - dragOrigin.y) >= 2) dragMoved = true;
        if (dragMoved) updateDelayGraph(event);
    });
    function stopDelayDrag(event) {
        if (!draggedControl) return;
        if (event.type === 'pointerup' && (!dragFromHandle || dragMoved)) updateDelayGraph(event);
        const control = graph.querySelector(`[data-delay-control="${draggedControl}"]`);
        draggedControl = null;
        dragOrigin = null;
        if (graph.hasPointerCapture(event.pointerId)) graph.releasePointerCapture(event.pointerId);
        endGesture();
        control.focus({ preventScroll: true });
    }
    graph.addEventListener('pointerup', stopDelayDrag);
    graph.addEventListener('pointercancel', stopDelayDrag);
    graph.addEventListener('keydown', event => {
        const control = event.target.closest('[data-delay-control]');
        if (!control) return;
        const controlName = control.dataset.delayControl;
        let time = state.time;
        let amount = state[controlName];
        if (event.key === 'ArrowLeft') time -= .01;
        else if (event.key === 'ArrowRight') time += .01;
        else if (event.key === 'ArrowDown') amount -= .01;
        else if (event.key === 'ArrowUp') amount += .01;
        else if (event.key === 'PageDown') amount -= .1;
        else if (event.key === 'PageUp') amount += .1;
        else if (event.key === 'Home') time = .02;
        else if (event.key === 'End') time = 1;
        else return;
        event.preventDefault();
        beginGesture(control, controlName === 'mix' ? 'delay time and mix' : 'delay time and feedback');
        setGraphValues(controlName, time, amount);
        endGesture();
    });
    ['time', 'feedback', 'mix'].forEach(key => {
        $(`delay-${key}`).addEventListener('input', event => {
            state[key] = Number(event.target.value) / (key === 'time' ? 1000 : 100);
            state.preset = 'Custom';
            apply();
        });
    });
    presets.forEach(preset => {
        const button = document.createElement('button');
        button.className = 'btn';
        button.textContent = preset.preset;
        button.dataset.delayPreset = preset.preset;
        button.addEventListener('click', () => { Object.assign(state, preset, { enabled: true }); apply(); });
        $('delay-presets').append(button);
    });
    $('delay-enabled').addEventListener('click', () => {
        state.enabled = !state.enabled;
        if (state.preset === 'Off') state.preset = 'Custom';
        apply();
    });
    $('delay-reset').addEventListener('click', () => { Object.assign(state, defaults()); apply(); });
    new ResizeObserver(render).observe(graph);
    render();
})();
