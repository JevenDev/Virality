export function audioBufferToWav(abuf){
  const numCh = abuf.numberOfChannels;
  const len = abuf.length * numCh * 2 + 44;
  const buf = new ArrayBuffer(len);
  const view = new DataView(buf);
  const w = (o,s)=>{ for (let i=0;i<s.length;i++) view.setUint8(o+i, s.charCodeAt(i)); };

  w(0,"RIFF");
  view.setUint32(4, 36 + abuf.length * numCh * 2, true);
  w(8,"WAVE");
  w(12,"fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, abuf.sampleRate, true);
  view.setUint32(28, abuf.sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  w(36,"data");
  view.setUint32(40, abuf.length * numCh * 2, true);

  let off = 44;
  const chans = Array.from({length:numCh}, (_,c)=> abuf.getChannelData(c));
  for (let i=0;i<abuf.length;i++){
    for (let ch=0; ch<numCh; ch++){
      let s = Math.max(-1, Math.min(1, chans[ch][i]));
      s = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(off, s, true);
      off += 2;
    }
  }
  return new Blob([view], {type: "audio/wav"});
}

export function floatTo16BitPCM(f32){
  const out = new Int16Array(f32.length);
  for (let i=0;i<f32.length;i++){
    let s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return out;
}
