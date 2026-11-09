/** Shared read-boundary decisions. A receipt is a message timestamp, never wall-clock time. */
export type ReadableMessage={id:string;sender_id:string;created_at:string;deleted_at:string|null};

export function chatReadingEntry(messages:ReadableMessage[],ownerId:string,readAt:string,hiddenIds:readonly string[],clearedAt?:string|null){
  const displayed=messages.filter(m=>!hiddenIds.includes(m.id)&&(!clearedAt||Date.parse(m.created_at)>Date.parse(clearedAt)));
  const unread=displayed.findIndex(m=>!m.deleted_at&&m.sender_id!==ownerId&&(!readAt||Date.parse(m.created_at)>Date.parse(readAt)));
  const last=displayed.at(-1);
  const anchor=last?.sender_id===ownerId?last:unread>=0?displayed[Math.max(0,unread-1)]:last;
  return {anchorId:anchor?.id||null,firstUnreadId:unread>=0?displayed[unread].id:null};
}

export function latestVisibleIncoming(messages:ReadableMessage[],ownerId:string,visibleIds:readonly string[]){
  return [...messages].reverse().find(m=>!m.deleted_at&&m.sender_id!==ownerId&&visibleIds.includes(m.id))?.created_at||null;
}
