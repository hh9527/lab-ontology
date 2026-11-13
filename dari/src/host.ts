import type {Type} from './compiler.ts';
export type FigureOutput={kind:'chart'|'table';content:string;html?:string;title?:string;dataText?:string};
export type HostPort={
 contractId:string;
 types?:Record<string,Type>;
 formatValue?(type:Type|undefined,value:unknown,precision?:number):unknown;
 components:readonly string[];
 checkFigure(name:string,spec:Record<string,unknown>,fields:Record<string,Type>,nodes?:Record<string,Type>):void;
 renderFigure(name:string,spec:Record<string,unknown>,rows:Record<string,unknown>[],fields:Record<string,Type>,nodes?:Record<string,unknown>[]):FigureOutput;
 functions:Record<string,{sql?:{jsonArgs?:number[]};check(args:Type[],constants:unknown[]):Type;run(args:unknown[]):unknown}>;
 reportStyle:string;
 reportHtml?(text:string,artifacts:Record<string,string>):string;
};
