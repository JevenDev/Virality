export function generateImpulseResponse(ctx, duration=3, decay=3){
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * Math.max(0.1, duration)));
  const imp = ctx.createBuffer(2, len, rate);
  for (let ch=0; ch<2; ch++){
    const d = imp.getChannelData(ch);
    for (let i=0; i<len; i++){
      d[i] = (Math.random()*2 - 1) * Math.pow(1 - i/len, decay);
    }
  }
  return imp;
}
