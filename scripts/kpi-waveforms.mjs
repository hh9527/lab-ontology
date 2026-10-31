import { categoryRandom } from './icloud-category-profiles.mjs';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth = x => { const t=clamp(x,0,1); return t*t*(3-2*t); };
const ramp = (x, start, end) => smooth((x-start)/(end-start));
function randomAt(seed, index) {
  let x=(seed ^ Math.imul(index|0,0x9e3779b1))>>>0;
  x=Math.imul(x^(x>>>16),0x7feb352d);
  x=Math.imul(x^(x>>>15),0x846ca68b);
  return ((x^(x>>>16))>>>0)/4294967296;
}

// Two layers: a broad local-business-day envelope plus seeded irregular jitter.
// Parameters are prepared once per series; no trigonometric template is used.
export function createKpiWaves(seed) {
  const cache=new Map();
  return (table, column, resource) => {
    const key=JSON.stringify([table,column,resource]);
    if(cache.has(key))return cache.get(key);
    const draw=name=>categoryRandom(seed,table,resource,`${column}:${name}`);
    const phase=(draw('phase')-0.5)*3;
    const amplitude=0.65+draw('amplitude')*0.7;
    const baseline=0.92+draw('baseline')*0.16;
    const trend=0.65+draw('trend')*0.7;
    const noiseSeed=Math.floor(draw('noise')*0x100000000);
    const jitterHours=0.5+draw('jitter-hours')*2.5;
    const jitterAmplitude=0.04+draw('jitter-amplitude')*0.12;
    const wave={phase,amplitude,baseline,trend,jitterHours,
      at(time) {
        const local=time/3600000+8;
        const day=Math.floor(local/24),hour=((local%24)+24)%24;
        const shift=phase+(randomAt(noiseSeed^0x23a9,day)-0.5)*0.8;
        const dailyAmplitude=amplitude*(0.9+randomAt(noiseSeed^0x3571,day)*0.2);
        const envelope=ramp(hour,7+shift,11+shift)*(1-ramp(hour,17+shift,21+shift));
        const position=local/jitterHours,knot=Math.floor(position),t=smooth(position-knot);
        const slow=(randomAt(noiseSeed,knot)*(1-t)+randomAt(noiseSeed,knot+1)*t)*2-1;
        const fast=randomAt(noiseSeed^0x41b7,Math.floor(local*12))*2-1;
        const jitter=(slow*0.75+fast*0.25)*jitterAmplitude;
        return {daily:(envelope*2-1)*dailyAmplitude+jitter,
          load:clamp(0.16+envelope*0.66*dailyAmplitude+jitter,0.03,0.98),jitter};
      },
    };
    cache.set(key,wave);return wave;
  };
}
