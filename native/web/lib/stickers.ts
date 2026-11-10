export type StickerPackId = 'speed' | 'blocks' | 'anime-boys' | 'anime-girls' | 'favorites' | 'recent';
type Sticker = {id:string;name:string};
type Pack = {id:Exclude<StickerPackId,'favorites'|'recent'>;name:string;emoji:string;description:string;stickers:Sticker[]};
const moods:Sticker[]=[{id:'hello',name:'Привет'},{id:'love',name:'Любовь'},{id:'laugh',name:'Смех'},{id:'wow',name:'Удивление'},{id:'sad',name:'Грусть'},{id:'angry',name:'Злость'},{id:'wink',name:'Подмигивание'},{id:'sleep',name:'Сплю'},{id:'thanks',name:'Спасибо'},{id:'cool',name:'Круто'},{id:'facepalm',name:'Фейспалм'},{id:'thinking',name:'Думаю'},{id:'cry',name:'Плачу'},{id:'shy',name:'Смущение'},{id:'party',name:'Ура'},{id:'hug',name:'Обнимашки'},{id:'nope',name:'Нет'},{id:'yes',name:'Да'},{id:'shock',name:'Шок'},{id:'heart',name:'Сердечко'},{id:'coffee',name:'Кофе'},{id:'gaming',name:'Играю'},{id:'bye',name:'Пока'},{id:'tired',name:'Устал'}];
export const STICKER_PACKS:Pack[]=[
 {id:'speed',name:'Соник',emoji:'⚡',description:'Скоростные приключения и эмоции',stickers:moods},
 {id:'blocks',name:'Minecraft',emoji:'🧱',description:'Кубические приключения и эмоции',stickers:moods},
 {id:'anime-boys',name:'Аниме-парни',emoji:'🧑🏻',description:'Весёлые реакции',stickers:moods},
 {id:'anime-girls',name:'Аниме-девушки',emoji:'👩🏻',description:'Милые реакции',stickers:moods}
];
const PREFIX='[[connect-sticker:';
export function stickerBody(pack:string,id:string){return `${PREFIX}${pack}:${id}]]`;}
export function stickerFromBody(body:string):{pack:string;id:string}|null{
 const match=/^\[\[connect-sticker:([a-z-]+):([a-z]+)\]\]$/.exec(body);
 if(!match || !STICKER_PACKS.some(p=>p.id===match[1]&&p.stickers.some(s=>s.id===match[2])))return null;
 return {pack:match[1],id:match[2]};
}
export function stickerUrl(sticker:{pack:string;id:string}){const path=`/stickers/${sticker.pack}/${sticker.id}.webp`;return "https://appassets.androidplatform.net/assets/connect-web"+path;}
