const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {patchWebViewClient,copyPublicAssets,validRelativeAssetPath}=require('../plugins/withConnectWebAssets');
const fixture=`package com.reactnativecommunity.webview;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
public class RNCWebViewClient extends WebViewClient {
    private static String TAG = "RNCWebViewClient";
}
`;
test('WebView patch is idempotent and refuses an upstream interception conflict',()=>{
  const once=patchWebViewClient(fixture);
  assert.equal(patchWebViewClient(once),once);
  assert.equal((once.match(/public WebResourceResponse shouldInterceptRequest/g)||[]).length,1);
  assert.throws(()=>patchWebViewClient(fixture.replace('private static String TAG','public void shouldInterceptRequest() {} private static String TAG')),/already intercepts/);
  assert.throws(()=>patchWebViewClient(fixture.replace('extends WebViewClient','extends OtherClient')),/anchor changed/);
  assert.throws(()=>patchWebViewClient(fixture+'    // CONNECT_WEB_ASSETS_BEGIN'),/incomplete/);
});
test('shared public-resource path policy rejects traversal and encoded separators',()=>{
  for(const input of ['../secret','stickers/../secret','stickers/./a.svg','stickers//a.svg','/stickers/a.svg','stickers/','stickers/%2e%2e/secret','stickers/a%2fsecret','stickers/a\\secret','stickers/a\0.svg','stickers/a.svg?x=1'])
    assert.equal(validRelativeAssetPath(input),false,input);
  for(const input of ['stickers/blocks/hello.svg','connect-scenes/silver-night.webp','icon-512.png'])
    assert.equal(validRelativeAssetPath(input),true,input);
  // Both the packager and the generated Java handler use this exact allowlist.
  assert.ok(patchWebViewClient(fixture).includes('relative.matches("[A-Za-z0-9][A-Za-z0-9._/-]*")'));
});
test('asset copy replaces stale files and refuses symlink escapes without destroying old assets',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'connect-web-assets-'));
  try{
    const input=path.join(temp,'public'),output=path.join(temp,'output');
    fs.mkdirSync(input);fs.mkdirSync(output);
    fs.writeFileSync(path.join(output,'old.svg'),'stale');
    fs.mkdirSync(path.join(input,'stickers'));fs.writeFileSync(path.join(input,'stickers','hello.svg'),'<svg/>');
    copyPublicAssets(input,output);
    assert.equal(fs.existsSync(path.join(output,'old.svg')),false);
    assert.equal(fs.readFileSync(path.join(output,'stickers','hello.svg'),'utf8'),'<svg/>');
    fs.symlinkSync(path.join(temp,'outside'),path.join(input,'escape'));
    assert.throws(()=>copyPublicAssets(input,output),/unsafe resource name/);
    assert.equal(fs.readFileSync(path.join(output,'stickers','hello.svg'),'utf8'),'<svg/>');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('inline WebView exposes its pinned HTTPS base as the visible history URL',()=>{
  const {patchWebViewManager}=require('../plugins/withConnectWebAssets');
  const source='view.loadDataWithBaseURL(\n baseUrl,\n html!!,\n HTML_MIME_TYPE,\n HTML_ENCODING,\n null\n)';
  const patched=patchWebViewManager(source);
  assert.match(patched,/HTML_ENCODING,\s*baseUrl/);
  assert.equal(patchWebViewManager(patched),patched);
  assert.throws(()=>patchWebViewManager('view.loadDataWithBaseURL(html)'),/origin anchor changed/);
});
