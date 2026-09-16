(() => {
    // 48 kHz K-weighting and 4x true-peak FIR from ITU-R BS.1770-4, Annexes 1 and 2
    const phases = [
        [.001708984375, .010986328125, -.0196533203125, .033203125, -.0594482421875, .1373291015625, .97216796875, -.102294921875, .047607421875, -.026611328125, .014892578125, -.00830078125],
        [-.0291748046875, .029296875, -.0517578125, .089111328125, -.16650390625, .465087890625, .77978515625, -.2003173828125, .1015625, -.0582275390625, .0330810546875, -.0189208984375],
        [-.0189208984375, .0330810546875, -.0582275390625, .1015625, -.2003173828125, .77978515625, .465087890625, -.16650390625, .089111328125, -.0517578125, .029296875, -.0291748046875],
        [-.00830078125, .014892578125, -.026611328125, .047607421875, -.102294921875, .97216796875, .1373291015625, -.0594482421875, .033203125, -.0196533203125, .010986328125, .001708984375]
    ];
    const loudness = energy => energy > 0 ? -.691 + 10 * Math.log10(energy) : -Infinity;
    const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    function gated(values, relative) {
        const absolute = values.filter(value => loudness(value) > -70);
        const threshold = loudness(average(absolute)) - relative;
        return absolute.filter(value => loudness(value) > threshold);
    }
    function percentile(values, fraction) {
        return values[Math.max(0, Math.round(values.length * fraction) - 1)];
    }
    function analyze(channels, sampleRate, progress = () => {}) {
        if (sampleRate !== 48000) throw new Error('Analysis requires audio decoded at 48 kHz.');
        if (!channels.length || channels.length > 2) throw new Error('Choose a mono or stereo file.');
        const length = channels[0].length;
        if (!length || channels.some(channel => channel.length !== length)) throw new Error('The audio contains no valid samples.');
        const hop = 4800;
        const energies = new Float64Array(Math.floor(length / hop));
        let samplePeak = 0, truePeak = 0;
        channels.forEach((samples, channel) => {
            let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
            let sum = 0;
            for (let i = 0; i < length + 11; i++) {
                const x = i < length ? samples[i] : 0;
                if (!Number.isFinite(x)) throw new Error('The audio contains invalid sample values.');
                samplePeak = Math.max(samplePeak, Math.abs(x));
                for (const phase of phases) {
                    let value = 0;
                    for (let tap = 0; tap < 12; tap++) {
                        const index = i - tap;
                        if (index >= 0 && index < length) value += samples[index] * phase[tap];
                    }
                    truePeak = Math.max(truePeak, Math.abs(value));
                }
                if (i >= length) continue;
                const y = 1.53512485958697 * x - 2.69169618940638 * x1 + 1.19839281085285 * x2
                    + 1.69065929318241 * y1 - .73248077421585 * y2;
                const z = y - 2 * y1 + y2 + 1.99004745483398 * z1 - .99007225036621 * z2;
                x2 = x1; x1 = x; y2 = y1; y1 = y; z2 = z1; z1 = z;
                sum += z * z;
                if ((i + 1) % hop === 0) {
                    energies[Math.floor(i / hop)] += sum / hop;
                    sum = 0;
                }
                if (i % 48000 === 0) progress((channel + i / length) / channels.length * 100);
            }
        });
        const momentary = [], shortTerm = [], blocks = [], shortBlocks = [];
        let maxMomentary = -Infinity, maxShortTerm = -Infinity;
        for (let end = 4; end <= energies.length; end++) {
            let energy = 0;
            for (let i = end - 4; i < end; i++) energy += energies[i] / 4;
            blocks.push(energy);
            const m = loudness(energy);
            maxMomentary = Math.max(maxMomentary, m);
            momentary.push({ time: end / 10, value: m });
            if (end >= 30) {
                let shortEnergy = 0;
                for (let i = end - 30; i < end; i++) shortEnergy += energies[i] / 30;
                shortBlocks.push(shortEnergy);
                const s = loudness(shortEnergy);
                maxShortTerm = Math.max(maxShortTerm, s);
                shortTerm.push({ time: end / 10, value: s });
            }
        }
        // LRA uses its own -20 LU gate and the 10th to 95th percentile range
        const distribution = gated(shortBlocks, 20).map(loudness).sort((a, b) => a - b);
        progress(100);
        return {
            duration: length / sampleRate, channels: channels.length, sampleRate,
            integrated: blocks.length ? loudness(average(gated(blocks, 10))) : null,
            lra: distribution.length >= 2 ? percentile(distribution, .95) - percentile(distribution, .1) : null,
            truePeak: 20 * Math.log10(Math.max(samplePeak, truePeak)),
            samplePeak: 20 * Math.log10(samplePeak),
            maxMomentary: momentary.length ? maxMomentary : null,
            maxShortTerm: shortTerm.length ? maxShortTerm : null,
            momentary, shortTerm
        };
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { analyze };
    else self.onmessage = event => {
        try {
            const result = analyze(event.data.channels, event.data.sampleRate, percent => self.postMessage({ percent }));
            self.postMessage({ result });
        } catch (error) {
            self.postMessage({ error: error.message });
        }
    };
})();
