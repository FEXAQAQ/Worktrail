/**
 * 以無頭 Chrome／Edge（CDP）依序截取示範畫面，淡入淡出後編碼成 GIF（不需額外套件）。
 * 用法：node scripts/demo/record.mjs <服務網址> <輸出 .gif> <暫存資料夾> <週報期間 id>
 * 通常由 scripts/demo/run.mjs 呼叫；各幕截圖也會存成 <暫存資料夾>/sceneN.png 方便檢查。
 */
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [BASE, OUT, WORK, WEEKLY] = process.argv.slice(2);
const W = 1200, H = 760;
const CHROME = [
  process.env.DEMO_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('找不到 Chrome 或 Edge，請以環境變數 DEMO_BROWSER 指定瀏覽器路徑');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Chrome / CDP ----------
const port = 9333;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${resolve(WORK, 'profile')}`,
  '--no-first-run', '--hide-scrollbars', '--force-color-profile=srgb', `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

let targets;
for (let i = 0; i < 200; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch (e) { void e; }
  await sleep(200);
}
const page = targets?.find((t) => t.type === 'page');
if (!page) { chrome.kill(); throw new Error(`無法連線到瀏覽器的除錯埠 ${port}`); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2500); };
// react-router：pushState + popstate 不重新載入頁面
const go = async (path, wait = 900) => { await evalJs(`history.pushState({}, '', ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent('popstate')); true`); await sleep(wait); };
const click = async (selectorJs, wait = 900) => { await evalJs(`(() => { const el = ${selectorJs}; if (el) el.click(); return !!el; })()`); await sleep(wait); };
let shotNo = 0;
const shot = async () => {
  const png = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
  mkdirSync(WORK, { recursive: true });
  writeFileSync(join(WORK, `scene${++shotNo}.png`), png);
  return decodePng(png);
};

// ---------- 劇本 ----------
const scenes = []; // { img, hold(ms) }
const add = async (hold) => scenes.push({ img: await shot(), hold });

await nav(BASE + '/');
await evalJs(`localStorage.setItem('wt.style','default'); localStorage.setItem('wt.theme','light'); true`);
await nav(BASE + '/');
await add(2600);                                             // 今日
const firstTask = await evalJs(`(() => { const a = [...document.querySelectorAll('[data-task-id],[data-id]')][0]; return a ? (a.dataset.taskId || a.dataset.id) : null })()`);
if (firstTask) await go(`/?task=${encodeURIComponent(firstTask)}`, 1000);
else await click(`[...document.querySelectorAll('h3,h2,button,div')].find(e => e.textContent.trim().startsWith('信用卡分期付款'))`, 1000);
await add(2600);                                             // 任務面板
await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); true`); await sleep(500);
await go('/log', 1400); await add(2600);                     // 日誌熱度圖
await go('/talk', 1400); await add(2400);                    // 小交流
await go(`/weekly/${WEEKLY}`, 1400); await add(2800);                  // 週報
await go('/', 300);
await evalJs(`document.documentElement.classList.add('notebook'); true`); await sleep(1200);
await add(3000);                                             // 筆記本風格（只改畫面，不存設定）

ws.close(); chrome.kill();
mkdirSync(WORK, { recursive: true });

// ---------- 組成影格（含淡入淡出） ----------
const frames = [];
const BLEND = 4;
for (let i = 0; i < scenes.length; i++) {
  frames.push({ rgb: scenes[i].img, delay: scenes[i].hold });
  const next = scenes[(i + 1) % scenes.length].img;
  for (let b = 1; b <= BLEND; b++) {
    const t = b / (BLEND + 1), a = scenes[i].img, o = new Uint8Array(a.length);
    for (let p = 0; p < a.length; p++) o[p] = a[p] * (1 - t) + next[p] * t + 0.5;
    frames.push({ rgb: o, delay: 60 });
  }
}
writeFileSync(OUT, encodeGif(frames, W, H));
console.log(`已輸出 ${OUT}（${scenes.length} 幕、${frames.length} 格）`);

// ---------- PNG 解碼（8-bit RGB/RGBA，非交錯） ----------
function decodePng(buf) {
  let o = 8, w, h, ct, idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12]) throw new Error('unsupported png'); }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(h * stride), out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], s = y * (stride + 1) + 1, r = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[r + x - bpp] : 0, b = y ? px[r - stride + x] : 0, c = x >= bpp && y ? px[r - stride + x - bpp] : 0;
      let v = raw[s + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[r + x] = v & 255;
    }
  }
  for (let i = 0, j = 0; i < w * h; i++, j += bpp) { out[i * 3] = px[j]; out[i * 3 + 1] = px[j + 1]; out[i * 3 + 2] = px[j + 2]; }
  return out;
}

// ---------- GIF 編碼：全域 255 色（median cut）+ 透明差異影格 ----------
function encodeGif(frames, w, h) {
  // 直方圖（每通道 6 bit）
  const hist = new Map();
  for (const f of frames) if (f.delay > 100) for (let p = 0; p < f.rgb.length; p += 3) {
    const k = ((f.rgb[p] >> 2) << 12) | ((f.rgb[p + 1] >> 2) << 6) | (f.rgb[p + 2] >> 2);
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  // 依出現次數挑色，但避免挑到彼此太接近的顏色（UI 截圖大多是平塗色）
  const cols = [...hist].map(([k, n]) => ({ r: ((k >> 12) << 2) + 2, g: (((k >> 6) & 63) << 2) + 2, b: ((k & 63) << 2) + 2, n })).sort((a, b) => b.n - a.n);
  const pal = [];
  for (const minD of [64, 24, 8, 0]) {
    for (const c of cols) {
      if (pal.length >= 255) break;
      if (pal.some(([r, g, b]) => (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2 <= minD)) continue;
      pal.push([c.r, c.g, c.b]);
    }
  }
  while (pal.length < 256) pal.push([0, 0, 0]);
  const TRANSP = 255;
  const lut = new Int16Array(1 << 18).fill(-1);
  const nearest = (r, g, b) => {
    const k = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    if (lut[k] >= 0) return lut[k];
    let bi = 0, bd = Infinity;
    for (let i = 0; i < 255; i++) { const [pr, pg, pb] = pal[i]; const d = (pr - r) ** 2 * 2 + (pg - g) ** 2 * 4 + (pb - b) ** 2 * 3; if (d < bd) { bd = d; bi = i; } }
    return (lut[k] = bi);
  };

  const out = [];
  const bytes = (...a) => out.push(Buffer.from(a));
  const u16 = (v) => [v & 255, v >> 8];
  out.push(Buffer.from('GIF89a'));
  bytes(...u16(w), ...u16(h), 0xf7, 0, 0);
  out.push(Buffer.from(pal.flat()));
  bytes(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0);

  let prev = null;
  for (const f of frames) {
    const idx = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 3) idx[i] = nearest(f.rgb[p], f.rgb[p + 1], f.rgb[p + 2]);
    let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
    if (prev) {
      x0 = w; y0 = h; x1 = -1; y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (idx[y * w + x] !== prev[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) { x0 = y0 = x1 = y1 = 0; }
    }
    const fw = x1 - x0 + 1, fh = y1 - y0 + 1, sub = new Uint8Array(fw * fh);
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const i = (y + y0) * w + x + x0;
      sub[y * fw + x] = prev && idx[i] === prev[i] ? TRANSP : idx[i];
    }
    const cs = Math.round(f.delay / 10);
    bytes(0x21, 0xf9, 4, prev ? 0x05 : 0x04, ...u16(cs), TRANSP, 0);
    bytes(0x2c, ...u16(x0), ...u16(y0), ...u16(fw), ...u16(fh), 0);
    out.push(lzw(sub, 8));
    prev = idx;
  }
  bytes(0x3b);
  return Buffer.concat(out);
}

function lzw(data, minBits) {
  const clear = 1 << minBits, eoi = clear + 1;
  const bytesOut = [minBits];
  const block = []; let cur = 0, nbits = 0;
  const emit = (code, size) => { cur |= code << nbits; nbits += size; while (nbits >= 8) { block.push(cur & 255); cur >>>= 8; nbits -= 8; } };
  let dict = new Map(), next = eoi + 1, size = minBits + 1;
  emit(clear, size);
  let w = data[0];
  for (let i = 1; i < data.length; i++) {
    const c = data[i], key = w * 4096 + c;
    const hit = dict.get(key);
    if (hit !== undefined) { w = hit; continue; }
    emit(w, size);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    else { emit(clear, size); dict = new Map(); next = eoi + 1; size = minBits + 1; }
    w = c;
  }
  emit(w, size); emit(eoi, size);
  if (nbits > 0) block.push(cur & 255);
  for (let i = 0; i < block.length; i += 255) { const ch = block.slice(i, i + 255); bytesOut.push(ch.length, ...ch); }
  bytesOut.push(0);
  return Buffer.from(bytesOut);
}
