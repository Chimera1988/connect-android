const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const vm=require('node:vm');
const protocol={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/hybridProtocol.ts'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,{exports:protocol,URL,Date});
const {parseHybridMessage:parse,isTrustedHybridUrl:trusted,MAX_BRIDGE_BYTES,CONNECT_ORIGIN}=protocol;
const nonce='0123456789abcdef0123456789abcdef';
const uuid='bce41143-d7ac-4dcf-aac2-c66b80872765';
const token='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb28ifQ.signature';
const message=(command,payload,extra={})=>JSON.stringify({v:1,nonce,id:'request:1',command,payload,...extra});
const read=(command,payload,extra,url=CONNECT_ORIGIN+'/')=>parse(message(command,payload,extra),nonce,url);

test('bridge requires the exact HTTPS origin without credentials or URL tricks',()=>{
  assert.equal(trusted(CONNECT_ORIGIN),true);
  assert.equal(trusted(CONNECT_ORIGIN+':443/'),true);
  for(const url of ['about:blank','file:///android_asset/index.html','data:text/html,hi',
    'http://connect-chat.duckdns.org','https://connect-chat.duckdns.org:444',
    'https://connect-chat.duckdns.org.evil.test','https://evil.test@connect-chat.duckdns.org',
    'https://connect-chat.duckdns.org@evil.test',' https://connect-chat.duckdns.org',
    'https://connect-chat.duckdns.org\n/']){
    assert.equal(trusted(url),false,url);
    assert.equal(read('sounds:get',{},undefined,url),null,url);
  }
});

test('bridge rejects malformed, unsolicited, replay-context or enlarged envelopes',()=>{
  assert.equal(parse('bad json',nonce,CONNECT_ORIGIN),null);
  assert.equal(parse('null',nonce,CONNECT_ORIGIN),null);
  assert.equal(read('sounds:get',{}, {v:2}),null);
  assert.equal(read('sounds:get',{}, {nonce:'another-document-nonce'}),null);
  assert.equal(parse(message('sounds:get',{}),'short',CONNECT_ORIGIN),null);
  assert.equal(read('sounds:get',{}, {unknown:true}),null);
  assert.equal(read('sounds:get',{}, {id:'<script>alert(1)</script>'}),null);
  assert.equal(read('evaluateJavaScript',{code:'alert(1)'}),null);
  assert.equal(parse(' '.repeat(MAX_BRIDGE_BYTES+1),nonce,CONNECT_ORIGIN),null);
  assert.equal(read('clipboard',{text:'界'.repeat(50000)}),null);
});

test('only validated auth sessions and bounded credential strings cross the bridge',()=>{
  assert.ok(read('session',{access_token:token,refresh_token:'refresh_token-1'}));
  assert.ok(read('session',null));
  assert.ok(read('register',{token}));
  assert.equal(read('session',{access_token:token}),null);
  assert.equal(read('session',{access_token:token,refresh_token:'bad whitespace'}),null);
  assert.equal(read('register',{token:'not-an-access-token'}),null);
  assert.equal(read('register',{token,service_role:'never'}),null);
});

test('read markers require a conversation UUID and a complete finite timestamp',()=>{
  for(const readAt of ['2026-11-09T13:01:02.123Z','2026-11-09T13:01:02+00:00']){
    assert.ok(read('read',{conversationId:uuid,readAt}));
  }
  for(const readAt of ['today','2026-11-09','2026-99-99T13:01:02Z']){
    assert.equal(read('read',{conversationId:uuid,readAt}),null);
  }
  assert.equal(read('read',{conversationId:'all',readAt:'2026-11-09T13:01:02Z'}),null);
  assert.ok(read('activeConversation',{id:''}));
  assert.ok(read('activeConversation',{id:uuid}));
});

test('notification preferences and sounds cannot smuggle paths or arbitrary settings',()=>{
  assert.ok(read('preferences',{enabled:true,sound:'soft',vibrate:false}));
  assert.equal(read('preferences',{enabled:'true',sound:'soft',vibrate:false}),null);
  assert.equal(read('preferences',{enabled:true,sound:'file:///tmp/secret',vibrate:false}),null);
  for(const command of ['sounds:get','sounds:stop']) assert.ok(read(command,{}));
  for(const command of ['sounds:pick','sounds:reset','sounds:preview']){
    assert.ok(read(command,{kind:'message'}));
    assert.equal(read(command,{kind:'../secret'}),null);
  }
  assert.ok(read('sounds:silent',{kind:'call',muted:true}));
  assert.equal(read('sounds:silent',{kind:'call',muted:1}),null);
  assert.ok(read('sounds:previewBuiltin',{tone:'gentle'}));
  assert.equal(read('sounds:previewBuiltin',{tone:'arbitrary-resource'}),null);
});

test('call commands permit only audio operations and well-formed call identities',()=>{
  assert.ok(read('calls:dial',{conversationId:uuid,peerId:uuid,peerName:'Собеседник'}));
  assert.equal(read('calls:dial',{conversationId:uuid,peerId:uuid,peerName:'Alice',video:true}),null);
  for(const command of ['calls:accept','calls:decline','calls:end','calls:route']){
    assert.ok(read(command,{}));
    assert.ok(read(command,{callId:uuid}));
    assert.equal(read(command,{callId:'all'}),null);
  }
  assert.ok(read('calls:mute',{callId:uuid,muted:true}));
  assert.ok(read('calls:speaker',{enabled:false}));
  assert.equal(read('calls:speaker',{enabled:'false'}),null);
  assert.equal(read('calls:video',{enabled:true}),null);
});

test('file-free media, clipboard and external URLs cannot execute native code',()=>{
  assert.ok(read('recordVoice:start',{}));
  assert.ok(read('recordVoice:stop',{send:false}));
  assert.ok(read('recordVoice:cancel',{}));
  assert.ok(read('recordVideo:open',{}));
  assert.equal(read('recordVideo:open',{path:'/etc/passwd'}),null);
  assert.ok(read('clipboard',{text:'Hello 👋'}));
  assert.equal(read('clipboard',{text:'x'.repeat(10001)}),null);
  assert.equal(read('clipboard',{text:'hello\0'}),null);
  assert.ok(read('openExternal',{url:'https://example.com/path?q=1#fragment'}));
  for(const url of ['javascript:alert(1)','intent://phone','file:///etc/passwd','https://user:password@example.com']){
    assert.equal(read('openExternal',{url}),null,url);
  }
});

test('media acknowledgements, migration and document writes have a bounded strict protocol',()=>{
  assert.ok(read('bridge:ready',{}));
  assert.ok(read('migration:get',{}));
  assert.equal(read('migration:get',{ownerId:uuid}),null);
  assert.ok(read('file:ack',{id:'17',offset:32768}));
  assert.equal(read('file:ack',{id:'17',offset:-1}),null);
  assert.equal(read('file:ack',{id:'17',offset:32*1024*1024+1}),null);
  assert.ok(read('files:begin',{name:'Экспорт Connect.json',mimeType:'application/json'}));
  assert.equal(read('files:begin',{name:'../secret',mimeType:'text/plain'}),null);
  assert.ok(read('files:chunk',{id:uuid,data:'AQIDBA=='}));
  assert.equal(read('files:chunk',{id:uuid,data:'!bad!'}),null);
  assert.equal(read('files:chunk',{id:uuid,data:'A'.repeat(65540)}),null);
  assert.equal(read('files:chunk',{id:'content://private',data:'AQIDBA=='}),null);
  assert.ok(read('files:end',{id:uuid}));
  assert.ok(read('files:cancel',{id:uuid}));
});

test('history bridge accepts bounded snapshots and rejects foreign conversations and invalid cursors',()=>{
  assert.ok(read('history:read',{userId:uuid,conversationId:uuid}));
  assert.ok(read('history:page',{userId:uuid,conversationId:uuid,beforeId:uuid,before:'2026-11-10T12:00:00.000001Z',direction:'after'}));
  assert.equal(read('history:page',{userId:uuid,conversationId:uuid,beforeId:uuid,before:'today'}),null);
  assert.equal(read('history:page',{userId:uuid,conversationId:uuid,beforeId:uuid,before:'2026-11-10T12:00:00Z',direction:'all'}),null);
  const row={id:uuid,conversation_id:uuid,created_at:'2026-11-10T12:00:00Z',sender_id:uuid,body:'text'};
  const packet={userId:uuid,conversationId:uuid,messages:[row],readAt:'',epoch:1};
  assert.ok(read('history:write',packet));
  assert.equal(read('history:write',{...packet,messages:[{...row,conversation_id:'11111111-1111-4111-8111-111111111111'}]}),null);
  assert.equal(read('history:write',{...packet,epoch:-1}),null);
  assert.equal(read('history:write',{...packet,messages:Array(501).fill(row)}),null);
  assert.equal(read('history:wipe',{userId:uuid,path:'/data/data/other'}),null);
  assert.equal(read('history:limit',{userId:uuid,limit:'unlimited'}),null);
  assert.ok(read('history:wipe',{userId:uuid}));
  assert.ok(read('history:limit',{userId:uuid,limit:'500'}));
});
