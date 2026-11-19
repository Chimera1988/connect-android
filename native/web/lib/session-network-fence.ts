/** Block stale asynchronous work after local logout, including clients holding
 * an access token in memory. Password login remains available to unlock again. */
export function fencedSessionFetch(transport:typeof fetch,locked:()=>boolean,origin:string,supabase:string):typeof fetch{
  return (input,init)=>{
    const raw=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
    const url=new URL(raw,origin),isProxy=url.origin===origin;
    const path=isProxy?url.pathname.replace(/^\/supabase\//,'/'):url.pathname;
    if(locked()&&(isProxy||url.origin===supabase)&&(
      /^\/(rest|storage|functions)\/v1\//.test(path)||
      /^\/api\//.test(path)||
      path==='/auth/v1/token'&&url.searchParams.get('grant_type')==='refresh_token'
    ))return Promise.reject(Error('SESSION_LOCKED'));
    return transport(input,init);
  };
}
