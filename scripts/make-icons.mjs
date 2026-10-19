// icons/icon.svg → icon-192.png, icon-512.png (마스커블용으로 모서리 없이 꽉 채움)
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';

const ICONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const svg = (await readFile(join(ICONS, 'icon.svg'), 'utf8')).replace(/rx="\d+"/, 'rx="0"');
const browser = await launch();
const page = await browser.newPage();
for (const n of [192, 512]) {
  await page.setViewport({ width: n, height: n });
  await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${n}" height="${n}" `)}</body>`);
  await page.screenshot({ path: join(ICONS, `icon-${n}.png`), clip: { x: 0, y: 0, width: n, height: n } });
  console.log(`icon-${n}.png`);
}
await browser.close();
