(() => {
    const PSP = window.PSP;
    const $ = id => document.getElementById(id);
    const undo = [], redo = [];
    let baseline = new Map(), suspended = false, gesture = null;
    const clone = settings => structuredClone(settings);
    const same = (a, b) => PSP.presetData.fingerprint(a) === PSP.presetData.fingerprint(b);
    const currentTrack = () => PSP.playlist[PSP.currentIndex] ?? null;
    const available = () => !PSP.isLoading && !PSP.isExporting && !PSP.isSessionBusy && !PSP.presets?.hasPreview();
    const exists = target => target ? PSP.playlist.includes(target) : PSP.currentIndex < 0;
    function snapshot() {
        const result = new Map(PSP.playlist.map(track => [track, clone(track.settings)]));
        result.set(currentTrack(), PSP.committedSettings());
        return result;
    }
    function remember(target, settings) { baseline.set(target, clone(settings)); }
    function prune(stack) {
        for (let index = stack.length - 1; index >= 0; index--) {
            stack[index].changes = stack[index].changes.filter(change => exists(change.target));
            if (!stack[index].changes.length) stack.splice(index, 1);
        }
    }
    function sync() {
        prune(undo);
        prune(redo);
        for (const target of baseline.keys()) if (target && !PSP.playlist.includes(target)) baseline.delete(target);
        for (const [target, settings] of snapshot()) if (!baseline.has(target)) remember(target, settings);
        $('history-undo').disabled = !available() || !undo.length;
        $('history-redo').disabled = !available() || !redo.length;
        const blocked = PSP.presets?.hasPreview() ? 'Apply or undo the preset preview first' : '';
        $('history-undo').title = blocked || (undo.length ? `Undo ${undo.at(-1).label} (Ctrl+Z)` : 'No sound changes to undo');
        $('history-redo').title = blocked || (redo.length ? `Redo ${redo.at(-1).label} (Ctrl+Shift+Z)` : 'No sound changes to redo');
    }
    function push(changes, label) {
        if (!changes.length) return;
        undo.push({ changes, label });
        if (undo.length > 100) undo.shift();
        redo.length = 0;
    }
    function record() {
        if (suspended) return;
        const target = currentTrack(), after = PSP.committedSettings(), before = baseline.get(target);
        remember(target, after);
        if (!before || same(before, after)) { sync(); return; }
        const label = gesture?.label || 'sound settings';
        if (gesture?.entry && undo.at(-1) === gesture.entry && gesture.entry.changes[0].target === target) {
            gesture.entry.changes[0].after = clone(after);
            if (same(gesture.entry.changes[0].before, after)) {
                undo.pop();
                gesture.entry = null;
            }
        } else {
            push([{ target, before: clone(before), after: clone(after) }], label);
            if (gesture) gesture.entry = undo.at(-1);
        }
        sync();
    }
    function transaction(label, action) {
        gesture = null;
        const before = new Map([...baseline].map(([target, settings]) => [target, clone(settings)]));
        suspended = true;
        try { action(); }
        finally {
            suspended = false;
            const after = snapshot();
            const changes = [];
            for (const [target, settings] of after) {
                if (before.has(target) && !same(before.get(target), settings)) {
                    changes.push({ target, before: before.get(target), after: clone(settings) });
                }
                remember(target, settings);
            }
            push(changes, label);
            sync();
        }
    }
    function move(from, to, direction) {
        if (!available()) return;
        gesture = null;
        prune(from);
        const entry = from.pop();
        if (!entry) return;
        suspended = true;
        try {
            for (const change of entry.changes) {
                const settings = clone(direction === 'undo' ? change.before : change.after);
                if (change.target) change.target.settings = settings;
                if (change.target === currentTrack()) PSP.applySettings(settings);
                remember(change.target, settings);
            }
            to.push(entry);
            PSP.renderList();
        } finally { suspended = false; sync(); }
        PSP.notify(`${direction === 'undo' ? 'Undid' : 'Redid'} ${entry.label}.`);
    }
    function reset() {
        undo.length = 0;
        redo.length = 0;
        gesture = null;
        baseline = snapshot();
        sync();
    }
    document.addEventListener('input', event => {
        if (event.target.type !== 'range') return;
        if (gesture?.control !== event.target) gesture = { control: event.target, label: event.target.labels?.[0]?.textContent || 'sound settings', entry: null };
    }, true);
    for (const type of ['change', 'click', 'focusout']) document.addEventListener(type, () => { gesture = null; }, true);
    document.addEventListener('keydown', event => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey || document.querySelector('dialog[open]') ||
            event.target.closest('input:not([type="range"]), textarea, select, [contenteditable="true"]')) return;
        const key = event.key.toLowerCase();
        if (key !== 'z' && key !== 'y') return;
        event.preventDefault();
        if (key === 'y' || event.shiftKey) move(redo, undo, 'redo');
        else move(undo, redo, 'undo');
    });
    $('history-undo').addEventListener('click', () => move(undo, redo, 'undo'));
    $('history-redo').addEventListener('click', () => move(redo, undo, 'redo'));
    PSP.history = { record, remember, transaction, reset, sync };
    reset();
})();
