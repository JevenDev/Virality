(() => {
    const PSP = window.PSP;
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
