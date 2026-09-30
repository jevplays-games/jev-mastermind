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
  for(let i=0;i<50&&!out.includes('Mastermind:')&&child.exitCode===null;i++)await new Promise(r=>setTimeout(r,100));
  return {child,dir,out:()=>out};
}
test('https non-loopback APP_ORIGIN selects production mode even with NODE_ENV=development',async()=>{
  const port=39400+Math.floor(Math.random()*500),s=await boot({NODE_ENV:'development',APP_ORIGIN:'https://game.example.test',HOST:'127.0.0.1'},port);
  try{
    assert.match(s.out(),/Production mode/);
    assert.equal((await get(port,'game.example.test','/api/health')).status,200);
    assert.equal((await get(port,'127.0.0.1:'+port,'/api/health')).status,421);
  }finally{await stop(s);}
});
test('loopback origin stays local dev',async()=>{
  const port=39400+Math.floor(Math.random()*500),s=await boot({APP_ORIGIN:'http://127.0.0.1:'+port},port);
  try{assert.match(s.out(),/loopback development server/);assert.equal((await get(port,'127.0.0.1:'+port,'/api/health')).status,200);}
  finally{await stop(s);}
});
