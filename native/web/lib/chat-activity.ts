export type ChatActivityKind = 'typing'|'voice'|'video'|'sticker'|'file';
export type PeerActivity = {chat:string;kind:string;until:number};

/** Video is advertised only after MediaRecorder actually begins recording. */
export function composerActivity(videoRecording:boolean,stickerPicker:boolean,filePickerOpen:boolean): ChatActivityKind|null {
  if(videoRecording)return 'video';
  if(stickerPicker)return 'sticker';
  if(filePickerOpen)return 'file';
  return null;
}

/** Do not leak a stale status when switching to a different conversation. */
export function visiblePeerActivity(peer:PeerActivity|null,activeChat:string|null,now:number): ChatActivityKind|null {
  if(!peer || !activeChat || peer.chat!==activeChat || !Number.isFinite(peer.until) || peer.until<=now)return null;
  return ['typing','voice','video','sticker','file'].includes(peer.kind)?peer.kind as ChatActivityKind:null;
}

/** The mobile OS can suspend JavaScript while its system file picker is open. */
export function activityTtl(kind:string|null):number { return kind==='file'?60000:8000; }

/** A native recording belongs to the chat where capture was requested. */
export function nativeVideoActivity(recording:boolean,startedChat:string|null,currentChat:string|null):boolean{
  return recording&&Boolean(startedChat)&&startedChat===currentChat;
}
