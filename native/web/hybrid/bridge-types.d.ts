/** Shared type surface; importing it never installs or starts the bridge. */
export {};
declare global{interface Window{ConnectNative?:{request:(command:string,payload?:unknown)=>Promise<any>};}}
