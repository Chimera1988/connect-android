import type {} from '../hybrid/bridge-types';
/** Catalog metadata shares the existing encrypted Android history database. */
export async function readNativeCatalog<T>(userId:string,key:string):Promise<{value:T|null;epoch:number}>{
 if(!window.ConnectNative)throw Error('Native catalog unavailable');
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([window.ConnectNative.request('history:catalog-read',{userId,key}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Native catalog timeout')),2000);})]);}finally{if(timer)clearTimeout(timer);}
}
export async function writeNativeCatalog<T extends object>(userId:string,key:string,value:T,epoch:number){
 return window.ConnectNative!.request('history:catalog-write',{userId,key,value,epoch});
}
export async function dropNativeCatalog(userId:string,key:string){return window.ConnectNative!.request('history:catalog-drop',{userId,key});}
