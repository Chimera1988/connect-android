// Values are public client configuration, but never print environment contents.
const expected={EXPO_PUBLIC_SUPABASE_URL:'https://tpwkmoxxzjfdsqsomhhr.supabase.co',EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_tAg8rPwuBNcA2iPF7voc2Q_vsKUpyZa',EXPO_PUBLIC_CONNECT_URL:'https://connect-chat.duckdns.org'};
for(const [key,value]of Object.entries(expected))if(process.env[key]&&process.env[key]!==value)throw Error('Production configuration mismatch: '+key);
console.log('Production public backend configuration matches the embedded web client');
