const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{build}=require('esbuild');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..'),appOrigin='http://127.0.0.1:5179',previewOrigin='http://127.0.0.1:5180';
const example=process.argv[2];if(!example)throw Error('Pass an HTML example path');
const html=fs.readFileSync(example,'utf8');
const state={productId:'p',productName:'睡眠调理机',canUpload:true,maxBytes:10485760,previewOrigin,prototypes:[{id:'g',name:'管理后台',current_version_id:'v1'}],versions:[{id:'v1',prototype_id:'g',version:'V2.3',file_name:'example.html',size:Buffer.byteLength(html),change_note:'交互原型',uploaded_by:'本地测试',created_at:'2026-11-04T00:00:00Z'},{id:'v2',prototype_id:'g',version:'V2.4',file_name:'example.html',size:Buffer.byteLength(html),change_note:'隔离测试',uploaded_by:'本地测试',created_at:'2026-11-04T00:00:01Z'}]};
(async()=>{
 const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{PrototypeWorkspace}from'./app/PrototypeWorkspace';createRoot(document.getElementById('root')).render(<PrototypeWorkspace productId="p"/>);`,loader:'tsx',resolveDir:root},bundle:true,write:false,outfile:'fixture.js',format:'iife',jsx:'automatic',alias:{'@':root}});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
 const css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}if(req.url.startsWith('/api/prototypes/versions/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({html,namespace:req.url.includes('v1')?'a'.repeat(64):'b'.repeat(64),versionId:req.url.includes('v1')?'v1':'v2'}));return;}if(req.url.startsWith('/api/prototypes')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state));return;}res.setHeader('Content-Type','text/html');res.end('<html><head><meta charset="utf-8"><style>'+fs.readFileSync(path.join(root,'app/globals.css'),'utf8')+'</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');});
 await new Promise(resolve=>server.listen(5179,'127.0.0.1',resolve));
 const gateway=spawn(process.execPath,[path.join(root,'tools/prototype-preview-server.cjs')],{env:{...process.env,HOST:'127.0.0.1',PORT:'5180',PROTOTYPE_APP_ORIGIN:appOrigin},stdio:'pipe'});
 let browser;
 try{
  await new Promise((resolve,reject)=>{gateway.stdout.once('data',resolve);gateway.once('error',reject);gateway.once('exit',code=>reject(Error('Gateway exited '+code)));});
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1500,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());return [appOrigin,previewOrigin].includes(u.origin)?route.continue():route.abort();});
  await page.goto(appOrigin);await page.addStyleTag({content:css});await page.getByRole('button',{name:'在线预览',exact:true}).first().click();
  const child=()=>page.frames().find(f=>f.url()==='about:srcdoc');await page.waitForFunction(()=>!!document.querySelector('iframe'));
  for(let n=0;n<50&&!child();n++)await new Promise(r=>setTimeout(r,100));assert.ok(child(),'prototype child exists');
  await child().locator('#tbody tr').first().waitFor();
  await child().evaluate(()=>{localStorage.setItem('regression','one');save();});
  assert.equal(await child().evaluate(()=>localStorage.getItem('regression')),'one');
  await child().evaluate(async()=>{await firmwareFileStore('put','test-file',new Blob(['test firmware']));if((await firmwareFileStore('get','test-file')).size!==13)throw Error('IDB file mismatch');});
  await child().locator('#navConfig').click();await child().locator('#configPage').waitFor({state:'visible'});
  await child().locator('#navScenes').click();await child().locator('#scenesPage').waitFor({state:'visible'});
  await child().locator('#navFirmware').click();await child().locator('#firmwarePage').waitFor({state:'visible'});
  await child().evaluate(()=>editFirmware(-1));
  await child().locator('#fwVersion').fill('TEST-1');
  await child().locator('#fwFile').setInputFiles({name:'test.bin',mimeType:'application/octet-stream',buffer:Buffer.from('firmware demo')});
  await child().locator('#fwSubmit').press('Enter');await child().locator('#overlay').waitFor({state:'hidden'});
  const firmwareDownload=page.waitForEvent('download');await child().evaluate(()=>downloadFirmware(0));assert.equal((await firmwareDownload).suggestedFilename(),'test.bin');
  await child().locator('#navUsage').click();await child().locator('#usagePage').waitFor({state:'visible'});
  const logDownload=page.waitForEvent('download');await child().evaluate(()=>downloadUsageLog(0));assert.match((await logDownload).suggestedFilename(),/\.log$/);
  assert.equal(await child().evaluate(()=>{try{return top.document.title}catch{return 'blocked'}}),'blocked','prototype cannot access main DOM');
  await page.getByRole('button',{name:'在线预览',exact:true}).nth(1).click();
  for(let n=0;n<50;n++){if(child()&&await child().evaluate(()=>document.readyState==='complete').catch(()=>false))break;await new Promise(r=>setTimeout(r,100));}
  await child().locator('#tbody tr').first().waitFor();assert.equal(await child().evaluate(()=>localStorage.getItem('regression')),null);
  assert.equal(await child().evaluate(async()=>await firmwareFileStore('get','test-file')),undefined);
  await child().evaluate(()=>localStorage.setItem('keep-second-version','yes'));
  await page.getByRole('button',{name:'在线预览',exact:true}).first().click();
  for(let n=0;n<50;n++){if(child()&&await child().evaluate(()=>document.readyState==='complete').catch(()=>false))break;await new Promise(r=>setTimeout(r,100));}
  await child().locator('#tbody tr').first().waitFor();assert.equal(await child().evaluate(()=>localStorage.getItem('regression')),'one');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'重置演示数据'}).click();await page.getByText('演示数据已重置',{exact:true}).waitFor();
  await child().locator('#tbody tr').first().waitFor();assert.equal(await child().evaluate(()=>localStorage.getItem('regression')),null);assert.equal(await child().evaluate(async()=>await firmwareFileStore('get','test-file')),undefined);
  const outer=page.frames().find(f=>f.url().startsWith(previewOrigin));assert.equal(await outer.evaluate(()=>localStorage.getItem('fh-proto:'+ 'b'.repeat(64)+':keep-second-version')),'yes','reset must preserve other version');
  await page.screenshot({path:path.join(root,'../prototype-preview-test.png'),fullPage:true});assert.deepEqual(errors,[]);
  console.log('PASS: supplied HTML renders; navigation, localStorage, IndexedDB blobs, version isolation, persistence, reset and main-origin separation verified.');
 }finally{await browser?.close();gateway.kill();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
