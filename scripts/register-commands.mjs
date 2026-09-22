/** Explicit administrative script. Run only for a Discord application you control.
 * Uses client credentials; no bot token or gateway process is needed.
 * POST upserts /play only; it does not bulk-overwrite unrelated commands.
 */
try {
  try{process.loadEnvFile();}catch(error){if(error.code!=='ENOENT')throw error;}
  const id=process.env.DISCORD_CLIENT_ID,secret=process.env.DISCORD_CLIENT_SECRET,guild=process.env.DISCORD_TEST_GUILD_ID;
  if(!/^\d{17,20}$/.test(id??'')||!secret)throw new Error('Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in your private environment.');
  if(guild&&!/^\d{17,20}$/.test(guild))throw new Error('Invalid DISCORD_TEST_GUILD_ID.');
  const command={name:'play',type:1,description:'Play Mastermind against JEV',options:[{name:'game',description:'Choose a game',type:3,required:true,choices:[{name:'Mastermind',value:'mastermind'}]}],...(guild?{}:{integration_types:[0],contexts:[0]})};
  if(process.argv.includes('--dry-run')){console.log(JSON.stringify({target:guild?'test-guild':'global',command},null,2));process.exit(0);}
  const tokenResponse=await fetch('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:id,client_secret:secret,grant_type:'client_credentials',scope:'applications.commands.update'}),signal:AbortSignal.timeout(15000)});
  if(!tokenResponse.ok)throw new Error(`Discord token request failed (${tokenResponse.status}).`);
  const token=await tokenResponse.json();if(typeof token.access_token!=='string')throw new Error('Discord returned no access token.');
  const path=guild?`applications/${id}/guilds/${guild}/commands`:`applications/${id}/commands`;
  const response=await fetch('https://discord.com/api/v10/'+path,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Command registration failed (${response.status}); check app settings and rate limits.`);
  const result=await response.json();console.log(JSON.stringify({registered:true,name:result.name,id:result.id,scope:guild?'test-guild':'global'},null,2));
} catch(error){console.error(error.message);process.exitCode=1;}
