(() => {
    const PSP = window.PSP;
    const magic = new TextEncoder().encode('VIRALITY_SESSION\n');
    const maxHeader = 4 * 1024 * 1024;
    const pages = ['music', 'presets', 'backgrounds', 'equalizer', 'delay', 'distortion', 'compressor', 'loudness'];
    function number(value, min, max, label, integer = false) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) {
            throw new Error(`Invalid ${label} in this session.`);
        }
        return value;
    }
    function text(value, max, label) {
        if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label} in this session.`);
        return value;
    }
    function settings(value) {
        const sound = PSP.presetData.settings(value);
        return {
            ...sound, preset: text(value.preset, 160, 'preset name'),
            presetId: value.presetId === null ? null : text(value.presetId, 100, 'preset ID')
        };
    }
    function manifest(value) {
        if (!value || value.format !== 'virality-session') throw new Error('This is not a Virality session.');
        if (value.version !== 1) throw new Error('This session version is not supported. Update Virality before opening it.');
        if (!Array.isArray(value.tracks) || value.tracks.length > 1000) throw new Error('Sessions support up to 1,000 tracks.');
        const tracks = value.tracks.map(track => {
            if (!track || typeof track !== 'object') throw new Error('Invalid track in this session.');
            if (typeof track.type !== 'string' || track.type.length > 128) throw new Error('Invalid audio type in this session.');
            return {
                name: text(track.name, 255, 'track name'),
                size: number(track.size, 1, Number.MAX_SAFE_INTEGER, 'audio size', true),
                modified: number(track.modified, 0, Number.MAX_SAFE_INTEGER, 'file date', true),
                type: track.type,
                settings: settings(track.settings)
            };
        });
        const currentIndex = number(value.currentIndex, -1, tracks.length - 1, 'selected track', true);
        if (typeof value.repeat !== 'boolean') throw new Error('Invalid repeat setting in this session.');
        if (!value.export || !['wav', 'mp3'].includes(value.export.format) || ![128, 160, 192, 256, 320].includes(value.export.bitrate)) {
            throw new Error('Invalid export settings in this session.');
        }
        if (!pages.includes(value.page)) throw new Error('Invalid tool page in this session.');
        return {
            format: 'virality-session', version: 1, tracks, currentIndex,
            editorSettings: settings(value.editorSettings),
            position: number(value.position, 0, Number.MAX_SAFE_INTEGER, 'playback position'),
            volume: number(value.volume, 0, 100, 'preview volume', true),
            repeat: value.repeat, export: { format: value.export.format, bitrate: value.export.bitrate }, page: value.page
        };
    }
    function pack(value, audio) {
        const normalized = manifest(value);
        if (audio.length !== normalized.tracks.length || audio.some((blob, i) => !(blob instanceof Blob) || blob.size !== normalized.tracks[i].size)) {
            throw new Error('The session audio does not match its track list.');
        }
        const header = new TextEncoder().encode(JSON.stringify(normalized));
        if (header.length > maxHeader) throw new Error('This session contains too much track metadata.');
        const length = new Uint8Array(4);
        new DataView(length.buffer).setUint32(0, header.length, true);
        return new Blob([magic, length, header, ...audio], { type: 'application/octet-stream' });
    }
    async function unpack(file) {
        const prefixSize = magic.length + 4;
        if (file.size < prefixSize) throw new Error('This session file is incomplete.');
        const prefix = new Uint8Array(await file.slice(0, prefixSize).arrayBuffer());
        if (!magic.every((byte, index) => prefix[index] === byte)) throw new Error('Choose a .virality session file.');
        const headerSize = new DataView(prefix.buffer).getUint32(magic.length, true);
        if (!headerSize || headerSize > maxHeader || prefixSize + headerSize > file.size) throw new Error('This session has an invalid header.');
        let value;
        try { value = JSON.parse(await file.slice(prefixSize, prefixSize + headerSize).text()); }
        catch { throw new Error('This session has unreadable settings.'); }
        const normalized = manifest(value);
        let offset = prefixSize + headerSize;
        const audio = normalized.tracks.map(track => {
            const end = offset + track.size;
            if (!Number.isSafeInteger(end) || end > file.size) throw new Error('Audio is missing or truncated in this session.');
            const blob = file.slice(offset, end, track.type);
            offset = end;
            return blob;
        });
        if (offset !== file.size) throw new Error('This session contains unexpected extra data.');
        return { manifest: normalized, audio };
    }
    PSP.sessionData = { manifest, pack, unpack };
})();
