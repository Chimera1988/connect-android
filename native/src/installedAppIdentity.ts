export type InstalledAppIdentity={packageName:string;version:string;build:number};
/** OTA manifests describe the JS update, not the binary Android will replace. */
export async function readInstalledAppIdentity(module:{getAppIdentity?:()=>Promise<InstalledAppIdentity>}):Promise<InstalledAppIdentity>{
  if(!module?.getAppIdentity)throw Error('Установите новый APK Connect для проверки версии Android.');
  const value=await module.getAppIdentity();
  if(value.packageName!=='com.connect.messenger'||!/^\d+\.\d+\.\d+$/.test(value.version)||!Number.isSafeInteger(value.build)||value.build<1)
    throw Error('Invalid installed APK identity');
  return value;
}
