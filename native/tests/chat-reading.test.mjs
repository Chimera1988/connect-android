import assert from 'node:assert/strict';
import test from 'node:test';
import {chatReadingEntry,latestVisibleIncoming} from '../src/ConnectNativeChatReading.ts';

const message=(id,sender='peer',deleted_at=null)=>({id,sender_id:sender,created_at:`2026-11-09T10:00:0${id}.000Z`,deleted_at});
const rows=[message('1'),message('2'),message('3'),message('4'),message('5')];

test('opens above the first unread message rather than acknowledging the latest history',()=>{
  assert.deepEqual(chatReadingEntry(rows,'me',rows[1].created_at,[]),{anchorId:'2',firstUnreadId:'3'});
  assert.equal(latestVisibleIncoming(rows,'me',['2','3']),rows[2].created_at);
  assert.notEqual(latestVisibleIncoming(rows,'me',['2','3']),rows[4].created_at);
});

test('opening a cleared chat skips hidden and deleted messages for unread positioning',()=>{
  const messages=[...rows.slice(0,3),message('4','peer','2026-11-09T10:02:00Z'),rows[4]];
  assert.deepEqual(chatReadingEntry(messages,'me','', ['3'],rows[1].created_at),{anchorId:'4',firstUnreadId:'5'});
  assert.equal(latestVisibleIncoming(messages,'me',['4']),null);
});

test('my latest sent message anchors the view without acknowledging offscreen peer messages',()=>{
  const messages=[...rows,message('6','me')];
  assert.deepEqual(chatReadingEntry(messages,'me',rows[0].created_at,[]),{anchorId:'6',firstUnreadId:'2'});
  assert.equal(latestVisibleIncoming(messages,'me',['6']),null);
});

test('no receipt exists for an empty viewport and an empty history has no anchor',()=>{
  assert.equal(latestVisibleIncoming(rows,'me',[]),null);
  assert.deepEqual(chatReadingEntry([],'me','',[]),{anchorId:null,firstUnreadId:null});
});

test('equivalent Postgres and JavaScript timestamp spellings share the same read boundary',()=>{
  assert.deepEqual(chatReadingEntry(rows,'me','2026-11-09T10:00:02+00:00',[]),{anchorId:'2',firstUnreadId:'3'});
});
