let playReqId = 0;
export function newSession(){
  playReqId += 1;
  return playReqId;
}
export function currentSession(){
  return playReqId;
}
export function isCurrent(reqId){
  return reqId === playReqId;
}
