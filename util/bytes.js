export function prettyBytes(n){
  if (Math.abs(n) < 1024) return n + " B";
  const u = ["KB","MB","GB","TB"];
  let i = -1;
  do { n /= 1024; ++i; } while (Math.abs(n) >= 1024 && i < u.length - 1);
  return n.toFixed(1) + " " + u[i];
}
