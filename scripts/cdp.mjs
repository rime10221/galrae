// 개발용: 열어 둔 Chrome(--remote-debugging-port=9333)에 붙어서 스크립트를 실행
// node scripts/cdp.mjs <file.mjs>  — 파일은 default export async (browser, puppeteer) => {}
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
try {
  const mod = await import(pathToFileURL(resolve(process.argv[2])).href);
  await mod.default(browser, puppeteer);
} finally {
  browser.disconnect();
}
