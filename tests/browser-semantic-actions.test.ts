import { describe, expect, it } from "vitest";
import { MistyProviderRouteSchema, MistyBrowserCapabilityBindingSchema, MistyTaskCreateInputSchema, mistyTaskCapabilities, mistyInboxCapabilities } from "../packages/contracts/src/index.js";
const uuid="10000000-0000-4000-8000-000000000001";
describe("versioned semantic browser actions",()=>{
 it("requires a versioned adapter declaration without treating a binding as identity proof",()=>{
  const route={kind:"browser",origins:["https://mail.google.com"],adapter:"gmail",adapterVersion:1};
  expect(MistyProviderRouteSchema.safeParse(route).success).toBe(true);
  expect(MistyProviderRouteSchema.safeParse({...route,adapterVersion:undefined}).success).toBe(false);
  expect(MistyProviderRouteSchema.safeParse({...route,adapter:undefined}).success).toBe(false);
  expect(MistyBrowserCapabilityBindingSchema.parse({kind:"browser",deviceId:uuid,profileId:"a".repeat(64),accountBindingId:uuid,origins:route.origins,scopeId:"browser-original",accountIdentity:"owner@example.com"}).accountIdentity).toBe("owner@example.com");
 });
 it("requires an identified destination and source with bounded, lossless task content",()=>{
  const input={title:"Follow up",text:"Reply to the request",destination:{targetId:uuid,containerReference:"https://app.todoist.com/app/project/1",label:"Work"},source:{reference:"https://mail.google.com/#inbox/1",label:"Email"},dueDate:"2026-09-10"};
  expect(MistyTaskCreateInputSchema.parse(input)).toEqual(input);
  for(const invalid of [{...input,destination:"Todoist"},{...input,dueDate:"next Thursday"},{...input,source:undefined},{...input,title:" leading whitespace"},{...input,text:"a".repeat(20001)}]) expect(MistyTaskCreateInputSchema.safeParse(invalid).success).toBe(false);
 });
 it("reserves one task contract for both browser and server implementations",()=>{
  expect(mistyTaskCapabilities[0].name).toBe("tasks.create");
  expect(mistyTaskCapabilities[0].effects).toMatchObject({approval:"interactive",retry:"reconcile"});
  expect(mistyInboxCapabilities.find(c=>c.name==="inbox.send")?.effects.retry).toBe("reconcile");
 });
});
