export async function collectFilesFromItems(items){
  const out = [];
  const prom = [];
  for (const it of items){
    if (it.kind === "file"){
      const e = it.getAsEntry?.() || it.webkitGetAsEntry?.();
      if (e && e.isDirectory){
        prom.push(walkDirectory(e, out));
      } else {
        const f = it.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  await Promise.all(prom);
  return out;
}

function walkDirectory(dir, out){
  return new Promise((resolve)=>{
    const rd = dir.createReader();
    const read = ()=>{
      rd.readEntries(async(entries)=>{
        if (!entries.length) return resolve();
        for (const ent of entries){
          if (ent.isFile){
            await new Promise(res=> ent.file((f)=>{ out.push(f); res(); }, ()=>res()));
          } else if (ent.isDirectory){
            await walkDirectory(ent, out);
          }
        }
        read();
      }, ()=>resolve());
    };
    read();
  });
}
