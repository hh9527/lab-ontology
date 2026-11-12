import type {Type} from './compiler.ts';
import {primaryCodecs} from './primary-codecs.ts';
const operations=Object.freeze(['Compare','Mean','Min','Max','Round','Difference','Ratio','GrowthRate']);
const scalar=(name:string):Type=>({kind:'scalar',name,semantic:name,codec:primaryCodecs[name]});
const ratio=(name:string,multiplier:number):Type=>({kind:'nominal',name,semantic:name,inner:scalar('Float'),codec:Object.freeze({...primaryCodecs.Float,operations}),presentation:{multiplier,suffix:'%'}});
export const sharedTypes:Readonly<Record<string,Type>>=Object.freeze({
 Percent:ratio('Percent',1),Ratio:ratio('Ratio',100),
 LocalDate:scalar('LocalDate'),TimeZone:scalar('TimeZone'),EpochMillis:scalar('EpochMillis'),DateTimeUtc:scalar('DateTimeUtc'),DateTimeTz:scalar('DateTimeTz')
});
export const semantic=(type:Type):string|undefined=>type.semantic??(type.kind==='option'||type.kind==='nominal'?semantic(type.inner!):type.name==='Rfc3339'?'DateTimeUtc':sharedTypes[type.name??'']?.semantic);
export const timeType=(type:Type)=>['EpochMillis','DateTimeUtc','DateTimeTz'].includes(semantic(type)??'');
