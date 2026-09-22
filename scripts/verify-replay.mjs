import {readFile,stat} from 'node:fs/promises';
import {verifyReplay} from '../public/mastermind/verify.js';
try {
  const path=process.argv[2];if(!path)throw new Error('Usage: npm run verify -- path/to/replay.json');
  if((await stat(path)).size>1048576)throw new Error('Replay exceeds the 1 MiB safety limit.');
  const result=await verifyReplay(JSON.parse(await readFile(path,'utf8')));
  console.log(JSON.stringify({valid:result.valid,matchId:result.state.matchId,outcome:result.state.outcome,proves:result.proves},null,2));
} catch(error){console.error(JSON.stringify({valid:false,error:error.message}));process.exitCode=1;}
