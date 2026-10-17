export function appendProcessEvent(events,event){
 if(event.status==='progress'&&event.progressKey){
  const index=events.findIndex(item=>item.jobId===event.jobId&&item.operation===event.operation&&item.status==='progress'&&item.progressKey===event.progressKey);
  if(index>=0){const next=[...events];next[index]=event;return next;}
 }
 return [...events,event].slice(-1200);
}
