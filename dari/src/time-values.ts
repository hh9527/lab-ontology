/** Shared instant semantics. Encodings retain milliseconds; no wall clock is read. */
export const TIME_TYPES=new Set(['EpochMillis','DateTimeUtc','DateTimeTz']);
export function epochMillis(value:unknown):number {
 if(typeof value==='number'){
  if(!Number.isSafeInteger(value)||!Number.isFinite(new Date(value).getTime()))throw new TypeError('EpochMillis requires a valid integer instant');
  return value;
 }
 if(typeof value!=='string')throw new TypeError('Time conversion requires an instant');
 if(value.endsWith(']'))return epochMillis(parseDateTimeTz(value).split('[')[0]);
 const text=value;
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(text))throw new TypeError('DateTimeUtc requires ISO time with an explicit offset and millisecond precision');
 const match=/^(\d{4})-(\d\d)-(\d\d)/.exec(text)!;
 const calendar=new Date(0);calendar.setUTCFullYear(Number(match[1]),Number(match[2])-1,Number(match[3]));
 if(calendar.getUTCFullYear()!==Number(match[1])||calendar.getUTCMonth()!==Number(match[2])-1||calendar.getUTCDate()!==Number(match[3]))throw new TypeError('Invalid calendar date');
 const clock=/T(\d\d):(\d\d):(\d\d)/.exec(text)!;
 if(Number(clock[1])>23||Number(clock[2])>59||Number(clock[3])>59)throw new TypeError('Invalid clock time');
 const offset=/[+-](\d\d):(\d\d)$/.exec(text);if(offset&&(Number(offset[1])>23||Number(offset[2])>59))throw new TypeError('Invalid UTC offset');
 const ms=Date.parse(text);if(!Number.isFinite(ms))throw new TypeError('Invalid time instant');return ms;
}
export function dateTimeUtc(value:unknown):string{return new Date(epochMillis(value)).toISOString();}
export function timeZone(value:unknown):string{
 if(typeof value!=='string'||!value||/^[+-]/.test(value))throw new TypeError('Expected an IANA time zone');
 return new Intl.DateTimeFormat('en',{timeZone:value}).resolvedOptions().timeZone;
}
export function dateTimeTz(value:unknown,zone:unknown):string{
 const ms=epochMillis(value),id=timeZone(zone);
 const format=new Intl.DateTimeFormat('en-CA',{timeZone:id,calendar:'iso8601',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'});
 const fields=Object.fromEntries(format.formatToParts(ms).map(p=>[p.type,p.value]));
 const offset=fields.timeZoneName==='GMT'?'+00:00':fields.timeZoneName.replace(/^GMT/,'');
 if(!/^[+-]\d\d:\d\d$/.test(offset))throw new TypeError('DateTimeTz requires a zone offset representable in whole minutes');
 return `${fields.year.padStart(4,'0')}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}:${fields.second}.${String(((ms%1000)+1000)%1000).padStart(3,'0')}${offset}[${id}]`;
}
export function parseDateTimeTz(value:unknown):string{
 if(typeof value!=='string')throw new TypeError('DateTimeTz requires an offset and IANA zone');
 const match=/^(.*)\[([^\]]+)\]$/.exec(value);if(!match)throw new TypeError('DateTimeTz requires an offset and IANA zone');
 const canonical=dateTimeTz(match[1],match[2]);
 if(epochMillis(canonical.split('[')[0])!==epochMillis(match[1])||canonical.slice(0,canonical.indexOf('[')).slice(-6)!==match[1].slice(-6))throw new TypeError('DateTimeTz offset does not match its IANA zone');
 return canonical;
}
export const timeFunctions={to_epoch_millis:(value:unknown)=>epochMillis(value),to_datetime_utc:(value:unknown)=>dateTimeUtc(value),to_datetime_tz:(value:unknown,zone:unknown)=>dateTimeTz(value,zone)};
