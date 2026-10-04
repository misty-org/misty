import { beforeEach, expect, it, vi } from "vitest";
const fixture=vi.hoisted(()=>({turn:0, plans:0, completeAfter:1, calls:[] as Array<{name:string;input:any}>, completions:[] as any[], failAction:false, failFrame:false, staleAction:false}));
const usage={inputTokens:1,outputTokens:1,totalTokens:2,inputTokenDetails:{},outputTokenDetails:{}};
vi.mock("workflow",()=>({getWorkflowMetadata:()=>({workflowRunId:"runtime"}),FatalError:class extends Error{},RetryableError:class extends Error{},defineHook:()=>({})}));
vi.mock("../src/control-plane.js",()=>({controlPlaneRequest:async (_:unknown,operation:string,body:any)=>{
  if(operation==="context")return {model_id:"fixture/model",system:"",prompt:"Draw a house",allowed_tools:["browser.visual","browser.interact"]};
  if(operation==="complete")fixture.completions.push(body);
  if(operation==="steering")return {messages:[],closed:true};
  if(operation==="budget")return {version:1,active:true,remaining_ms:10000,deadline:new Date(Date.now()+10000).toISOString()};
  return {};
}}));
vi.mock("../src/midscene-browser.js",()=>({planMidsceneBrowserAction:async ()=>{
  const step=fixture.plans++;
  return {complete:step===fixture.completeAfter,message:step===fixture.completeAfter?"House visible":"Draw wall",description:"Draw wall",consequential:false,
    ...(step<fixture.completeAfter?{action:{kind:"drag",fromX:0.2,fromY:0.2,toX:0.6,toY:0.6}}:{}),
    usage:{inputTokens:10,outputTokens:5,totalTokens:15,inputTokenDetails:{},outputTokenDetails:{}}};
}}));
vi.mock("../src/mcp-runtime.js",()=>({
  discoverRemoteMCPTools:async()=>({supported:true,tools:["browser.visual","browser.interact"].map(name=>({name,description:name,inputSchema:{type:"object",properties:{native:{const:"native"}}}}))}),
  requestMCPToolExecution:async (_:unknown,__:unknown,___:unknown,name:string,input:any)=>{
    fixture.calls.push({name,input});
    if(name==="browser.interact"&&fixture.staleAction){fixture.staleAction=false;return {result:{status:"failure",reason:"browser_snapshot_stale",attempted:false}};}
    if((name==="browser.interact"&&fixture.failAction)||(name==="browser.visual"&&fixture.failFrame))return {tool_error:{code:"permission_denied",message:"Control stopped"}};
    return {result:name==="browser.visual"?{documentId:`doc-${fixture.calls.length}`,image:{width:100,height:100,dataUrl:"data:image/png;base64,YQ=="}}:{ok:true}};
  },
}));
vi.mock("@ai-sdk/workflow",()=>({WorkflowAgent:class{
  constructor(private options:any){}
  async stream(){
    const name=fixture.turn++===0?"misty_browser_act":"misty_finish_task";
    const input=name==="misty_browser_act"?{scopeId:"scope-123",instruction:"Draw a house"}:{outcome:"completed",summary:"House drawn",remaining:[]};
    const call={toolCallId:`call-${fixture.turn}`,toolName:name,input};
    expect(this.options.prepareStep().activeTools).toContain(name);
    await this.options.onToolExecutionStart({toolCall:call});
    const output=await this.options.tools[name].execute(input,{toolCallId:call.toolCallId});
    await this.options.onToolExecutionEnd({toolCall:call,success:true,durationMs:1,output});
    return {steps:[{text:"",content:[{type:"tool-call",toolName:name},{type:"tool-result",toolName:name,output}]}],messages:[],finishReason:"tool-calls",totalUsage:usage};
  }
}}));
import {runSpaceTaskAgent} from "../workflows/space-task-agent.js";
import {unconfirmedToolResultReason} from "../src/tool-outcomes.js";
beforeEach(()=>{fixture.turn=0;fixture.plans=0;fixture.completeAfter=1;fixture.calls=[];fixture.completions=[];fixture.failAction=false;fixture.failFrame=false;fixture.staleAction=false;});
it("dispatches through authorized tools and requires another screenshot before completion",async()=>{
  await runSpaceTaskAgent({mistyRunId:"run",controlPlaneURL:"https://api.test"});
  expect(fixture.calls.map(x=>x.name)).toEqual(["browser.visual","browser.interact","browser.visual"]);
  expect(fixture.calls[1]?.input).toMatchObject({documentId:"doc-1",scopeId:"scope-123",action:{kind:"native",input:{kind:"drag"}}});
  expect(fixture.completions[0]).toMatchObject({status:"success",usage:{totalTokens:34}});
});
it("stops after denied input instead of planning or reporting completion",async()=>{
  fixture.failAction=true;
  await expect(runSpaceTaskAgent({mistyRunId:"run",controlPlaneURL:"https://api.test"})).rejects.toThrow();
  expect(fixture.plans).toBe(1);
  expect(fixture.completions[0].status).not.toBe("success");
});
it("does not plan or act without an authorized screenshot",async()=>{
  fixture.failFrame=true;
  await expect(runSpaceTaskAgent({mistyRunId:"run",controlPlaneURL:"https://api.test"})).rejects.toThrow();
  expect(fixture.plans).toBe(0);
  expect(fixture.calls).toHaveLength(1);
  expect(fixture.completions[0].status).not.toBe("success");
});

it("can verify completion after the final allowed action",async()=>{
  fixture.completeAfter=24;
  await runSpaceTaskAgent({mistyRunId:"run",controlPlaneURL:"https://api.test"});
  expect(fixture.calls.filter(x=>x.name==="browser.interact")).toHaveLength(24);
  expect(fixture.calls.filter(x=>x.name==="browser.visual")).toHaveLength(25);
  expect(fixture.plans).toBe(25);
  expect(fixture.completions[0].status).toBe("success");
});

it("reobserves after an explicit stale rejection before any input was attempted",async()=>{
  fixture.staleAction=true;fixture.completeAfter=2;
  await runSpaceTaskAgent({mistyRunId:"run",controlPlaneURL:"https://api.test"});
  expect(fixture.calls.map(x=>x.name)).toEqual(["browser.visual","browser.interact","browser.visual","browser.interact","browser.visual"]);
  expect(fixture.calls[3]?.input.documentId).toBe("doc-3");
  expect(fixture.completions[0].status).toBe("success");
});

it("reports the actual bounded Midscene failure reason",()=>{
 expect(unconfirmedToolResultReason({status:"failure",tool_error:{message:"This run reached its model-turn limit."}})).toBe("This run reached its model-turn limit.");
 expect(unconfirmedToolResultReason({status:"failure",tool_error:{message:"x".repeat(800)}})).toHaveLength(500);
});
