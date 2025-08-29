const KEY = 'sr_user_presets_v1';

export function loadUserPresets(){
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function saveUserPresets(list){
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

export function addUserPreset(preset){
  const list = loadUserPresets();
  // de-dupe by name (replace)
  const i = list.findIndex(p => p.name === preset.name);
  if (i >= 0) list[i] = preset; else list.push(preset);
  saveUserPresets(list);
  return list;
}

export function removeUserPreset(name){
  const list = loadUserPresets().filter(p => p.name !== name);
  saveUserPresets(list);
  return list;
}
