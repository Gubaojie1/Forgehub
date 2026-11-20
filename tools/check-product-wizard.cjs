const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
// Run from tools/ with Playwright installed, or set PLAYWRIGHT_MODULE to its package path.
// This test uses a standalone copy of the actual component and fictitious data only.
const project = process.env.FORGEHUB_ROOT || path.resolve(__dirname, '..');
const projectRequire = createRequire(path.join(project, 'package.json'));
const { build } = projectRequire('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const source = fs.readFileSync(process.argv[2] || path.join(project, 'app/FirmwareHub.tsx'), 'utf8');
  const component = source.slice(source.indexOf('function ActionModal('));
  const fixture = `
    import React, {useRef, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    const roleLabel = role => role;
    ${component}
    const member = {email:'member@example.test', displayName:'测试成员', role:'developer', status:'active', productIds:'p1'};
    const props = {
      mode:'editProduct', products:[], productFiles:[], releases:[], protocols:[],
      users:[member], ownerCandidates:[], currentUser:{email:'admin@example.test',isAdmin:true},
      selectedMember:null, selectedRelease:null, targetReleaseId:null, selectedProtocol:null,
      selectedTool:null, selectedProduct:{id:'p1',code:'TEST',name:'回归测试产品',owner:'负责人'}, selectedProductId:'p1',
      allHardwareVariants:[],allAssetTypes:[],selectedHardwareVariants:[{id:'h1',code:'HW1',mcu:'MCU'}],selectedAssetTypes:[],
      productFileCategory:'requirements',uploadMaxMb:200,busy:false,
      onCreateVersion:()=>{},onClose:()=>{},onSubmit:event=>{event.preventDefault(); window.submissions.push(Object.fromEntries(new FormData(event.currentTarget)));}
    };
    window.submissions=[];
    const root=createRoot(document.getElementById('root'));
    window.renderFixture=(overrides={})=>root.render(<ActionModal {...props} {...overrides}/>);
    window.renderFixture();
  `;
  const bundle = await build({stdin:{contents:fixture,loader:'tsx',resolveDir:project},bundle:true,write:false,format:'iife'});
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent('<style>.hidden{display:none}</style><div id="root"></div>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    for (let i=0;i<3;i++) await page.getByRole('button',{name:'下一步',exact:true}).click();
    const count = await page.evaluate(()=>window.submissions.length);
    console.log('submissions immediately after entering member step:',count);
    assert.equal(count,0,'Entering member assignment must not submit the product');
    const checkbox = page.locator('input[name="memberEmails"]');
    await checkbox.uncheck();
    assert.equal(await page.evaluate(()=>window.submissions.length),0);
    await page.evaluate(()=>window.renderFixture());
    assert.equal(await checkbox.isChecked(),false,'Background rerender must preserve choices');
    assert.equal(await page.evaluate(()=>window.submissions.length),0);
    await page.getByRole('button',{name:'上一步',exact:true}).click();
    await page.getByRole('button',{name:'下一步',exact:true}).click();
    assert.equal(await checkbox.isChecked(),false);
    assert.equal(await page.evaluate(()=>window.submissions.length),0);
    await page.getByRole('button',{name:'保存修改',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.submissions.length),1,'Explicit save submits once');
    assert.equal(await page.evaluate(()=>window.submissions[0].memberEmails),undefined,'Unchecked member is not submitted');
    await page.reload();
    await page.setContent('<style>.hidden{display:none}</style><div id="root"></div>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.locator('input[name="name"]').press('Enter');
    assert.equal(await page.evaluate(()=>window.submissions.length),0,'Enter on an earlier step must not save');
    await page.getByRole('button',{name:'下一步',exact:true}).click();
    await page.locator('input[name="mcu"]').fill('');
    await page.getByRole('button',{name:'下一步',exact:true}).click();
    assert.equal(await page.locator('.wizard-panel:not(.hidden) input[name="mcu"]').count(),1,'Required fields gate progression');
    await page.evaluate(()=>{window.submissions=[]; window.renderFixture({key:'owner',currentUser:{email:'owner@example.test',isAdmin:false}});});
    await page.getByRole('button',{name:'下一步',exact:true}).click();
    await page.getByRole('button',{name:'下一步',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.submissions.length),0,'Three-step owner wizard must not auto-submit either');
    await page.getByRole('button',{name:'保存修改',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.submissions.length),1);
    await page.evaluate(()=>{window.submissions=[]; window.renderFixture({key:'create',mode:'product'});});
    for(let i=0;i<3;i++) await page.getByRole('button',{name:'下一步',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.submissions.length),0,'Product creation also waits for explicit confirmation');
    await page.locator('input[name="memberEmails"]').check();
    await page.getByRole('button',{name:'创建产品',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.submissions.length),1);
    assert.equal(await page.evaluate(()=>window.submissions[0].memberEmails),'member@example.test');
    await page.evaluate(()=>{window.submissions=[]; window.renderFixture({key:'tool',mode:'editTool',selectedTool:{name:'测试工具',version:'1.0'}});});
    await page.getByRole('button',{name:'保存修改',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.submissions.length),1,'Other modal forms still submit normally');
    console.log('PASS: admin/owner/create wizards, member selection, rerender, explicit save, Enter, validation and other forms');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
