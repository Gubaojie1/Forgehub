(() => {
  'use strict';
  const namespace=document.currentScript.dataset.namespace;
  const prefix='fh-proto:'+namespace+':';
  try {
    // Browser-native persistence is retained. Namespace shims prevent accidental
    // collisions in AI-generated prototypes; they are not a hostile-code boundary.
    for(const name of ['localStorage','sessionStorage']) {
      const native=window[name];
      const keys=()=>Object.keys(native).filter(key=>key.startsWith(prefix)).map(key=>key.slice(prefix.length));
      const methods={ getItem:key=>native.getItem(prefix+String(key)), setItem:(key,value)=>native.setItem(prefix+String(key),String(value)), removeItem:key=>native.removeItem(prefix+String(key)), clear:()=>keys().forEach(key=>native.removeItem(prefix+key)), key:index=>keys()[Number(index)]??null };
      const storage=new Proxy(Object.create(null),{
        get:(_,key)=>key==='length'?keys().length: key in methods?methods[key]: typeof key==='string'?native.getItem(prefix+key)??undefined:undefined,
        set:(_,key,value)=>{native.setItem(prefix+String(key),String(value));return true;},
        deleteProperty:(_,key)=>{native.removeItem(prefix+String(key));return true;},
        ownKeys:()=>keys(),getOwnPropertyDescriptor:(_,key)=>keys().includes(key)?{enumerable:true,configurable:true,value:native.getItem(prefix+key)}:undefined,
      });
      Object.defineProperty(window,name,{value:storage,configurable:false});
    }
    const factory=indexedDB;
    const open=factory.open.bind(factory),remove=factory.deleteDatabase.bind(factory),list=factory.databases?.bind(factory);
    factory.open=(name,version)=>version===undefined?open(prefix+String(name)):open(prefix+String(name),version);
    factory.deleteDatabase=name=>remove(prefix+String(name));
    if(list) factory.databases=async()=> (await list()).filter(db=>db.name?.startsWith(prefix)).map(db=>({...db,name:db.name.slice(prefix.length)}));
  } catch(error) {
    parent.postMessage({type:'prototype-storage-error'},'*');
  }
})();
