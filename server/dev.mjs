/** No npm install required for local play. Binds loopback only; not a production Node server. */
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
await mkdir(resolve(root,'.data'),{recursive:true});
const db=openDatabase(process.env.DB_PATH||resolve(root,'.data/mastermind.sqlite'));
const origin=`http://127.0.0.1:${port}`,publicRoot=resolve(root,'public');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml'};
const assets={async fetch(request){
  const url=new URL(request.url);if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  const pathname=decodeURIComponent(url.pathname),entry=pathname==='/'||pathname==='/play/mastermind'?'/index.html':pathname;
  const path=resolve(publicRoot,'.'+entry);if(!path.startsWith(publicRoot+sep))return new Response('Forbidden',{status:403});
  try{if(!(await stat(path)).isFile())return new Response('Not found',{status:404});return new Response(request.method==='HEAD'?null:await readFile(path),{headers:{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'}});}
  catch{return new Response('Not found',{status:404});}
}};
const env={...process.env,APP_ORIGIN:origin,LOCAL_DEV:'true',DB:db,ASSETS:assets,RANKED_ENABLED:'false'};
const server=createServer(async(req,res)=>{
  try{
    const host=req.headers.host;if(host!==`127.0.0.1:${port}`){res.writeHead(421);res.end('Use '+origin);return;}
    const parts=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>65536){res.writeHead(413);res.end();return;}parts.push(chunk);}
    const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(parts)}:{})});
    const response=await handle(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Local server error');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Mastermind: ${origin}\n${env.TYPESAFE_API_KEY?'JEV configured':'Local deterministic opponent — not JEV'}\nRanked play disabled on the loopback development server.`));
const interval=setInterval(()=>maintenance(db,config(env),env).catch(()=>{}),60000);interval.unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(interval);server.close(()=>{db.close();process.exit(0);});});
