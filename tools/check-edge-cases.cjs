// Read-only source audit: actual route bodies, isolated in-memory SQLite, fake users.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createRequire } = require('node:module');
const root = process.env.FORGEHUB_ROOT || path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
const read = p => { const staged = process.env.FORGEHUB_PATCH_ROOT && path.join(process.env.FORGEHUB_PATCH_ROOT, p); return fs.readFileSync(staged && fs.existsSync(staged) ? staged : path.join(root, p), 'utf8'); };
const compile = source => ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const schema = [...read('lib/storage.ts').matchAll(/db\.prepare\("(CREATE TABLE IF NOT EXISTS [^"]+)"\)/g)].map(m=>m[1]);
const access = {email:'admin@example.test',displayName:'Audit Admin',isAdmin:true,isSystemOwner:false,ownedProductIds:[],productIds:[],canCreateProduct:true};
function environment() {
  const sql = new DatabaseSync(':memory:');
  for(const s of schema) sql.exec(s);
  function prepare(query, values=[]) {
    return {bind:(...v)=>prepare(query,v),first:async()=>sql.prepare(query).get(...values)??null,
      all:async()=>({results:sql.prepare(query).all(...values)}),
      run:async()=>({meta:{changes:Number(sql.prepare(query).run(...values).changes)}}),
      execute:()=> /^\s*SELECT/i.test(query) ? {results:sql.prepare(query).all(...values)} : {results:[],meta:{changes:Number(sql.prepare(query).run(...values).changes)}}};
  }
  const db = {prepare,batch:async statements=>{sql.exec('BEGIN');try{const r=statements.map(s=>s.execute());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const storage = {getD1:()=>db,getAccess:async()=>access,requireAccess:async()=>access,writeAudit:async()=>{},getSystemOwnerEmail:async()=>'owner@example.test',DEFAULT_UPLOAD_MAX_MB:200,
    AccessError:class extends Error{constructor(m,status=403){super(m);this.status=status;}}};
  function load(file) {
    const exports = {};
    vm.runInNewContext(compile(read(file)),{exports,require:n=>{assert.equal(n,'@/lib/storage');return storage;},Request,Response,Headers,File,FormData,crypto,console});
    return exports;
  }
  const insert=(table,values)=>{const cols=Object.keys(values);sql.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`).run(...Object.values(values));};
  return {sql,db,load,insert};
}
const ctx=id=>({params:Promise.resolve({id})});
const request=body=>new Request('http://audit.invalid/api',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function product(e) {
  e.insert('products',{id:'p',code:'P',name:'Product',family:'F',hw_versions:'HW1',owner:'Admin',owner_email:access.email,status:'研发',description:''});
  e.insert('hardware_variants',{id:'h-old',product_id:'p',code:'HW1',mcu:'MCU',flash_size:'1M',ram_size:'1M',pcb_version:'1',min_bootloader:'1',interfaces:'USB',created_at:'2026-01-01'});
}
function release(e,status='待终审') {
  e.insert('releases',{id:'r',product_id:'p',version:'1.0',build_number:'1',channel:'Beta',status,bootloader_version:'',app_version:'',protocol_summary:'',release_date:'2026-01-01',release_notes:'Notes'});
  e.insert('release_requests',{id:'q',release_id:'r',product_id:'p',summary:'Test',verification:'OK',requester:'Dev',status,created_at:'2026-01-01',assigned_tester_email:access.email});
}
function artifact(e,id,status) {
  e.insert('artifacts',{id,release_id:'r',product_id:'p',kind:'OTA-APP',name:id+'.bin',revision:'R1',object_key:id,size:1,sha256:'hash',status,active:0,uploaded_by:'Dev',created_at:'2026-01-01'});
}
async function check(name, fn){await fn();console.log('PASS:',name);}
(async()=>{
  await check('Saving product settings preserves hardware links',async()=>{
    const e=environment();product(e);
    e.insert('release_hardware_bindings',{release_id:'r',hardware_variant_id:'h-old'});
    const response=await e.load('app/api/products/[id]/route.ts').PATCH(request({code:'P',name:'Product',hardwareVariants:[{code:'HW1',mcu:'MCU'}],memberEmails:[]}),ctx('p'));
    assert.equal(response.status,200,await response.text());
    assert.equal(e.sql.prepare('SELECT COUNT(*) n FROM release_hardware_bindings').get().n,1);
    assert.equal(e.sql.prepare('SELECT COUNT(*) n FROM release_hardware_bindings b JOIN hardware_variants h ON h.id=b.hardware_variant_id').get().n,1);
    console.log('  binding rows=1, resolvable hardware=1');e.sql.close();
  });
  await check('Trial stays private; promotion becomes visible as formal release',async()=>{
    const e=environment();product(e);release(e);
    const response=await e.load('app/api/release-requests/[id]/route.ts').PATCH(request({action:'approve',scope:'trial'}),ctx('q'));
    assert.equal(response.status,200);
    const r=e.sql.prepare('SELECT status,channel FROM releases').get();assert.equal(r.channel,'小范围试用');assert.equal(r.status,'已发布');
    const adminEmail=access.email; const adminName=access.displayName; access.displayName='Outsider'; access.email='outsider@example.test'; access.isAdmin=false;
    const catalog=await e.load('app/api/catalog/route.ts').GET(new Request('http://audit.invalid'));
    access.displayName=adminName; access.email=adminEmail; access.isAdmin=true;
    const json=await catalog.json();assert.equal(catalog.status,200,JSON.stringify(json));
    assert.equal(json.releases.length,0);
    const source=read('app/api/catalog/route.ts');assert.ok(source.includes('item.channel === "正式发布"'));
    const promoted=await e.load('app/api/releases/[id]/scope/route.ts').PATCH(request({}),ctx('r'));
    assert.equal(promoted.status,200);
    assert.equal(e.sql.prepare('SELECT channel FROM releases').get().channel,'正式发布');
    access.displayName='Outsider'; access.email='outsider@example.test'; access.isAdmin=false;
    const formal=await (await e.load('app/api/catalog/route.ts').GET(new Request('http://audit.invalid'))).json();
    access.displayName=adminName; access.email=adminEmail; access.isAdmin=true;assert.equal(formal.releases.length,1);
    const repeat=await e.load('app/api/releases/[id]/scope/route.ts').PATCH(request({}),ctx('r'));assert.equal(repeat.status,200);
    console.log('  trial hidden; formal visible; repeated promotion harmless');e.sql.close();
  });
  await check('Hardware rename keeps its ID; removing referenced hardware is rejected',async()=>{
    const e=environment();product(e);
    e.insert('release_hardware_bindings',{release_id:'r',hardware_variant_id:'h-old'});
    const patch=e.load('app/api/products/[id]/route.ts').PATCH;
    let response=await patch(request({code:'P',name:'Product',hardwareVariants:[{id:'h-old',code:'RENAMED',mcu:'MCU'}]}),ctx('p'));
    assert.equal(response.status,200,await response.text());
    assert.equal(e.sql.prepare('SELECT id FROM hardware_variants WHERE code=?').get('RENAMED').id,'h-old');
    response=await patch(request({code:'P',name:'Product',hardwareVariants:[{code:'NEW',mcu:'MCU'}]}),ctx('p'));
    assert.equal(response.status,409);
    assert.equal(e.sql.prepare('SELECT COUNT(*) n FROM hardware_variants').get().n,1);e.sql.close();
  });
  await check('Final approval leaves historical firmware inactive',async()=>{
    const e=environment();release(e);artifact(e,'old','已替换');artifact(e,'new','待终审');
    const response=await e.load('app/api/release-requests/[id]/route.ts').PATCH(request({action:'approve'}),ctx('q'));
    assert.equal(response.status,200);const active=e.sql.prepare('SELECT id FROM artifacts WHERE active=1').all();assert.equal(active.length,1);assert.equal(active[0].id,'new');
    console.log('  active files='+active.map(a=>a.id).join(','));e.sql.close();
  });
  await check('Concurrent material approvals deduct stock once',async()=>{
    const e=environment();
    e.insert('surplus_materials',{id:'m',name:'Part',quantity:10,available_quantity:10,reserved_quantity:2,publisher_email:access.email,publisher_name:'Admin',created_at:'2026-01-01',updated_at:'2026-01-01'});
    e.insert('material_requests',{id:'mr',material_id:'m',requester_email:'dev@example.test',requester_name:'Dev',quantity:2,status:'待确认',created_at:'2026-01-01'});
    const patch=e.load('app/api/material-requests/[id]/route.ts').PATCH;
    const responses=await Promise.all([patch(request({action:'approve'}),ctx('mr')),patch(request({action:'approve'}),ctx('mr'))]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    const stock=e.sql.prepare('SELECT available_quantity FROM surplus_materials').get().available_quantity;
    assert.equal(stock,8);console.log('  stock expected=8, actual='+stock);e.sql.close();
  });
  await check('Approval versus cancellation has one winner and consistent stock',async()=>{
    for(const actions of [['approve','cancel'],['cancel','approve'],['reject','approve']]) {
      const e=environment();
      e.insert('surplus_materials',{id:'m',name:'Part',quantity:10,available_quantity:10,reserved_quantity:2,publisher_email:access.email,publisher_name:'Admin',created_at:'2026-01-01',updated_at:'2026-01-01'});
      e.insert('material_requests',{id:'mr',material_id:'m',requester_email:'dev@example.test',requester_name:'Dev',quantity:2,status:'待确认',created_at:'2026-01-01'});
      const patch=e.load('app/api/material-requests/[id]/route.ts').PATCH;
      const responses=await Promise.all(actions.map(action=>patch(request({action}),ctx('mr'))));
      assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
      const result=e.sql.prepare('SELECT status FROM material_requests').get();
      const stock=e.sql.prepare('SELECT available_quantity,reserved_quantity FROM surplus_materials').get();
      assert.equal(stock.available_quantity,result.status==='已同意'?8:10);assert.equal(stock.reserved_quantity,0);
      assert.equal((await patch(request({action:'approve'}),ctx('mr'))).status,409);e.sql.close();
    }
  });
  await check('Test result transitions preserve retired artifacts before formal publishing',async()=>{
    const e=environment();release(e,'测试中');artifact(e,'old','已替换');artifact(e,'older','已替代');artifact(e,'rejected','已驳回');artifact(e,'new','测试中');
    const patch=e.load('app/api/release-requests/[id]/route.ts').PATCH;
    let response=await patch(request({action:'pass',note:'Passed regression'}),ctx('q'));assert.equal(response.status,200);
    assert.equal(e.sql.prepare('SELECT status FROM artifacts WHERE id=?').get('old').status,'已替换');
    response=await patch(request({action:'approve',scope:'formal'}),ctx('q'));assert.equal(response.status,200);
    assert.equal(e.sql.prepare('SELECT COUNT(*) n FROM artifacts WHERE active=1').get().n,1);
    assert.equal(e.sql.prepare('SELECT channel FROM releases').get().channel,'正式发布');e.sql.close();
  });
  const hub=read('app/FirmwareHub.tsx');
  const helpers=hub.slice(hub.indexOf('function pendingApprovalIds'),hub.indexOf('export function FirmwareHub'));
  const loader=hub.slice(hub.indexOf('  async function loadCatalog'),hub.indexOf('  // The first request'));
  function loaderEnv(responses) {
    const previous={currentUser:{email:access.email,canApprove:true,canTest:true},replacements:[],releaseRequests:[],materialRequests:[]};
    const box={catalogRef:{current:previous},catalogRequestId:{current:0},initialRoleRoute:{current:true},authFetch:()=>responses.shift(),notices:[],setCatalog:r=>{box.rendered=r;},setLoadError:()=>{},setSyncError:()=>{},setLoading:()=>{},setView:()=>{},showRealtimeNotice:(...args)=>box.notices.push(args)};
    vm.createContext(box);vm.runInContext(compile(helpers+loader+'\nglobalThis.loadCatalog=loadCatalog;'),box);return box;
  }
  await check('Simultaneous events produce all notifications once',async()=>{
    const data={currentUser:{email:access.email,canApprove:true,canTest:true},replacements:[{id:'rep',status:'待审批'}],releaseRequests:[],materialRequests:[{id:'mr',status:'待确认',publisherEmail:access.email,requesterEmail:'dev@example.test'}]};
    const box=loaderEnv([Promise.resolve(Response.json(data)),Promise.resolve(Response.json(data))]);
    await box.loadCatalog(true);await box.loadCatalog(true);
    assert.equal(box.notices.length,2);assert.equal(box.notices[0][1],'approvals');assert.equal(box.notices[1][1],'materials');console.log('  approval and material both notified once');
  });
  await check('Late old catalog responses cannot overwrite new data',async()=>{
    let resolveOld;const older=new Promise(r=>resolveOld=r);
    const base={currentUser:{email:access.email},replacements:[],releaseRequests:[],materialRequests:[]};
    const box=loaderEnv([older,Promise.resolve(Response.json({...base,revision:2}))]);
    const a=box.loadCatalog();await box.loadCatalog();assert.equal(box.rendered.revision,2);
    resolveOld(Response.json({...base,revision:1}));await a;assert.equal(box.rendered.revision,2);
    console.log('  displayed revision remains 2 after old request completed');
  });
  await check('Concurrent self-hosted batches do not overlap transactions',async()=>{
    const source=read('lib/cloudflare-workers-selfhost.ts');
    const classes=source.slice(source.indexOf('type SqlValue'),source.indexOf('type ObjectMetadata'));
    const box={DatabaseSync,mkdirSync:()=>{},path};vm.createContext(box);vm.runInContext(compile(classes+'\nglobalThis.Db=LocalD1Database;'),box);
    const d=new box.Db(':memory:');
    const results=await Promise.allSettled([d.batch([d.prepare('SELECT 1')]),d.batch([d.prepare('SELECT 2')])]);
    assert.equal(results.every(r=>r.status==='fulfilled'),true,JSON.stringify(results));console.log('  both batches committed');
    await d.prepare('CREATE TABLE rollback_test (id INTEGER PRIMARY KEY)').run();
    await assert.rejects(d.batch([d.prepare('INSERT INTO rollback_test VALUES (1)'),d.prepare('INSERT INTO rollback_test VALUES (1)')]));
    assert.equal((await d.prepare('SELECT COUNT(*) n FROM rollback_test').first()).n,0);
    await d.batch([d.prepare('INSERT INTO rollback_test VALUES (2)')]);
    assert.equal((await d.prepare('SELECT COUNT(*) n FROM rollback_test').first()).n,1);
  });
  console.log('All ten isolated regression groups passed. No application or production data changed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
