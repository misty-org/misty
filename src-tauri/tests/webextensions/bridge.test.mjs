// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../../src/infra/extensions/bridge.js',import.meta.url),'utf8');
const tick = () => new Promise(resolve=>setImmediate(resolve));
function fixture() {
  const values=Object.create(null), listeners=[], messages=[];
  const storage={
    async get(keys) { return structuredClone(Object.fromEntries(Object.entries(values).filter(([key])=>keys===null || keys.includes(key)))); },
    async set(writes) { const changes=Object.create(null); for(const [key,value] of Object.entries(writes)){changes[key]={oldValue:values[key],newValue:structuredClone(value)};values[key]=structuredClone(value);} listeners.forEach(listener=>listener(changes,'sync')); },
    async remove(keys) { const changes=Object.create(null); for(const key of keys){changes[key]={oldValue:values[key]};delete values[key];} listeners.forEach(listener=>listener(changes,'sync')); }
  };
  const window={webkit:{messageHandlers:{mistyExtensionSync:{postMessage:message=>messages.push(structuredClone(message))}}}};
  vm.runInNewContext(source,{window,browser:{storage:{sync:storage,onChanged:{addListener:listener=>listeners.push(listener)}}}});
  return {window,storage,messages,listeners,values};
}
test('local sync edits and deletions are forwarded; local/session storage are excluded',async()=>{
  const f=fixture();await tick();assert.equal(f.messages[0].kind,'sync-ready');f.messages.length=0;
  f.listeners[0]({secret:{newValue:'local-only'}},'local');f.listeners[0]({secret:{newValue:'session-only'}},'session');assert.equal(f.messages.length,0);
  await f.storage.set({color:'gray'});assert.deepEqual(f.messages[0].changes,{color:{value:'gray'}});
  await f.storage.remove(['color']);assert.deepEqual(f.messages[1].changes,{color:{deleted:true}});
});
test('replication uses real storage APIs, emits extension events, and suppresses echoes',async()=>{
  const f=fixture();await tick();f.messages.length=0;let extensionEvents=0;f.listeners.push(()=>extensionEvents++);
  await f.window.mistyApplySync({setting:{value:{b:2,a:1}}});assert.equal(extensionEvents,1);assert.equal(f.messages.length,0);
  await f.window.mistyApplySync({setting:{value:{a:1,b:2}}});assert.equal(extensionEvents,1);
  await f.window.mistyApplySync({setting:{deleted:true}});assert.equal(extensionEvents,2);assert.equal(f.messages.length,0);
});
test('reserved JavaScript property names remain ordinary extension keys',async()=>{
  const f=fixture();await tick();f.messages.length=0;
  await f.window.mistyApplySync(JSON.parse('{"__proto__":{"value":{"safe":true}}}'));
  assert.deepEqual(f.values.__proto__,{safe:true});assert.equal(Object.getPrototypeOf(f.values),null);assert.equal(f.messages.length,0);
  await f.storage.set(JSON.parse('{"__proto__":"changed"}'));assert.deepEqual(f.messages[0].changes,JSON.parse('{"__proto__":{"value":"changed"}}'));
});
