/** Serve the pinned PWA public files from APK assets without file:// access.
 * The HTML retains the trusted Connect HTTPS origin; only subresources use
 * Android's reserved appassets host. Re-running prebuild applies the same patch.
 */
const {withDangerousMod}=require('expo/config-plugins');
const fs=require('fs');
const path=require('path');

const BEGIN='    // CONNECT_WEB_ASSETS_BEGIN';
const END='    // CONNECT_WEB_ASSETS_END';
const SAFE_RESOURCE_PATTERN='[A-Za-z0-9][A-Za-z0-9._/-]*';
function validRelativeAssetPath(value){
  return new RegExp('^'+SAFE_RESOURCE_PATTERN+'$').test(value)&&
    value.split('/').every(segment=>segment!==''&&segment!=='.'&&segment!=='..');
}
const handler=String.raw`
    // CONNECT_WEB_ASSETS_BEGIN
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        android.net.Uri uri = request.getUrl();
        if (!"appassets.androidplatform.net".equalsIgnoreCase(uri.getHost())) {
            return super.shouldInterceptRequest(view, request);
        }
        java.util.Map<String, String> headers = new java.util.HashMap<>();
        headers.put("Access-Control-Allow-Origin", "https://connect-chat.duckdns.org");
        headers.put("Cross-Origin-Resource-Policy", "cross-origin");
        headers.put("X-Content-Type-Options", "nosniff");
        String encodedPath = uri.getEncodedPath();
        String prefix = "/assets/connect-web/";
        boolean valid = !request.isForMainFrame() && "GET".equals(request.getMethod())
            && "https".equals(uri.getScheme()) && uri.getPort() == -1
            && uri.getUserInfo() == null && uri.getEncodedQuery() == null
            && uri.getEncodedFragment() == null && encodedPath != null
            && encodedPath.startsWith(prefix);
        String relative = valid ? encodedPath.substring(prefix.length()) : "";
        // Public resource names are ASCII. Reject encoded separators, dot
        // segments, nulls and backslashes before AssetManager sees any path.
        valid = valid && relative.matches("${SAFE_RESOURCE_PATTERN}");
        for (String segment : relative.split("/", -1)) {
            if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)) valid = false;
        }
        if (valid) {
            // Legacy builtin sticker URLs keep their IDs; bytes come from the
            // optimized APK WebP, never a second network download.
            if (relative.startsWith("stickers/") && relative.endsWith(".svg")) relative = relative.substring(0, relative.length() - 4) + ".webp";
            try {
                java.io.InputStream stream = view.getContext().getAssets().open("connect-web/" + relative);
                String mime = relative.endsWith(".webp") ? "image/webp" : relative.endsWith(".svg") ? "image/svg+xml"
                    : java.net.URLConnection.getFileNameMap().getContentTypeFor(relative);
                if (mime == null) mime = "application/octet-stream";
                headers.put("Cache-Control", "public, max-age=31536000, immutable");
                return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, stream);
            } catch (java.io.IOException missingAsset) {
                // A missing APK asset must never become a network request.
            }
        }
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", headers,
            new java.io.ByteArrayInputStream(new byte[0]));
    }
    // CONNECT_WEB_ASSETS_END
`;

function patchWebViewClient(source){
  const start=source.indexOf(BEGIN),end=source.indexOf(END);
  if(start!==-1||end!==-1){
    if(start<0||end<start)throw new Error('Connect assets: incomplete existing WebView patch');
    source=source.slice(0,start).replace(/\n+$/,'')+source.slice(end+END.length);
  }
  if(/\bshouldInterceptRequest\s*\(/.test(source))
    throw new Error('Connect assets: WebView already intercepts requests; review upstream before combining handlers');
  const anchor='public class RNCWebViewClient extends WebViewClient {';
  if(source.split(anchor).length!==2)
    throw new Error('Connect assets: RNCWebViewClient class anchor changed');
  for(const dependency of ['import android.webkit.WebResourceRequest;','import android.webkit.WebResourceResponse;'])
    if(!source.includes(dependency))throw new Error('Connect assets: WebView request imports changed');
  return source.replace(anchor,anchor+'\n'+handler.replace(/^\n/,'').trimEnd());
}

function copyPublicAssets(source,destination){
  if(!fs.existsSync(source)||!fs.statSync(source).isDirectory())throw new Error('Connect assets: pinned PWA public/ missing');
  const staging=destination+'.staging';
  fs.rmSync(staging,{recursive:true,force:true});
  fs.mkdirSync(staging,{recursive:true});
  const copy=(from,to)=>{
    for(const entry of fs.readdirSync(from,{withFileTypes:true})){
      if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.name)||entry.isSymbolicLink())
        throw new Error('Connect assets: unsafe resource name '+entry.name);
      const input=path.join(from,entry.name),output=path.join(to,entry.name);
      if(!validRelativeAssetPath(path.relative(source,input).split(path.sep).join('/')))
        throw new Error('Connect assets: unsafe resource path');
      if(entry.isDirectory()){fs.mkdirSync(output);copy(input,output);}
      else if(entry.isFile())fs.copyFileSync(input,output);
      else throw new Error('Connect assets: unsupported public resource '+entry.name);
    }
  };
  try{copy(source,staging);}catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
  fs.rmSync(destination,{recursive:true,force:true});
  fs.renameSync(staging,destination);
}

function patchWebViewManager(source){
  const marker='// CONNECT_HTML_HISTORY_ORIGIN';
  if(source.includes(marker))return source;
  const call=/view\.loadDataWithBaseURL\(\s*baseUrl,\s*html!!,\s*HTML_MIME_TYPE,\s*HTML_ENCODING,\s*null\s*\)/g;
  const matches=[...source.matchAll(call)];
  if(matches.length!==1)throw new Error('Connect assets: inline WebView history origin anchor changed');
  return source.replace(call,match=>match.replace(/null\s*\)$/, 'baseUrl '+marker+'\n                )'));
}
module.exports=function withConnectWebAssets(config){
  return withDangerousMod(config,['android',async mod=>{
    const project=mod.modRequest.projectRoot;
    const client=path.join(project,'node_modules','react-native-webview','android','src','main','java','com','reactnativecommunity','webview','RNCWebViewClient.java');
    const manager=path.join(path.dirname(client),'RNCWebViewManagerImpl.kt');
    const managerSource=fs.readFileSync(manager,'utf8');
    const managerPatched=patchWebViewManager(managerSource);
    if(managerSource!==managerPatched)fs.writeFileSync(manager,managerPatched);
    const original=fs.readFileSync(client,'utf8');
    const patched=patchWebViewClient(original);
    copyPublicAssets(path.join(project,'web','public'),path.join(mod.modRequest.platformProjectRoot,'app','src','main','assets','connect-web'));
    if(original!==patched)fs.writeFileSync(client,patched);
    return mod;
  }]);
};
module.exports.patchWebViewClient=patchWebViewClient;
module.exports.copyPublicAssets=copyPublicAssets;
module.exports.validRelativeAssetPath=validRelativeAssetPath;

module.exports.patchWebViewManager=patchWebViewManager;
