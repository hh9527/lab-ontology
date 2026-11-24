import { categoryRandom } from './icloud-category-profiles.mjs';

const day = 86400000;
const minute = 60000;
const maxDuration = 12 * 60 * minute;

// Events belong to physical identities and absolute UTC days, not sample grids
// or output windows. Overlapping events represent one union of downtime.
export function createAvailability(seed) {
  const profiles = new Map();
  function profile(resource) {
    const key = JSON.stringify([resource.id, resource.classification ?? '']);
    if (profiles.has(key)) return profiles.get(key);
    const draw = name => categoryRandom(seed, 'availability', key, name);
    const category = name => categoryRandom(seed, 'availability-class', resource.classification ?? '', name);
    // Shared class exposure plus stable / intermittent / unstable populations.
    // These are synthetic reliability scenarios, not claims about device classes.
    const exposure = category('reliability');
    const population = draw('population');
    const frequencyFactor = population < 0.65 ? 0.6 : population < 0.9 ? 1 : 1.5;
    const repairFactor = population < 0.65 ? 0.6 : population < 0.9 ? 1.5 : 3;
    const value = {
      probability: Math.min(0.95, (0.03 + 0.65 * exposure) * (0.5 + draw('reliability')) * frequencyFactor),
      duration: (15 + 300 * exposure ** 2) * (0.5 + draw('repair')) * repairFactor * minute,
      days: new Map(), draw,
    };
    profiles.set(key, value);
    return value;
  }
  function events(resource, start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw Error('Availability requires a finite, positive interval');
    const p = profile(resource);
    const result = [];
    for (let d = Math.floor((start - maxDuration) / day); d <= Math.floor((end - 1) / day); d++) {
      if (!p.days.has(d)) {
        let event = null;
        if (p.draw(`occurs:${d}`) < p.probability) {
          const begin = d * day + Math.floor(p.draw(`start:${d}`) * day);
          const rawDuration = p.duration * (0.35 + p.draw(`duration:${d}`) * 1.6)
            * (p.draw(`incident:${d}`) < 0.05 ? 2 : 1);
          // Smoothly bound long repairs without piling events onto one duration.
          const duration = Math.round(maxDuration * (1 - Math.exp(-rawDuration / maxDuration)));
          event = Object.freeze({start: begin, end: begin + duration});
        }
        p.days.set(d, event);
      }
      const event = p.days.get(d);
      if (event && event.start < end && event.end > start) result.push(event);
    }
    return result;
  }
  function rate(resource, start, interval) {
    const end = start + interval;
    let downtime = 0, covered = start;
    for (const event of events(resource, start, end)) {
      const begin = Math.max(start, event.start, covered);
      const stop = Math.min(end, event.end);
      if (stop > begin) downtime += stop - begin;
      covered = Math.max(covered, stop);
    }
    return 100 * (1 - downtime / interval);
  }
  return { events, rate };
}
