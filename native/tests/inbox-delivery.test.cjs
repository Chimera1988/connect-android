const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const firstChat = '11111111-1111-4111-8111-111111111111';
const secondChat = '22222222-2222-4222-8222-222222222222';
const owner = 'self';
const at = second => `2026-11-09T08:00:${String(second).padStart(2, '0')}.000Z`;
const message = (conversation_id, sender_id, second) => ({conversation_id, sender_id, created_at:at(second), deleted_at:null});
const tick = () => new Promise(resolve => setImmediate(resolve));

// Execute the real inbox hook with query/native boundaries stubbed. These tests
// verify delivery semantics; they do not claim a connection to a live database.
function harness(messages = [], reads = []) {
  const effects = [], intervals = [], writes = [];
  const state = {currentState:'active', addEventListener:() => ({remove(){}})};
  const data = {messages, reads, failure:false, queries:0};
  const db = {
    from(table) {
      return {
        select() {
          data.queries++;
          const query = {
            in() {return table === 'messages' ? query : Promise.resolve({data:data.reads, error:null});},
            eq() {return query;}, order() {return query;},
            limit() {return Promise.resolve({data:data.messages, error:null});},
          };
          return query;
        },
        upsert(row, options) {
          writes.push({row, options});
          return Promise.resolve({error:data.failure ? new Error('offline') : null});
        },
      };
    },
    channel() {const channel = {on(){return channel;}, subscribe(){return channel;}}; return channel;},
    removeChannel() {return Promise.resolve();},
  };
  const stubs = {
    react:{useState:() => [{}, () => {}], useRef:initial => ({current:initial}), useMemo:fn => fn(), useEffect:fn => effects.push(fn)},
    'react-native':{AppState:state}, './backend':{db, MESSAGE_COLUMNS:'*'},
  };
  const source = readFileSync(path.join(__dirname, '../src/ConnectNativeInbox.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {if (!(name in stubs)) throw Error(name); return stubs[name];},
    console:{warn(){}}, setTimeout, clearTimeout,
    setInterval(fn) {intervals.push(fn); return intervals.length;}, clearInterval(){},
  }, {filename:'ConnectNativeInbox.js'});
  exports.useConnectNativeInbox(owner, [{id:firstChat}, {id:secondChat}]);
  const cleanups = effects.map(fn => fn());
  return {
    state, data, writes,
    async poll() {intervals.forEach(fn => fn()); await tick();},
    dispose() {cleanups.forEach(fn => fn?.());},
  };
}

test('acknowledges only the newest incoming message per chat and never marks it read', async t => {
  const h = harness([message(firstChat, 'peer', 11), message(firstChat, 'peer', 10), message(firstChat, owner, 12), message(secondChat, owner, 14)]);
  t.after(h.dispose);
  await tick();
  assert.equal(h.writes.length, 1);
  const {row, options} = h.writes[0];
  assert.deepEqual(Object.keys(row).sort(), ['conversation_id', 'last_delivered_at', 'user_id']);
  assert.equal(row.conversation_id, firstChat);
  assert.equal(row.user_id, owner);
  assert.equal(row.last_delivered_at, at(11));
  assert.equal(options.onConflict, 'conversation_id,user_id');
});

test('deduplicates successful delivery receipts and retries failed writes', async t => {
  const h = harness([message(firstChat, 'peer', 11)]);
  t.after(h.dispose);
  await tick();
  await h.poll();
  assert.equal(h.writes.length, 1);
  h.data.messages = [message(firstChat, 'peer', 15)];
  h.data.failure = true;
  await h.poll();
  assert.equal(h.writes.length, 2);
  h.data.failure = false;
  await h.poll();
  assert.equal(h.writes.length, 3);
  await h.poll();
  assert.equal(h.writes.length, 3);
});

test('preserves a newer delivery or read timestamp already acknowledged by another device', async t => {
  const h = harness([message(firstChat, 'peer', 20), message(secondChat, 'peer', 20)], [
    {conversation_id:firstChat, last_read_at:null, last_delivered_at:at(30)},
    {conversation_id:secondChat, last_read_at:at(35), last_delivered_at:null},
  ]);
  t.after(h.dispose);
  await tick();
  assert.equal(h.writes.length, 0);
});

test('pauses inbox fetching and delivery while backgrounded and resumes when active', async t => {
  const h = harness([message(firstChat, 'peer', 11)]);
  t.after(h.dispose);
  await tick();
  h.state.currentState = 'background';
  h.data.messages = [message(firstChat, 'peer', 40)];
  const queryCount = h.data.queries;
  await h.poll();
  assert.equal(h.writes.length, 1);
  assert.equal(h.data.queries, queryCount);
  h.state.currentState = 'active';
  await h.poll();
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].row.last_delivered_at, at(40));
});

test('unmounted inbox cannot acknowledge a pending fetch', async () => {
  const h = harness([message(firstChat, 'peer', 11)]);
  h.dispose();
  await tick();
  assert.equal(h.writes.length, 0);
});
