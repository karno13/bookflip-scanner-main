// Runs due identification jobs after a restart and at a bounded cadence.
// A single process never overlaps two batches. Retry scheduling and expired
// lease reclamation remain the responsibility of IdentificationWorker.
export function createIdentificationScheduler({
 runBatch,
 onResult=()=>{},
 onError=()=>{},
 intervalMs=30_000,
 setIntervalFn=setInterval,
 clearIntervalFn=clearInterval,
}={}){
 if(typeof runBatch!=='function')throw Error('SCHEDULER_RUN_REQUIRED');
 if(!Number.isSafeInteger(intervalMs)||intervalMs<1_000||intervalMs>3_600_000)throw Error('INVALID_SCHEDULER_INTERVAL');
 let timer=null,active=null,stopped=false;
 const tick=()=>{
  if(stopped||active)return active||Promise.resolve(null);
  active=Promise.resolve().then(runBatch).then(result=>{
   onResult(result);
   return result;
  }).catch(error=>{
   try{onError(error)}catch{}
   return null;
  }).finally(()=>{active=null});
  return active;
 };
 return{
  start(){
   if(stopped)throw Error('SCHEDULER_STOPPED');
   if(timer!==null)return;
   timer=setIntervalFn(()=>{void tick()},intervalMs);
   if(typeof timer?.unref==='function')timer.unref();
   void tick();
  },
  tick,
  async stop(){
   stopped=true;
   if(timer!==null){clearIntervalFn(timer);timer=null;}
   if(active)await active;
  }
 };
}
