import type {Type} from './compiler.ts';
import type {Node} from './syntax.ts';

export const MAX_RESULT_ROWS=500;
export type Ordering={key:string;direction:'asc'|'desc'};
export type ResultContract={element:Type;container:'table'|'option'|'grouped';maxRows?:number;ordering:Ordering[]};
export type Plan={
 id:number;
 kind:'source'|'set'|'distinct'|'top'|'filter'|'group'|'project'|'order'|'take';
 input?:Plan;
 result:ResultContract;
 scope:Record<string,Type>;
 refs:Record<string,string>;
 sources?:{alias:string;binding:string;nullable:boolean;fields:Record<string,string>;ordering:Ordering[]}[];
 join?:Node;
 setOp?:'UNION'|'UNION ALL'|'INTERSECT'|'EXCEPT';
 existsMode?:'semi'|'anti';
 predicate?:Node;
 fields?:Node[];
 aggregate?:boolean;
 keys?:Node[];
 terms?:Node[];
 count?:number;
};
