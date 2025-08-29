import { state } from './store.js';

export function isItemInQueue(id){
  return state.files.some(f=> f.id === id);
}
