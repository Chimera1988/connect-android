export type ThemeName = 'waves' | 'aurora' | 'moon' | 'sunset' | 'lagoon' | 'nebula' | 'minimal';
export type Palette = { bg: string; surface: string; elevated: string; accent: string; text: string; muted: string; line: string; danger: string };
export const palettes: Record<ThemeName, Palette> = {
  waves:   {bg:'#07121b',surface:'#112333',elevated:'#1b3445',accent:'#57d8bd',text:'#e8f6ff',muted:'#91a6b4',line:'#315064',danger:'#ff798a'},
  aurora:    {bg:'#0c1125',surface:'#1a2341',elevated:'#273153',accent:'#7ab7ff',text:'#f2f6ff',muted:'#9daac4',line:'#34486d',danger:'#f87a96'},
  moon:    {bg:'#0c1020',surface:'#1a2238',elevated:'#222f49',accent:'#c1baff',text:'#ecefff',muted:'#9ba3c4',line:'#353d58',danger:'#f4788e'},
  sunset:  {bg:'#19121a',surface:'#2b202c',elevated:'#392b39',accent:'#ffab7b',text:'#fff0e5',muted:'#c2a9ab',line:'#553a42',danger:'#f57888'},
  lagoon:  {bg:'#081b20',surface:'#123039',elevated:'#19424b',accent:'#66e5d2',text:'#eafff8',muted:'#90b8bb',line:'#2f5961',danger:'#ff8195'},
  nebula:  {bg:'#171025',surface:'#261a3d',elevated:'#34234e',accent:'#b99aff',text:'#f6edff',muted:'#ab9bbc',line:'#524066',danger:'#ff789f'},
  minimal: {bg:'#12161c',surface:'#20262d',elevated:'#2b323a',accent:'#98b5c6',text:'#f2f4f5',muted:'#a4adb4',line:'#41474c',danger:'#f58690'},
};
export const themeNames: {id:ThemeName;name:string}[] = [
  {id:'waves',name:'Волны'}, {id:'aurora',name:'Сияние'}, {id:'moon',name:'Лунный свет'},
  {id:'sunset',name:'Закат'}, {id:'lagoon',name:'Лагуна'}, {id:'nebula',name:'Туманность'}, {id:'minimal',name:'Минимализм'},
];
