export const AUDIO_EXT = new Set([".mp3",".wav",".m4a",".aac",".flac",".ogg",".oga",".opus",".webm",".wma",".aiff",".aif",".caf"]);

export function readFileAsArrayBuffer(file){
  return new Promise((res, rej)=>{
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}

export function isAudioLike(f){
  if (!f) return false;
  if (f.type && f.type.startsWith("audio/")) return true;
  const name = (f.name || "").toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  return AUDIO_EXT.has(ext);
}
