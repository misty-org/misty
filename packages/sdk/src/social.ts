import {mistySocialContracts,type MistySocialOperation} from '@misty/contracts';
import type {MistyCall,MistyAppTransport} from './transport.js';
export function createSocialSDK(call:MistyCall,transport:MistyAppTransport){return {
 subscribe(listener:(event:{name:string;detail:unknown})=>void){if(!transport.subscribe)throw new Error('Social events are unavailable.');return transport.subscribe('social',event=>{if(!event||typeof event!=='object'||!('name' in event)||typeof event.name!=='string'||!('detail' in event))return;listener({name:event.name,detail:event.detail});});},
 async perform(operation:MistySocialOperation,args:unknown[]){const c=mistySocialContracts['social.perform'];return c.result.parse(await call('social.perform',c.params.parse({operation,args})));},
 async openNode(spaceId:string,nodeId:string){const c=mistySocialContracts['social.openNode'];return c.result.parse(await call('social.openNode',c.params.parse({spaceId,nodeId})));},
 async read(operation:'memberAvatar'|'attachmentContent',spaceId:string,id:string){const c=mistySocialContracts['social.read'];return c.result.parse(await call('social.read',c.params.parse({operation,spaceId,id})));}
};}
export type MistySocialSDK=ReturnType<typeof createSocialSDK>;
