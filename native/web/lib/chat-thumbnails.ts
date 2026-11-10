/** Upload-time WebP thumbnail generation. Originals stay private in Supabase Storage.
 * Modern Safari/iOS and Android use canvas decoding, preserving transparency.
 */
export const photoPreviewPath=(path:string)=>path+'__thumb.webp';
export function supportsPhotoPreview(path:string):boolean{
  return /__img_\d{1,5}x\d{1,5}$/.test(path);
}
export async function makePhotoPreview(file:File):Promise<Blob|null>{
  if(!file.type.startsWith('image/')||file.type==='image/gif'||file.size>100*1024*1024)return null;
  const src=URL.createObjectURL(file);
  try{
    const image=await new Promise<HTMLImageElement>((resolve,reject)=>{
      const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Cannot decode image'));
      img.src=src;
    });
    const width=image.naturalWidth,height=image.naturalHeight;
    if(!width||!height||width>100000||height>100000)return null;
    const scale=Math.min(1,480/width,480/height);
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    const context=canvas.getContext('2d');if(!context)return null;
    context.drawImage(image,0,0,canvas.width,canvas.height);
    const preview=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',.78));
    return preview?.type==='image/webp'&&preview.size>0?preview:null;
  }catch{return null;}finally{URL.revokeObjectURL(src);}
}
