import { floatTo16BitPCM } from './convert.js';

function createMp3WorkerURL(){
  const code = `importScripts('https://cdn.jsdelivr.net/npm/lamejs@1.2.0/lame.min.js');
function encode(L,R,C,S,K,p){
  const E=(self.lamejs&&self.lamejs.Mp3Encoder)||(typeof lamejs!=='undefined'&&lamejs.Mp3Encoder);
  if(!E) throw new Error('lamejs not available in worker');
  const e=new E(C,S,K);
  const B=1152;
  let parts=[];
  const T=L.length;
  for(let i=0;i<T;i+=B){
    const l=L.subarray(i,i+B);
    const r=C>1?R.subarray(i,i+B):l;
    const out=e.encodeBuffer(l,r);
    if(out.length) parts.push(out);
    if((i&0x7FFF)===0) p(Math.min(1,i/T));
  }
  const end=e.flush();
  if(end.length) parts.push(end);
  return new Blob(parts,{type:'audio/mpeg'})
}
self.onmessage=(ev)=>{
  const {type,left,right,channels,sampleRate,kbps}=ev.data||{};
  if(type!=='encode') return;
  try{
    const b=encode(left,right,channels,sampleRate,kbps,(v)=>self.postMessage({type:'progress',value:v}));
    self.postMessage({type:'done',blob:b});
  }catch(err){
    setTimeout(()=>{ throw err; });
  }
}`;
  return URL.createObjectURL(new Blob([code], {type:"application/javascript"}));
}

export function audioBufferToMp3Worker(abuf, kbps=192, onP=()=>{}){
  return new Promise((resolve, reject)=>{
    try{
      const url = createMp3WorkerURL();
      const w = new Worker(url);
      URL.revokeObjectURL(url);

      const ch = abuf.numberOfChannels;
      const sr = abuf.sampleRate;
      const L = floatTo16BitPCM(abuf.getChannelData(0).slice());
      const R = floatTo16BitPCM((ch>1?abuf.getChannelData(1):abuf.getChannelData(0)).slice());

      w.onmessage = (e)=>{
        const m = e.data;
        if (m.type === 'progress') onP(m.value);
        else if (m.type === 'done'){
          w.terminate();
          resolve(m.blob);
        }
      };
      w.onerror = (err)=>{ w.terminate(); reject(err); };
      w.postMessage({type: 'encode', left: L, right: R, channels: ch, sampleRate: sr, kbps: Number(kbps)||192}, [L.buffer, R.buffer]);
    }catch(e){ reject(e); }
  });
}

export function audioBufferToMp3Main(abuf, kbps=192, onP=()=>{}){
  if (!window.lamejs?.Mp3Encoder) throw new Error('lamejs not loaded');
  const ch = abuf.numberOfChannels;
  const sr = abuf.sampleRate;
  const enc = new lamejs.Mp3Encoder(ch, sr, Number(kbps)||192);
  const BS = 1152;
  const parts = [];
  const L = floatTo16BitPCM(abuf.getChannelData(0));
  const R = floatTo16BitPCM((ch>1?abuf.getChannelData(1):abuf.getChannelData(0)));
  const T = L.length;
  for (let i=0;i<T;i+=BS){
    const l = L.subarray(i, i+BS);
    const r = ch>1 ? R.subarray(i, i+BS) : l;
    const out = enc.encodeBuffer(l, r);
    if (out.length) parts.push(out);
    if ((i & 0x7FFF) === 0) onP(Math.min(1, i/T));
  }
  const end = enc.flush();
  if (end.length) parts.push(end);
  return new Blob(parts, {type: 'audio/mpeg'});
}

export async function encodeMp3(abuf, kbps, onP){
  try{
    return await audioBufferToMp3Worker(abuf, kbps, onP);
  }catch(e){
    console.warn('[mp3] worker failed; falling back', e);
    return audioBufferToMp3Main(abuf, kbps, onP);
  }
}
