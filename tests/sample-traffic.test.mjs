import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const {sampleTraffic,SAMPLE_PHASES}=require(path.join(process.env.SIM_BUILD_DIR,'sample-traffic.js'));
const {parseWorkload}=require(path.join(process.env.SIM_BUILD_DIR,'analysis-contract.js'));
const {sweepConfiguration}=require(path.join(process.env.SIM_BUILD_DIR,'config-sweep.js'));
const {defaultProfile}=require(path.join(process.env.SIM_BUILD_DIR,'fleet-engine.js'));
test('sample covers exactly 48 contiguous hours and derives supported phase workloads',()=>{
 const data=JSON.parse(fs.readFileSync('public/data/synthetic-fleet-48h.json','utf8'));
 assert.equal(data.source,'synthetic');assert.equal(data.windows.length,576);
 assert.equal(Date.parse(data.endTime)-Date.parse(data.startTime),48*3600000);
 data.windows.forEach((w,i)=>assert.equal(Date.parse(w.startTime),Date.parse(data.startTime)+i*300000));
 for(const phase of [...SAMPLE_PHASES,'all']){const {workload,history}=sampleTraffic(phase);assert.deepEqual(parseWorkload(workload),workload);assert.equal(history.hourly.length,48);const sweep=sweepConfiguration(defaultProfile(),workload);assert.equal(sweep.shortlist.length,3);assert.ok(sweep.shortlist.some(c=>c.evaluation.feasible),phase);}
 assert.throws(()=>sampleTraffic('../../credentials'));
});

test('whole-history workload uses all windows and request-weighted model mix',()=>{
 const data=JSON.parse(fs.readFileSync('public/data/synthetic-fleet-48h.json','utf8'));
 const {workload,history}=sampleTraffic('all');
 const total=data.windows.reduce((n,w)=>n+w.offeredRps*300,0);
 assert.equal(history.selectedHours,48);
 assert.equal(workload.rps,total/(48*3600));
 for(const model of ['gemma','qwen','kimi']) assert.equal(workload.mix[model],data.windows.reduce((n,w)=>n+w.mix[model]*w.offeredRps*300,0)/total);
});
