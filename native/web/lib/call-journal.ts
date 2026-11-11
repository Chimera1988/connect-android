export type JournalState={count:number;lastViewed:number};
export async function nativeCallJournal(userId:string,action:string,extra:Record<string,unknown>={}):Promise<JournalState>{
 if(!window.ConnectNative)throw Error('Нативный журнал недоступен');
 return window.ConnectNative.request('calls:journal',{userId,action,...extra});
}
