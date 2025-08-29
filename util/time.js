export function secondsToClock(s){
  s = Math.max(0, s|0);
  const m = (s/60|0);
  const ss = (s % 60).toString().padStart(2, "0");
  return `${m}:${ss}`;
}
