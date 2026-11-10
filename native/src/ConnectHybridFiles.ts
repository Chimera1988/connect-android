import {NativeModules} from 'react-native';

type FileModule={
  startSave:(name:string,mime:string)=>Promise<string|null>;
  writeSave:(id:string,base64:string)=>Promise<number>;
  finishSave:(id:string)=>Promise<number>;
  cancelSave:(id:string)=>Promise<boolean>;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BASE64=Math.ceil(65536/3)*4;
function files():FileModule{
  const module=NativeModules.ConnectFilesModule as FileModule|undefined;
  if(!module)throw new Error('Сохранение файлов недоступно в этой версии Connect');
  return module;
}
function id(value:string){if(!UUID.test(value))throw new Error('Недопустимый идентификатор сохранения');return value;}
/** A cancelled system picker returns null. Opaque IDs are valid only this launch. */
export async function beginSave(name:string,mime:string):Promise<string|null>{
  if(typeof name!=='string'||name.length>240||typeof mime!=='string'||mime.length>120||!/^[A-Za-z0-9.+_-]+\/[A-Za-z0-9.+_-]+$/.test(mime))
    throw new Error('Недопустимое имя или тип файла');
  return files().startSave(name,mime);
}
export async function writeChunk(saveId:string,base64:string){
  if(typeof base64!=='string'||!base64.length||base64.length>MAX_BASE64||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
    throw new Error('Недопустимый блок файла');
  return files().writeSave(id(saveId),base64);
}
export async function finishSave(saveId:string){return files().finishSave(id(saveId));}
export async function cancelSave(saveId:string){return files().cancelSave(id(saveId));}
