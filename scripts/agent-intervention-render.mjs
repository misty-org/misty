/** Render shipped user-action controls with deterministic API responses. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
const root=process.cwd();
const temporary=await fs.mkdtemp(path.join(root,'.intervention-preview-'));
const artifacts='/tmp/misty-intervention-preview';await fs.mkdir(artifacts,{recursive:true});
const fixture={id:'10000000-0000-4000-8000-000000000001',runId:'invocation_fixture',scopeId:'scope-personal',deviceId:'personal-mac',targetLabel:'Personal inbox · 健康',action:'sign_in',reason:'Sign in to your personal inbox on the original Mac. Keep your work account in its separate profile.',state:'pending',expiresAt:'2099-01-01T00:00:00Z'};
await fs.writeFile(path.join(temporary,'index.html'),'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
await fs.writeFile(path.join(temporary,'entry.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import '/src/styles/styles.css';import {AgentInterventions} from '/src/features/agent-interventions/AgentInterventions';
const original=window.fetch;let waits=[${JSON.stringify(fixture)}];
window.fetch=async(input,init)=>{if(String(input).includes('/me/agent-interventions')){if(init?.method==='POST'){waits=[];return new Response(JSON.stringify({queued:true}),{status:202});}return new Response(JSON.stringify({waits}),{status:200});}return original(input,init);};
const onCount=()=>{};createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-3xl px-4 py-5"><h1 className="text-lg font-medium text-cream-bright">Activity</h1><AgentInterventions accountId="preview" onCount={onCount}/></main>);
`);
let server,browser;
try{
 server=await createServer({root,mode:'web',server:{host:'127.0.0.1',port:5188,strictPort:false},optimizeDeps:{entries:[path.join(temporary,'index.html')]},logLevel:'error'});await server.listen();
 const {chromium}=await import(process.env.MISTY_PLAYWRIGHT_MODULE||'playwright');browser=await chromium.launch({headless:true,executablePath:process.env.MISTY_CHROMIUM_EXECUTABLE});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [name,width,height]of[['desktop',1100,900],['mobile',390,844]]){
  await page.setViewportSize({width,height});await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${path.basename(temporary)}/index.html`);
  const button=page.getByRole('button',{name:"I've finished — continue",exact:true});await button.waitFor({timeout:10000});
  await page.screenshot({path:path.join(artifacts,name+'.png'),fullPage:true});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Viewport overflow');
  if((await button.boundingBox()).height<44)throw Error('Touch target too small');
 }
 await page.getByRole('button',{name:"I've finished — continue",exact:true}).click();
 await page.getByRole('status').filter({hasText:'Your response was saved'}).waitFor();
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({artifacts,checked:['desktop','mobile','overflow','touch targets','trusted response confirmation']}));
}finally{await browser?.close();await server?.close();await fs.rm(temporary,{recursive:true,force:true});}
