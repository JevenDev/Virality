import { progressWrap, progressBar, progressText } from './elements.js';

export function showProgress(text='Working…'){
  if (!progressWrap) return;
  progressText.textContent = text;
  progressBar.style.width = '0%';
  progressWrap.classList.remove('hidden');
}
export function hideProgress(){
  if (!progressWrap) return;
  progressWrap.classList.add('hidden');
}
export function setProgress(frac, text){
  if (!progressWrap) return;
  const pct = Math.max(0, Math.min(1, frac)) * 100;
  progressBar.style.width = pct + '%';
  if (text) progressText.textContent = text;
}
