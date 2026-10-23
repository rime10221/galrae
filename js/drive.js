// 운전 모드: 카드 앞면을 소리로 읽고, 블루투스(차 핸들) ⏮ ⏭ 버튼으로 카드를 넘긴다
// - 목소리: 기기 음성(Web Speech, 무료 · 결제 없음). 갤럭시는 Google 음성 엔진의 고음질 한국어 목소리가 가장 자연스럽다
// - 핸들 버튼은 Media Session API: 조용한 소리를 계속 틀어 두어야 이 앱이 '지금 재생 중인 앱'이 되어 버튼을 받는다
import * as S from './store.js';
import { esc, openDialog, toast } from './util.js';

const st = () => S.settings;
export const enabled = () => !!st().driveMode;

// ---------- 핸들 버튼을 받기 위한 조용한 소리 ----------
// 안드로이드 Chrome 은 5초가 넘는 소리가 재생 중일 때만 미디어 알림·블루투스 버튼을 연결한다
let keep = null;
let handlers = {};
let active = false;
let wake = null;

function silentWav(sec = 10, rate = 8000) {
  const n = sec * rate;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128); // 8비트 무음
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function audios() {
  if (keep) return;
  keep = new Audio(silentWav());
  keep.loop = true;
}

const ms = () => ('mediaSession' in navigator ? navigator.mediaSession : null);

function bindMedia() {
  const m = ms();
  if (!m) return;
  const on = (a, fn) => { try { m.setActionHandler(a, fn); } catch { /* 지원 안 하는 버튼 */ } };
  on('nexttrack', () => handlers.next?.());
  on('previoustrack', () => handlers.prev?.());
  on('seekforward', () => handlers.next?.());
  on('seekbackward', () => handlers.prev?.());
  // 재생/일시정지 버튼: 카드를 뒤집어 보이는 면을 읽는다
  on('play', () => { handlers.toggle?.(); m.playbackState = 'playing'; });
  on('pause', () => { handlers.toggle?.(); m.playbackState = 'playing'; });
}

async function lockScreen() {
  if (!('wakeLock' in navigator) || document.hidden || wake) return;
  try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } catch { /* 배터리 절약 모드 등 */ }
}
document.addEventListener('visibilitychange', () => { if (active && !document.hidden) { lockScreen(); keep?.paused && keep.play().catch(() => {}); } });

// 카드 화면에 들어오면 켜고, 나가면 끈다
export function activate(h) {
  handlers = h;
  if (!enabled()) return deactivate();
  audios();
  if (!active) {
    active = true;
    bindMedia();
    keep.play().catch(() => toast('화면을 한 번 누르면 핸들 버튼이 연결돼요', { ms: 2500 }));
    lockScreen();
  }
  if (ms()) ms().playbackState = 'playing';
}

export function deactivate() {
  if (!active) return;
  active = false;
  stop();
  keep?.pause();
  wake?.release().catch(() => {});
  wake = null;
  const m = ms();
  if (m) {
    for (const a of ['nexttrack', 'previoustrack', 'seekforward', 'seekbackward', 'play', 'pause']) { try { m.setActionHandler(a, null); } catch { /* */ } }
    m.metadata = null;
    m.playbackState = 'none';
  }
}

// 차 화면(블루투스)에 보이는 '곡 정보'
export function nowPlaying(title, sub) {
  const m = ms();
  if (!m || !active || typeof MediaMetadata === 'undefined') return;
  m.metadata = new MediaMetadata({ title, artist: sub, album: '갈래 · 운전 모드', artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }] });
}

// ---------- 읽기 ----------
let seq = 0;
let pending = null; // 읽는 중인 글이 끝나거나 끊기면 알린다

export function stop() {
  seq++;
  pending?.(false);
  pending = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// 끝까지 읽으면 true, 다른 글로 끊기면 false
export function speak(text) {
  stop();
  const my = seq;
  text = String(text || '').trim();
  if (!text) return Promise.resolve(false);
  if (!('speechSynthesis' in window)) { toast('이 브라우저는 음성 읽기를 지원하지 않아요'); return Promise.resolve(false); }
  const done = new Promise((res) => { pending = res; });
  const end = () => { if (my === seq) { pending?.(true); pending = null; } };
  const u = new SpeechSynthesisUtterance(text);
  const vs = koVoices();
  u.voice = vs.find((v) => v.name === st().ttsVoice) || vs[0] || null;
  u.lang = u.voice?.lang || 'ko-KR';
  u.rate = +st().ttsRate || 1;
  u.onend = end;
  u.onerror = end;
  speechSynthesis.speak(u);
  return done;
}

// 한국어 중 자연스러운 목소리(Natural·Online·Neural·Google…)를 먼저
function koVoices() {
  if (!('speechSynthesis' in window)) return [];
  const score = (v) => (/natural|online|neural|premium|enhanced/i.test(v.name) ? 3 : 0) + (/google|samsung|microsoft/i.test(v.name) ? 1 : 0) + (v.localService ? 0 : 1);
  return speechSynthesis.getVoices().filter((v) => /^ko/i.test(v.lang)).sort((a, b) => score(b) - score(a));
}
if ('speechSynthesis' in window) speechSynthesis.getVoices(); // 목록을 미리 불러 둔다

// 읽을 글: 외울 것의 서식 기호·사진은 빼고
export function plain(md) {
  return String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/==\{\w+\}|==|\*\*|\{\w+\}|\{\/\}|\[\[|\]\]/g, '')
    .replace(/->/g, ', ')
    .split('\n').map((l) => l.replace(/^\s*([-*+•>#]+|\d+[.)])\s*/, '').trim()).filter(Boolean).join('. ');
}

// ---------- 음성 설정 ----------
const voiceOpts = (vs) => (vs.length
  ? vs.map((v) => `<option value="${esc(v.name)}" ${v.name === st().ttsVoice ? 'selected' : ''}>${esc(v.name)}</option>`).join('')
  : '<option value="">한국어 음성이 없어요 (아래 안내대로 설치)</option>');

export function settingsDialog() {
  const s = st();
  return openDialog(`<div class="dlg-body drive-dlg">
    <p class="dlg-msg">🚗 운전 모드 음성</p>
    <select class="input" id="dvVoice">${voiceOpts(koVoices())}</select>
    <p class="muted small"><b>더 자연스러운 목소리 (무료)</b> — 갤럭시: 설정 → 일반 → 글자 읽어주기(텍스트 음성 변환) → 기본 엔진을 <b>Google 음성 인식 및 합성</b>으로 → ⚙ → 음성 데이터 설치 → 한국어에서 마음에 드는 목소리를 고르고 <b>고음질</b>로 받아 두세요. 휴대폰에서 바로 만들어서 인터넷이 없어도 읽어요. PC 는 Edge 에서 열면 「Online (Natural)」 목소리를 쓸 수 있어요.</p>
    <div class="kv"><span>속도</span><div class="seg" id="dvRate">${[[0.85, '느리게'], [1, '보통'], [1.15, '빠르게'], [1.3, '아주 빠르게']].map(([v, l]) => `<button data-v="${v}" class="${(+s.ttsRate || 1) === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <label class="check"><span>앞면을 읽고 잠시 뒤 뒷면(외울 것)도 읽기</span><input type="checkbox" id="dvBack" ${s.ttsBack ? 'checked' : ''}></label>
    <p class="muted small">핸들 ⏭ 다음 카드 · ⏮ 이전 카드 · ⏯ 뒤집어서 읽기 (알아요·몰라요 방식에서는 ⏭ 알아요 · ⏮ 몰라요). 화면이 꺼지면 읽기가 멈출 수 있어서, 운전 모드에서는 화면을 켜 둬요.</p>
    <div class="dlg-actions"><button class="btn ghost" id="dvTest">들어 보기</button><button class="btn primary" data-close="">닫기</button></div></div>`, {
    onMount(d) {
      d.querySelector('#dvRate').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        d.querySelectorAll('#dvRate button').forEach((x) => x.classList.toggle('on', x === b));
        S.saveSettings({ ttsRate: +b.dataset.v });
      });
      d.querySelector('#dvVoice').onchange = (e) => S.saveSettings({ ttsVoice: e.target.value });
      d.querySelector('#dvBack').onchange = (e) => S.saveSettings({ ttsBack: e.target.checked });
      d.querySelector('#dvTest').onclick = () => speak('임신과 당뇨병. 선별 검사는 24주에서 28주 사이에 합니다.');
      // 기기 음성 목록은 늦게 올 때가 있다
      if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', () => { d.querySelector('#dvVoice').innerHTML = voiceOpts(koVoices()); }, { once: true });
    },
  }).then(() => stop());
}
