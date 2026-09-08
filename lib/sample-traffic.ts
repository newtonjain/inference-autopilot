import data from './sample-traffic-data';
import type { WorkloadConfig } from './fleet-engine';
export const SAMPLE_PHASES = ['overnight', 'prefix', 'surge', 'mixed'] as const;
export type SamplePhase = typeof SAMPLE_PHASES[number];
export const SAMPLE_LABELS: Record<SamplePhase,string> = {overnight:'Overnight · consolidation',prefix:'Shared-prefix peak · latency',surge:'Qwen surge · capacity',mixed:'Mixed interactive traffic'};
export function sampleTraffic(phase: string) {
  if (!SAMPLE_PHASES.includes(phase as SamplePhase)) throw Error('Unknown sample traffic phase.');
  const rows=data.windows.filter(w=>w.phase===phase);
  const requests=rows.reduce((n,w)=>n+w.offeredRps*w.durationSeconds,0);
  const duration=rows.reduce((n,w)=>n+w.durationSeconds,0);
  const weighted=(key:'inputTokens'|'outputTokens'|'sharedPrefix'|'burstiness')=>rows.reduce((n,w)=>n+w[key]*w.offeredRps*w.durationSeconds,0)/requests;
  const workload:WorkloadConfig={rps:requests/duration,inputTokens:weighted('inputTokens'),outputTokens:weighted('outputTokens'),sharedPrefix:weighted('sharedPrefix'),burstiness:weighted('burstiness'),concurrency:128,ttftTargetMs:800,tokenTargetMs:70,mix:{...rows[0].mix}};
  const hourly=Array.from({length:48},(_,i)=>{
    const hour=data.windows.slice(i*12,(i+1)*12);
    return {hour:i,phase:hour[0].phase,meanRps:hour.reduce((n,w)=>n+w.offeredRps,0)/12,peakRps:Math.max(...hour.map(w=>w.offeredRps)),inputTokens:hour[0].inputTokens,outputTokens:hour[0].outputTokens,sharedPrefix:hour[0].sharedPrefix,burstiness:hour[0].burstiness,mix:hour[0].mix};
  });
  return {workload,history:{source:'synthetic' as const,datasetId:data.id,startTime:data.startTime,endTime:data.endTime,intervalSeconds:data.intervalSeconds,windowCount:data.windows.length,selectedPhase:phase,selectedHours:duration/3600,selectedRequests:Math.round(requests),hourly,limitation:'Generated workload, not customer observations. Candidate metrics are 90-second representative-phase replays, not a continuous 48-hour simulation. Two days cannot establish weekly or monthly seasonality.'}};
}
export type SampleHistory = ReturnType<typeof sampleTraffic>['history'];
