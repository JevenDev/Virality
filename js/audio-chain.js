(() => {
    const PSP = window.PSP;
    const pitchProcessorURL = new URL('./vendor/SignalsmithStretch.js', document.currentScript.src).href;
    function createPitch(context, settings) {
        const input = new Tone.Gain({ context });
        const output = new Tone.Gain({ context });
        const dry = new Tone.Gain({ context });
        const wet = new Tone.Gain({ context, gain: 0 });
        input.connect(dry);
        dry.connect(output);
        wet.connect(output);
        let node, silence, ready, scheduled, disposed = false, pitch = settings.pitch ?? 0, nodePitch;
        function route(immediate) {
            const shifted = node && pitch !== 0 ? 1 : 0;
            if (node && nodePitch !== pitch) {
                nodePitch = pitch;
                scheduled = node.schedule({ active: true, semitones: pitch, output: context.immediate() });
            }
            if (immediate) {
                dry.gain.value = 1 - shifted;
                wet.gain.value = shifted;
            } else {
                dry.gain.rampTo(1 - shifted, .015);
                wet.gain.rampTo(shifted, .015);
            }
        }
        function prepare() {
            if (ready || pitch === 0) return;
            ready = Promise.resolve().then(() => {
                if (!window.SignalsmithStretch) throw new Error('The pitch engine could not load. Reload the page to try again.');
                SignalsmithStretch.moduleUrl = pitchProcessorURL;
                return SignalsmithStretch(context.rawContext, {
                    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2]
                });
            }).then(async created => {
                if (disposed) { created.disconnect(); created.port.close(); return; }
                node = created;
                node.onprocessorerror = () => PSP.notify('Pitch processing stopped. Reload the page to try again.');
                // keep feeding silence so buffered audio drains after the source stops
                silence = context.createConstantSource();
                silence.offset.value = 0;
                silence.connect(node);
                silence.start(0);
                input.connect(node);
                Tone.connect(node, wet);
                route(true);
                await scheduled;
            });
            ready.catch(error => {
                ready = null;
                console.error('Pitch processing initialization failed:', error);
                if (!disposed) PSP.notify(window.isSecureContext
                    ? `Could not start pitch processing: ${error.message}`
                    : 'Pitch processing requires HTTPS or localhost. Open Virality using a secure address.');
            });
        }
        prepare();
        return {
            input, output,
            get ready() { return Promise.all([ready, scheduled]); },
            update(next, immediate = false) {
                pitch = next.pitch ?? 0;
                prepare();
                route(immediate);
            },
            dispose() {
                disposed = true;
                if (silence) { silence.stop(); silence.disconnect(); }
                if (node) { node.disconnect(); node.port.close(); }
                input.dispose(); output.dispose(); dry.dispose(); wet.dispose();
            }
        };
    }
    function createReverb(context, settings) {
        const node = new Tone.Reverb({ context, decay: settings.decay, wet: settings.mix });
        let decayTimer;
        return {
            input: node, output: node,
            get ready() { return node.ready; },
            update(next, immediate = false) {
                node.wet.rampTo(next.mix, .03);
                clearTimeout(decayTimer);
                if (node.decay !== next.decay) {
                    const regenerate = () => {
                        node.decay = next.decay;
                        node.ready.catch(() => PSP.notify('Could not update reverb. Try a shorter decay.'));
                    };
                    if (immediate) regenerate();
                    else decayTimer = setTimeout(regenerate, 180);
                }
            },
            dispose() { clearTimeout(decayTimer); node.dispose(); }
        };
    }
    PSP.audioEffects = [
        {
            id: 'pitch', page: 'effects', create: createPitch,
            update: (stage, settings, immediate) => stage.update(settings, immediate),
            tail: settings => settings.pitch ? .25 : 0,
            describe: settings => settings.pitch
                ? { label: `Pitch ${settings.pitch > 0 ? '+' : ''}${settings.pitch.toFixed(1)} st`, active: true } : null
        },
        {
            id: 'eq', page: 'equalizer',
            create: (context, settings) => PSP.eq.createChain(context, settings.eq),
            update: (stage, settings) => stage.update(settings.eq),
            describe: settings => settings.eq.preamp || settings.eq.gains.some(gain => gain !== 0)
                ? { label: settings.eq.enabled ? 'Equalizer' : 'EQ bypassed', active: settings.eq.enabled } : null
        },
        {
            id: 'distortion', page: 'distortion',
            create: (context, settings) => PSP.distortion.createChain(context, settings.distortion),
            update: (stage, settings, immediate) => stage.update(settings.distortion, immediate),
            describe: settings => settings.distortion.enabled || settings.distortion.preset !== 'Off'
                ? { label: settings.distortion.enabled && settings.distortion.mix > 0 ? 'Distortion' : 'Distortion bypassed', active: settings.distortion.enabled && settings.distortion.mix > 0 } : null
        },
        {
            id: 'delay', page: 'delay',
            create: (context, settings) => PSP.delay.createChain(context, settings.delay),
            update: (stage, settings, immediate) => stage.update(settings.delay, immediate),
            tail: settings => PSP.delay.tail(settings.delay),
            describe: settings => settings.delay && (settings.delay.enabled || settings.delay.preset !== 'Off')
                ? { label: settings.delay.enabled && settings.delay.mix > 0 ? `Delay ${Math.round(settings.delay.time * 1000)} ms` : 'Delay bypassed', active: settings.delay.enabled && settings.delay.mix > 0 } : null
        },
        {
            id: 'reverb', page: 'effects', create: createReverb,
            update: (stage, settings, immediate) => stage.update(settings, immediate),
            tail: settings => settings.mix > 0 ? settings.decay + .01 : 0,
            describe: settings => settings.mix > 0 ? { label: `Reverb ${Math.round(settings.mix * 100)}%`, active: true } : null
        }
    ];
    PSP.describeEffects = settings => {
        const descriptions = settings.speed !== 1 ? [{ label: `Speed ${settings.speed.toFixed(2)}×`, active: true, page: 'effects' }] : [];
        PSP.audioEffects.forEach(effect => {
            const description = effect.describe(settings);
            if (description) descriptions.push({ ...description, page: effect.page });
        });
        return descriptions;
    };
    PSP.processingTail = settings => PSP.audioEffects.reduce((tail, effect) => tail + (effect.tail?.(settings) || 0), 0);
    PSP.createProcessingChain = (context, settings) => {
        const stages = [];
        try {
            PSP.audioEffects.forEach(effect => stages.push(effect.create(context, settings)));
            for (let index = 1; index < stages.length; index++) stages[index - 1].output.connect(stages[index].input);
        } catch (error) {
            stages.forEach(stage => stage.dispose());
            throw error;
        }
        return {
            input: stages[0].input, output: stages[stages.length - 1].output,
            get ready() { return Promise.all(stages.map(stage => stage.ready)); },
            update(next, { immediate = false } = {}) { stages.forEach((stage, index) => PSP.audioEffects[index].update(stage, next, immediate)); },
            dispose() { stages.forEach(stage => stage.dispose()); }
        };
    };
})();
