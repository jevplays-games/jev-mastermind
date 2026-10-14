import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';

const alt = (await readFile(new URL('./og-alt.txt', import.meta.url), 'utf8')).trim();
const index = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
if (!index.includes(`property="og:image:alt" content="${alt}"`)) {
  throw new Error('og:image:alt must match assets/src/og-alt.txt');
}
const browser = await chromium.launch({ headless: true });
try {
  for (const job of [
    { source: 'banner.html', output: '../banner.png', width: 1280, height: 420, scale: 2 },
    { source: 'social.html', output: '../../public/brand/og.png', width: 1200, height: 630, scale: 1 },
    { source: 'social.html', output: '../social-preview.png', width: 1280, height: 640, scale: 1 },
  ]) {
    const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: job.scale });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // All input assets are local. Reject remote requests without contacting the network.
    await page.route(/^https?:/, route => { errors.push(`Remote resource: ${route.request().url()}`); return route.abort(); });
    const source = new URL(job.source, import.meta.url);
    source.search = new URLSearchParams({ w: job.width, h: job.height }).toString();
    await page.goto(source.href);
    const renderedText = await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
      if (!document.fonts.check('700 120px Inter') || !document.fonts.check('30px VT323')) throw new Error('Local fonts did not load');
      return document.body.innerText;
    });
    if (!renderedText.includes('jevplay.games') || /jevplays|\bJEV\b|Arcade|Mastermind/.test(renderedText)) {
      throw new Error(`Invalid rendered brand text in ${job.source}: ${renderedText}`);
    }
    if (errors.length) throw new Error(errors.join('\n'));
    const output = fileURLToPath(new URL(job.output, import.meta.url));
    await page.screenshot({ path: output, type: 'png' });
    const { size } = await stat(output);
    if (job.output.endsWith('/og.png') && size >= 120000) throw new Error(`og.png exceeds 120 KB: ${size} bytes`);
    console.log(`Rendered ${output} (${job.width * job.scale} × ${job.height * job.scale}; ${size} bytes); text verified`);
    await page.close();
  }
} finally {
  await browser.close();
}
