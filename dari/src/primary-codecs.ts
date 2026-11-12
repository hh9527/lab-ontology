import {localDate} from './calendar.ts';
import {dateTimeUtc,epochMillis,parseDateTimeTz} from './time-values.ts';
import type {ValueCodec} from './model.ts';

const make=(valid:(value:unknown)=>boolean,bool=false):ValueCodec=>{
    const parse=(value:unknown)=>{
        if(!valid(value))throw new TypeError('invalid model scalar');
        return value;
    };
    return Object.freeze({
        parse,
        encode:(value:unknown)=>bool?Number(parse(value)):parse(value),
        decode:(value:unknown)=>parse(bool&&value===0?false:bool&&value===1?true:value)
    });
};
const instant=(value:unknown)=>{if(typeof value!=='number')throw new TypeError('EpochMillis requires Int');return epochMillis(value);};
const utc=(value:unknown)=>{if(typeof value!=='string'||value.includes('['))throw new TypeError('DateTimeUtc requires ISO String');return dateTimeUtc(value);};
const integer=make(Number.isSafeInteger);
export const primaryCodecs:Readonly<Record<string,ValueCodec>>=Object.freeze({
    TimeZone:make(value=>{if(typeof value!=='string'||!value||/^[+-]/.test(value))return false;try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}}),
    LocalDate:Object.freeze({parse:localDate,encode:localDate,decode:localDate,operations:['Compare']}),
    Int:integer,
    EpochMillis:Object.freeze({parse:instant,encode:instant,decode:instant}),
    Float:make(value=>typeof value==='number'&&Number.isFinite(value)),
    String:make(value=>typeof value==='string'),
    Bool:make(value=>typeof value==='boolean',true),
    DateTimeUtc:Object.freeze({parse:utc,encode:utc,decode:utc}),
    DateTimeTz:Object.freeze({parse:parseDateTimeTz,encode:parseDateTimeTz,decode:parseDateTimeTz}),
    DateTime:make(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)))
});
