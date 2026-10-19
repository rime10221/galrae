// icons/icon.svg → PNG 아이콘들
//  icon-192/512.png     : 둥근 모서리, 투명 배경 (purpose: any)
//  maskable-512.png     : 꽉 찬 배경 + 안쪽 80% 안전 영역 (안드로이드가 원/둥근 사각형으로 잘라냄)
//  apple-touch-icon.png : 180px 꽉 찬 사각형 (iOS가 직접 둥글게 깎음)
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';

const ICONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const svg = await readFile(join(ICONS, 'icon.svg'), 'utf8');
const square = svg.replace(/rx="\d+"/, 'rx="0"');
// 그림만 80%로 줄인 꽉 찬 버전
const inner = square.replace(/<rect[^>]*\/>/, '').replace(/<svg[^>]*>/, '').replace('</svg>', '');
const defs = (inner.match(/<defs>[\s\S]*?<\/defs>/) || [''])[0];
const art = inner.replace(defs, '');
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}<rect width="512" height="512" fill="url(#g)"/><g transform="translate(51.2 51.2) scale(.8)">${art}</g></svg>`;

const jobs = [
  ['icon-192.png', 192, svg, true],
  ['icon-512.png', 512, svg, true],
  ['maskable-512.png', 512, maskable, false],
  ['apple-touch-icon.png', 180, square, false],
];
const browser = await launch();
const page = await browser.newPage();
for (const [name, n, src, transparent] of jobs) {
  await page.setViewport({ width: n, height: n });
  await page.setContent(`<body style="margin:0;background:transparent">${src.replace('<svg ', `<svg width="${n}" height="${n}" `)}</body>`);
  await page.screenshot({ path: join(ICONS, name), clip: { x: 0, y: 0, width: n, height: n }, omitBackground: transparent });
  console.log(name);
}
await browser.close();
