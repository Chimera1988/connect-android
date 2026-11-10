import {defineConfig} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,relative} from 'node:path';
const root=resolve(__dirname);
export default defineConfig({root,publicDir:false,plugins:[{name:'connect-offline-brand-assets',enforce:'pre',transform(code,id){
  if(!/\.(tsx?|css)$/.test(id)||id.includes('node_modules'))return;
  return code.replace(/(["'])(\/(?:connect-[a-z0-9/-]+|icon-[a-z0-9-]+)\.(?:png|svg|webp))\1/g,(_all,q,path)=>q+'https://appassets.androidplatform.net/assets/connect-web'+path+q).replace(/^['"]use client['"];?/,'');
}},viteSingleFile()],define:{
  'process.env.NEXT_PUBLIC_SUPABASE_URL':JSON.stringify('https://tpwkmoxxzjfdsqsomhhr.supabase.co'),
  'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_tAg8rPwuBNcA2iPF7voc2Q_vsKUpyZa'),
  'process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY':JSON.stringify(''),
},esbuild:{jsx:'automatic'},build:{target:'chrome80',outDir:'dist',emptyOutDir:true,assetsInlineLimit:Infinity,minify:true,reportCompressedSize:false}});
