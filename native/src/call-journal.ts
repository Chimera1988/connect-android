import {NativeModules} from 'react-native';
export type JournalState={count:number;lastViewed:number};
export async function nativeCallJournal(userId:string,action:string,extra:Record<string,unknown>={}):Promise<JournalState>{
 const module=NativeModules?.ConnectCallCoordinator;if(!module?.journal)throw Error('Native journal unavailable');
 return JSON.parse(await module.journal(userId,JSON.stringify({action,...extra})));
}
