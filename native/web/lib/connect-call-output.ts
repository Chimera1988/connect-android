/** CONNECT_PWA_CALL_OUTPUT_20261114
 * Use only real browser-enumerated output devices; never invent earpiece/speaker IDs.
 */
export type ConnectCallOutput={id:string;label:string};
type AudioWithSink=HTMLAudioElement&{setSinkId?:(id:string)=>Promise<void>};
export function callOutputSupported(audio:HTMLAudioElement|null):boolean{
  return !!audio && typeof (audio as AudioWithSink).setSinkId==='function';
}
export function listedCallOutputs(devices:readonly MediaDeviceInfo[]):ConnectCallOutput[]{
  const ids=new Set<string>();
  const outputs:ConnectCallOutput[]=[];
  for(const device of devices){
    if(device.kind!=='audiooutput'||!device.deviceId||ids.has(device.deviceId))continue;
    ids.add(device.deviceId);
    outputs.push({id:device.deviceId,label:device.label||`Аудиоустройство ${outputs.length+1}`});
  }
  return outputs;
}
export async function chooseCallOutput(audio:HTMLAudioElement|null,id:string):Promise<void>{
  if(!callOutputSupported(audio))throw new Error('Выбор аудиовыхода не поддерживается');
  await (audio as AudioWithSink).setSinkId!(id);
}
