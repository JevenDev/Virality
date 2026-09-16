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
        $('delay-graph').setAttribute('aria-label', `Delay repeats over four seconds, ${values.time} milliseconds apart, ${values.feedback}% feedback and ${values.mix}% mix${active ? '' : ', bypassed'}`);
        $('delay-status').textContent = !state.enabled ? 'Bypassed for playback and export.' : state.mix === 0 ? 'Mix is dry. Increase it to hear delay.' : 'Applied to playback and exports, including the repeat tail.';
    }
    function apply() {
        PSP.processing?.update(PSP.captureSettings());
        PSP.saveCurrentSettings();
        render();
    }
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
    render();
})();
