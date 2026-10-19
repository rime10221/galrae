// 설치된 Chrome/Edge를 찾아 puppeteer-core로 띄운다
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);

export function launch() {
  const executablePath = CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) throw new Error('Chrome을 찾지 못했어요. CHROME_PATH 환경 변수로 지정해 주세요.');
  return puppeteer.launch({ executablePath, headless: true, args: ['--no-first-run'] });
}
