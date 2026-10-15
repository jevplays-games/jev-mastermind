import {test,expect} from '@playwright/test';
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
