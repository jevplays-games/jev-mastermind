import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const get=(port,host,path)=>new Promise((ok,fail)=>{const r=request({host:'127.0.0.1',port,path,headers:{Host:host}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>ok({status:res.statusCode,body:b}));});r.on('error',fail);r.end();});
async function stop(s){s.child.kill();if(s.child.exitCode===null)await new Promise(r=>s.child.once('exit',r));try{rmSync(s.dir,{recursive:true,force:true,maxRetries:5});}catch{}}
async function boot(env,port){
  const dir=mkdtempSync(join(tmpdir(),'mm-'));
  const child=spawn(process.execPath,['--no-warnings','server/dev.mjs'],{env:{PATH:process.env.PATH,PORT:String(port),DB_PATH:join(dir,'t.sqlite'),QUOTA_SALT:'test-salt',...env},stdio:['ignore','pipe','pipe']});
  let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);
  for(let i=0;i<50&&!out.includes('Typecrack:')&&child.exitCode===null;i++)await new Promise(r=>setTimeout(r,100));
  return {child,dir,out:()=>out};
}
test('https non-loopback APP_ORIGIN selects production mode even with NODE_ENV=development',async()=>{
  const port=39400+Math.floor(Math.random()*500),s=await boot({NODE_ENV:'development',APP_ORIGIN:'https://game.example.test',HOST:'127.0.0.1'},port);
  try{
    assert.match(s.out(),/Production mode/);
    assert.equal((await get(port,'game.example.test','/api/health')).status,200);
    assert.equal((await get(port,'127.0.0.1:'+port,'/api/activity/config')).status,421);
    assert.equal((await get(port,'preview.example.test','/api/health')).status,200);
    assert.equal((await get(port,'preview.example.test','/api/activity/config')).status,421);
    assert.equal((await get(port,'preview.example.test','/')).status,200);
    assert.equal((await get(port,'preview.example.test','/index.html')).status,200);
    assert.equal((await get(port,'preview.example.test','/app.js')).status,421);
  }finally{await stop(s);}
});
test('loopback origin stays local dev',async()=>{
  const port=39400+Math.floor(Math.random()*500),s=await boot({APP_ORIGIN:'http://127.0.0.1:'+port},port);
  try{assert.match(s.out(),/loopback development server/);assert.equal((await get(port,'127.0.0.1:'+port,'/api/health')).status,200);}
  finally{await stop(s);}
});
test('the Node production server serves LEGACY_ORIGINS hosts like the Worker and skips malformed entries (D9)',async()=>{
  const hostile=['https://user:pw@evil.example','https://evil.example#@mastermind.jevplay.games','https://evil.example/path','https://evil.example?q=1','https://*.jevplay.games','http://evil.example','not a url'];
  const port=39400+Math.floor(Math.random()*500),s=await boot({APP_ORIGIN:'https://typecrack.jevplay.games',HOST:'127.0.0.1',LEGACY_ORIGINS:[...hostile,'https://mastermind.jevplay.games'].join(',')},port);
  try{
    for(const host of ['typecrack.jevplay.games','mastermind.jevplay.games']){
      assert.equal((await get(port,host,'/brand/brand.css')).status,200,host);
      assert.equal((await get(port,host,'/api/me')).status,200,host);
      assert.equal((await get(port,host,'/play/mastermind?launch=x')).status,301,host);
    }
    for(const host of ['evil.example','user:pw@evil.example','x.jevplay.games','mastermind.jevplay.games.evil.example'])
      assert.equal((await get(port,host,'/brand/brand.css')).status,421,host);
    const warnings=s.out().split('\n').filter(l=>l.includes('legacy_origin_skipped'));
    assert.equal(warnings.length,hostile.length);assert.ok(warnings.every(l=>!l.includes('evil')),'skipped entries are never echoed');
  }finally{await stop(s);}
});
