// Standalone preview origin. No application credentials, database or uploaded
// files are available to this process. HTML arrives only through postMessage.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
function appOrigins() {
  const raw = process.env.PROTOTYPE_APP_ORIGINS || process.env.PROTOTYPE_APP_ORIGIN || 'http://localhost:3000';
  const origins = raw.split(',').map((item) => item.trim()).filter(Boolean).map((item) => new URL(item).origin);
  return [...new Set(origins)];
}
const allowedOrigins = appOrigins();
const appOriginList = allowedOrigins.join(',');
const files = { '/': ['host.html','text/html; charset=utf-8'], '/host.js': ['host.js','text/javascript; charset=utf-8'], '/runtime.js': ['runtime.js','text/javascript; charset=utf-8'] };
const server = http.createServer((req,res)=>{
  const pathname = new URL(req.url,'http://preview.invalid').pathname;
  if(req.method!=='GET' && req.method!=='HEAD') {res.writeHead(405);res.end();return;}
  if(pathname==='/health') {res.writeHead(200,{'Content-Type':'text/plain'});res.end('prototype-preview-v1');return;}
  const file=files[pathname];
  if(!file) {res.writeHead(404);res.end('Not found');return;}
  let body=fs.readFileSync(path.join(__dirname,'prototype-preview',file[0]),'utf8');
  if(pathname==='/') body=body.replace('__APP_ORIGIN__',appOriginList.replaceAll('&','&amp;').replaceAll('"','&quot;'));
  // frame-ancestors checks every ancestor. A public share can sit inside
  // another site, so the preview host cannot list only the application origins.
  // Prototype HTML still arrives only by postMessage from those origins.
  res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':`default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src data: blob: https: http:; font-src data:; media-src data: blob:; frame-src 'self' blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors *`});
  res.end(req.method==='HEAD'?undefined:body);
});
server.listen(Number(process.env.PORT || 3081),process.env.HOST || '127.0.0.1',()=>console.log(`Prototype preview listening on ${JSON.stringify(server.address())}; parents ${appOriginList}`));
