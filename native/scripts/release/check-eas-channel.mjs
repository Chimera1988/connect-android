import {readFileSync} from 'node:fs';
const channel=JSON.parse(readFileSync('verification/parity/eas-channel.json','utf8')).currentPage;
if(channel?.name!=='production'||!channel.id||channel.isPaused)throw Error('Active production EAS channel not found');
const mapping=JSON.parse(channel.branchMapping);
if(mapping.version!==0||mapping.data?.length!==1||!channel.updateBranches?.some(b=>b.id===mapping.data[0].branchId))
 throw Error('Production channel requires one verified target branch; do not remap it automatically');
