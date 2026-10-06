/** No npm install required. Local mode (default) binds loopback with LOCAL_DEV. NODE_ENV=production or an https non-loopback APP_ORIGIN runs the Worker's production config on Node (GoDaddy): HOST/PORT, APP_ORIGIN required, no LOCAL_DEV. */
import { createServer } from 'node:http';
import { readFile,stat,mkdir } from 'node:fs/promises';
import { resolve,extname,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './node-db.mjs';
import { handle } from './worker.js';
import { config } from './security.js';
import { maintenance } from './matches.js';
const root=fileURLToPath(new URL('../',import.meta.url));
try{process.loadEnvFile(resolve(root,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
const port=Number(process.env.PORT||8787);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT.');
// GoDaddy's runtime may not set NODE_ENV, so an https non-loopback APP_ORIGIN also selects production mode.
const remoteOrigin=(()=>{try{const u=new URL(process.env.APP_ORIGIN);return u.protocol==='https:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname);}catch{return false;}})();
const prod=process.env.NODE_ENV==='production'||remoteOrigin,trustProxy=process.env.TRUST_PROXY==='1';
const dataDir=resolve(root,prod?'data':'.data');await mkdir(dataDir,{recursive:true});
const db=openDatabase(process.env.DB_PATH||resolve(dataDir,'mastermind.sqlite'));
if(prod&&!process.env.APP_ORIGIN)throw new Error('Production requires APP_ORIGIN.');
const origin=prod?new URL(process.env.APP_ORIGIN).origin:`http://127.0.0.1:${port}`,publicRoot=resolve(root,'public');
const bindHost=prod?(process.env.HOST||'0.0.0.0'):'127.0.0.1';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
const assets={async fetch(request){
  const url=new URL(request.url);if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  const pathname=decodeURIComponent(url.pathname),entry=pathname==='/'||pathname==='/play/mastermind'?'/index.html':pathname;
  const path=resolve(publicRoot,'.'+entry);if(!path.startsWith(publicRoot+sep))return new Response('Forbidden',{status:403});
  try{if(!(await stat(path)).isFile())return new Response('Not found',{status:404});return new Response(request.method==='HEAD'?null:await readFile(path),{headers:{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'}});}
  catch{return new Response('Not found',{status:404});}
}};
const env=prod?{...process.env,APP_ORIGIN:origin,LOCAL_DEV:'false',DB:db,ASSETS:assets}:{...process.env,APP_ORIGIN:origin,LOCAL_DEV:'true',DB:db,ASSETS:assets,RANKED_ENABLED:'false'};
const server=createServer(async(req,res)=>{
  try{
    const first=v=>String(v||'').split(',').pop().trim();
    const host=prod&&trustProxy&&req.headers['x-forwarded-host']?first(req.headers['x-forwarded-host']):req.headers.host;
    const health=req.method==='GET'&&['/api/health','/','/index.html'].includes(req.url.split('?')[0]);// platform probes arrive with a preview Host; these serve only static, non-sensitive content
    if(host!==new URL(origin).host&&!health){res.writeHead(421);res.end('Use '+origin);return;}
    const parts=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>65536){res.writeHead(413);res.end();return;}parts.push(chunk);}
    const headers={...req.headers};delete headers['cf-connecting-ip'];
    // The Worker buckets clients by CF-Connecting-IP. Derive it here from the socket, or from the nearest proxy hop when TRUST_PROXY=1.
    const ip=(trustProxy&&first(req.headers['x-forwarded-for']))||req.socket.remoteAddress;if(ip)headers['cf-connecting-ip']=ip;
    const request=new Request(origin+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(parts)}:{})});
    const response=await handle(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Local server error');}
});
server.listen(port,bindHost,()=>console.log(`Mastermind: ${origin} (${bindHost}:${port})\n${env.TYPESAFE_API_KEY?'JEV configured':'Local deterministic opponent — not JEV'}\n${prod?'Production mode.':'Ranked play disabled on the loopback development server.'}`));
const interval=setInterval(()=>maintenance(db,config(env),env).catch(()=>{}),60000);interval.unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(interval);server.close(()=>{db.close();process.exit(0);});});
