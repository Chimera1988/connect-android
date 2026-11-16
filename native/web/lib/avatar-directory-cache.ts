/** Android: sign each avatar at most once per lease, then display durable cached bytes.
 * The coordinator has no access to auth/session tokens and never stores signed URLs on disk.
 */
export type AvatarProfile = {id:string;avatar_path?:string|null};
export type AvatarDirectoryIO = {
  readCached:(path:string)=>Promise<string|null>;
  signBatch:(paths:string[])=>Promise<Record<string,string>>;
  warm:(url:string)=>Promise<void>;
};
export function createAvatarDirectoryCache(){
  let owner='';
  let inFlight:Promise<Record<string,string>>|null=null;
  const leases=new Map<string,{url:string;until:number}>();
  const warmAttempted=new Map<string,number>();
  return {
    async resolve(user:string,people:readonly AvatarProfile[],io:AvatarDirectoryIO):Promise<Record<string,string>>{
      if(owner!==user){owner=user;leases.clear();warmAttempted.clear();inFlight=null;}
      if(inFlight)return inFlight;
      const request=(async()=>{
        const unique=[...new Set(people.map(p=>p.avatar_path).filter((p):p is string=>Boolean(p)))];
        const local=new Map<string,string>();
        await Promise.all(unique.map(async path=>{
          const cached=await io.readCached(path).catch(()=>null);
          if(cached?.startsWith('blob:'))local.set(path,cached);
        }));
        const now=Date.now();
        const needed=unique.filter(path=>!local.has(path)&&(!leases.get(path)||leases.get(path)!.until<=now));
        if(needed.length){
          const signed=await io.signBatch(needed).catch(()=>({} as Record<string,string>));
          for(const path of needed){const url=signed[path];if(url)leases.set(path,{url,until:now+48*60_000});}
        }
        // Fetch only a bounded set of small avatars before handing URLs to <img>.
        // Repeated tab switches reuse the IndexedDB blob; no extra signed GET.
        const toWarm=unique.filter(path=>!local.has(path)&&leases.has(path)&&
          (!warmAttempted.has(path)||warmAttempted.get(path)!<=now)).slice(0,8);
        await Promise.all(toWarm.map(async path=>{
          warmAttempted.set(path,now+60_000);
          try{
            await io.warm(leases.get(path)!.url);
            const cached=await io.readCached(path);
            if(cached?.startsWith('blob:')){local.set(path,cached);warmAttempted.delete(path);}
          }catch{/* Display the signed URL when persistent storage is unavailable. */}
        }));
        if(owner!==user)return {};
        const resolved:Record<string,string>={};
        for(const person of people){
          const path=person.avatar_path;
          if(path){const url=local.get(path)||leases.get(path)?.url;if(url)resolved[person.id]=url;}
        }
        return resolved;
      })();
      inFlight=request;
      try{return await request;}finally{if(inFlight===request)inFlight=null;}
    },
  };
}
