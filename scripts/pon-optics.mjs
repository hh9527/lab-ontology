import { categoryRandom } from './icloud-category-profiles.mjs';

function noise(seed, index) {
  let x=(seed ^ Math.imul(index,0x9e3779b1))>>>0;
  x=Math.imul(x^(x>>>16),0x7feb352d);
  x=Math.imul(x^(x>>>15),0x846ca68b);
  return ((x^(x>>>16))>>>0)/0x100000000;
}

// Prepare once per actual ONU/OLT identity. Receive powers share a reciprocal
// optical-path loss; transmit power varies independently of path attenuation.
export function createPonOptics(seed, onuId, oltId) {
  const olt=key=>categoryRandom(seed,'pon-optics-olt',oltId,key);
  const onu=key=>categoryRandom(seed,'pon-optics-onu',onuId,key);
  const groupLoss=19+olt('path-loss')*7;
  const individualLoss=(onu('path-loss')-0.5)*3;
  const oltTx=3+(olt('tx')-0.5);
  const onuTx=1.5+(onu('tx')-0.5)*1.4;
  const noiseSeed=Math.floor(onu('noise')*0x100000000);
  const driftSeed=Math.floor(onu('drift')*0x100000000);
  const affected=onu('degradation')<0.18;
  const phase=onu('incident-phase')*17;
  return time=>{
    const day=time/86400000;
    const knot=Math.floor(day/5),fraction=day/5-knot;
    const blend=fraction*fraction*(3-2*fraction);
    const drift=(noise(driftSeed,knot)*(1-blend)+noise(driftSeed,knot+1)*blend-0.5)*0.4;
    const cycle=((day+phase)%17+17)%17;
    const degradation=affected ? 2*Math.exp(-Math.pow((cycle-8)/1.5,2)) : 0;
    const jitter=(noise(noiseSeed,Math.floor(time/300000))-0.5)*0.12;
    const loss=groupLoss+individualLoss+drift+degradation;
    return {
      onuHwOpticsRxPower:oltTx-loss+jitter,
      onuHwOpticsTxPower:onuTx+jitter*0.3,
      hwGponOntOpticsOltRxOntPower:onuTx-loss-jitter,
    };
  };
}
