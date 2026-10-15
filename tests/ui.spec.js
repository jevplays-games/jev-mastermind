import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
// The game opens a match on load (main 2aa988c), so the setup panel with #start and #localStart appears only after
// "New match". Each test reaches those buttons the way a player does and keeps every original assertion.
test('loads accessible board and enforces complete guesses',async({page})=>{
  page.on('dialog',d=>d.accept());
  await page.goto('/');await expect(page.locator('.guess-row')).toHaveCount(20);await expect(page.locator('#guessComposer')).toBeVisible();
  await page.locator('#resign').click();await page.locator('#nextMatch').click();
  await expect(page.locator('#start')).toBeEnabled();await page.locator('#start').click();await expect(page.locator('#guessComposer')).toBeVisible();await expect(page.locator('#submitGuess')).toBeDisabled();
  await page.locator('#guessSlots button').first().click();await page.keyboard.type('AABB');await expect(page.locator('#submitGuess')).toBeEnabled();
  await page.keyboard.press('Enter');await expect(page.locator('#humanScore')).toHaveText('1 / 10');
});
test('post-forfeit worker analytics and replay download work',async({page})=>{
  page.on('dialog',d=>d.accept());
  await page.goto('/');await expect(page.locator('#guessComposer')).toBeVisible();
  await page.locator('#resign').click();await page.locator('#nextMatch').click();
  await expect(page.locator('#start')).toBeEnabled();await page.locator('#localStart').click();
  await expect(page.locator('#modeBadge')).toContainText('BROWSER PRACTICE / NOT JEV');
  await page.locator('#resign').click();await page.locator('#reviewMatch').click();
  await expect(page.locator('#analysisContent')).toBeVisible();await expect(page.locator('#entropyChart svg')).toBeVisible();
  // Local practice is never presented as Jev: the outcome card names the local solver, not the raw `jev` difficulty key.
  const outcome=page.locator('#analysisStats .stat').last();
  await expect(outcome).toContainText('Local solver, not Jev');await expect(outcome).not.toContainText(/\bjev\b/);
  const download=page.waitForEvent('download');await page.locator('#exportReplay').click();expect((await download).suggestedFilename()).toContain('replay.json');
});
test('mobile layout avoids horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('#start')).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const ratio=await page.locator('.guess-pegs .peg').first().evaluate(e=>e.getBoundingClientRect().width/e.getBoundingClientRect().height);expect(ratio).toBeCloseTo(1);
});
test('unavailable API leaves explicitly labeled browser practice',async({page})=>{
  page.on('dialog',d=>d.accept());
  await page.route('**/api/**',route=>route.abort());await page.goto('/');
  await expect(page.locator('#modeBadge')).toContainText('BROWSER PRACTICE / NOT JEV');await expect(page.locator('#guessComposer')).toBeVisible();
  await page.locator('#resign').click();await page.locator('#nextMatch').click();
  await expect(page.locator('#setup-title')).toHaveText('Choose the code the local solver will break');
  await page.locator('#localStart').click();
  await expect(page.locator('#modeBadge')).toContainText('BROWSER PRACTICE / NOT JEV');await expect(page.locator('#guessComposer')).toBeVisible();
});
test('browser practice analytics and exports never present the local solver as Jev',async({page})=>{
  page.on('dialog',d=>d.accept());
  await page.route('**/api/**',route=>route.abort());await page.goto('/');
  await expect(page.locator('#modeBadge')).toContainText('BROWSER PRACTICE / NOT JEV');await expect(page.locator('#guessComposer')).toBeVisible();
  // Ten guesses end the human leg (or one solves it); the local solver then plays leg two automatically.
  for(const [i,code] of ['AABB','CCDD','EEFF','ABCD','BCDE','CDEF','DEFA','EFAB','FABC','ACEB'].entries()){
    if(!await page.locator('#guessComposer').isVisible())break;
    await page.locator('#guessSlots button').first().click();await page.keyboard.type(code);await page.keyboard.press('Enter');
    await page.waitForFunction(n=>document.getElementById('humanScore').textContent.trim().startsWith(n+' /')||document.getElementById('guessComposer').classList.contains('hidden'),i+1);
  }
  await expect(page.locator('#nextMatch')).toBeVisible({timeout:60000});
  await page.locator('#reviewMatch').click();await expect(page.locator('#analysisContent')).toBeVisible({timeout:60000});
  const outcome=page.locator('#analysisStats .stat').last();
  await expect(outcome).toContainText('Local solver, not Jev');await expect(outcome).not.toContainText(/\bjev\b/);
  const grab=async button=>{const download=page.waitForEvent('download');await page.locator(button).click();return readFileSync(await (await download).path(),'utf8');};
  const replay=JSON.parse(await grab('#exportReplay')),report=JSON.parse(await grab('#exportJson')),moves=await grab('#exportCsv'),decisions=await grab('#exportDecisions');
  expect(replay.configId).toBe('browser-practice-v1');
  const opponentMoves=replay.actions.filter(a=>a.actor==='jev');expect(opponentMoves.length).toBeGreaterThan(0);
  expect(opponentMoves.every(a=>a.source==='local')).toBe(true);
  expect(report.decisions.length).toBe(opponentMoves.length);expect(report.decisions.every(d=>d.source==='local'&&d.reason==='browser_practice')).toBe(true);
  expect(report.provider.jevCalls).toBe(0);
  // jev may appear only as stored keys, never as a label: the difficulty tier, the opponent-leg actor key, the replay format id.
  const jevValues=(value,key='',out=[])=>{if(typeof value==='string'){if(/jev/i.test(value))out.push(`${key}=${value}`);}
    else if(Array.isArray(value))value.forEach(v=>jevValues(v,key,out));else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value))jevValues(v,k,out);return out;};
  expect([...jevValues(replay),...jevValues(report)].filter(v=>!['difficulty=jev','actor=jev','format=jev-replay-v1'].includes(v))).toEqual([]);
  for(const text of [moves,decisions])expect(/jev/i.test(text.replace(/^"jev",/gm,''))).toBe(false);
});
