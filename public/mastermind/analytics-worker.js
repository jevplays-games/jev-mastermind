import { reconstructReplay } from './rules.js';
import { analyzeMatch,alternativeRows,csvText } from './analytics.js';
self.onmessage=({data})=>{
  try {
    const state=reconstructReplay(data.replay);
    if(data.operation==='alternatives'){self.postMessage({id:data.id,csv:csvText(alternativeRows(state))});return;}
    const report=analyzeMatch(state,data.replay.reveal,{decisions:data.decisions??[],timings:data.timings??[],exhaustive:true});
    self.postMessage({id:data.id,report});
  } catch(error) { self.postMessage({id:data.id,error:error.message}); }
};
