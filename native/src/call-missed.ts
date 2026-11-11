import policy from '../shared/call-missed-policy.json';
export type MissedCallLike={id?:string;callee_id:string;status:string;created_at:string;answered_at?:string|null;ended_at?:string|null};
type Expr=unknown[];
let acceptedLocalCall='';
export function setMissedActiveCall(id:string,phase:string){acceptedLocalCall=['connecting','active','reconnecting'].includes(phase)?id:'';}

export function callTimestamp(value:string|undefined|null):number{
 if(!value)return NaN;
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);if(!m)return NaN;
 const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number);
 const calendar=new Date(0);calendar.setUTCFullYear(year,month-1,day);
 if(calendar.getUTCFullYear()!==year||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day||hour>23||minute>59||second>59)return NaN;
 if(m[7]!=='Z'){const h=Number(m[7].slice(1,3)),min=Number(m[7].slice(4));if(h>18||min>59||h===18&&min>0)return NaN;}
 return Date.parse(value);
}
/** One declarative predicate; Kotlin is generated from the same AST for cold FCM. */
export function isMissedIncomingCall(call:MissedCallLike,recipient:string,now=Date.now(),activeCallId=acceptedLocalCall):boolean{
 const evaluate=(e:Expr):boolean=>{
  const [op,...args]=e;
  if(op==='all')return args.every(x=>evaluate(x as Expr));
  if(op==='any')return args.some(x=>evaluate(x as Expr));
  if(op==='owner')return !!recipient&&call.callee_id===recipient;
  if(op==='unanswered')return call.answered_at==null||call.answered_at==='';
  if(op==='status')return call.status===args[0];
  if(op==='valid-date')return Number.isFinite(callTimestamp(call[args[0] as 'ended_at']));
  if(op==='older-than'){const time=callTimestamp(call.created_at);return Number.isFinite(time)&&now-time>Number(args[1]);}
  if(op==='not-active')return !activeCallId||call.id!==activeCallId;
  throw Error('Unknown call predicate');
 };
 return evaluate(policy.predicate);
}
