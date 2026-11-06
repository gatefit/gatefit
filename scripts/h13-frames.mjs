#!/usr/bin/env node
// GATEFIT-H35 landing frame checks (fail modes first; the page was redesigned in H35).
// - No sideways scroll at 360, 390, 768, 1024, 1280 or 1440.
// - Text in a section never overlaps other text, and text inside the hero frame, the
//   how-it-works steps, the golden sets and the price cards stays inside its box.
// - The hero headline has no one-word line at 360, 390, 1280 or 1440 (text-wrap: balance).
// - At 1280x800 and 1440x900 the hero h1, the init copy button and the hero Buy sit on the
//   first screen.
// - The nav Buy and nav links are not clipped at 390. An open mobile menu at 360 and 390 is an
//   opaque sheet whose links do not cover the hero.
// - Exactly 4 Buy links render with a visible box at 1280 and 390.
// - The copy button puts `npx gatefit init` on the clipboard and says so; with the Clipboard
//   API refused it still copies through the fallback, and never reports a copy it did not make.
// - With prefers-reduced-motion nothing animates and no main text is hidden.
// - Built HTML carries none of the internal status phrases.
// Playwright drives the built site. Chrome is the system browser, or a
// headless shell installed into /tmp when CI has neither.

import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dist = process.argv[2];
if (!dist || !existsSync(join(dist, 'index.html'))) {
  console.error('h13-frames: dist index.html missing');
  process.exit(1);
}

const cache = '/tmp/gatefit-h13-visual';
mkdirSync(cache, { recursive: true });
const pwEntry = join(cache, 'node_modules/playwright-core/index.mjs');
if (!existsSync(pwEntry)) {
  execSync('npm install --silent playwright-core@1.55.1', { cwd: cache, stdio: 'inherit' });
}
const { chromium } = await import(pathToFileURL(pwEntry).href);

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/local/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((file) => existsSync(file)) ?? null;
}

let chrome = findChrome();
if (!chrome) {
  const out = execSync('npx --yes @puppeteer/browsers install chrome-headless-shell@stable', {
    cwd: cache,
    encoding: 'utf8',
  });
  const match = out.match(/(\/\S*chrome-headless-shell\S*)/);
  chrome = match?.[1] && existsSync(match[1]) ? match[1] : null;
}
if (!chrome) {
  console.error('h13-frames: no Chrome binary');
  process.exit(1);
}

const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  let file = normalize(join(dist, decodeURIComponent(url.pathname)));
  if (!file.startsWith(normalize(dist))) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (url.pathname.endsWith('/')) file = join(file, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: chrome,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const issues = [];

function note(where, found) {
  for (const item of found) issues.push(`${where}: ${item}`);
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function open(width, height, opts = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference', permissions: opts.permissions ?? [] });
  const page = await context.newPage();
  await page.route(/cloudflareinsights|t\.gatefit\.io/, (route) => route.abort());
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await settle(page);
  return { page, close: () => context.close() };
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
function resolveShotDir() {
  const fromEnv = process.env.GATEFIT_H13_SHOT_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  return join(repoRoot, '.artifacts/h13-frames');
}
const shotDir = resolveShotDir();

async function checkLayout(width, height) {
  const { page, close } = await open(width, height);
  note(`layout ${width}`, await page.evaluate(() => {
    const found = [];
    const doc = document.documentElement;
    const extra = doc.scrollWidth - doc.clientWidth;
    if (extra > 1) found.push(`horizontal overflow ${extra}px`);
    const shown = (el) => {
      for (let node = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity) < 0.3) return false;
      }
      return true;
    };
    const hosts = '.frame, .step, .set, .price-card, .final-band, .status-card, .verdict-bar .v, .cmd';
    for (const section of document.querySelectorAll('main > section')) {
      const leaves = [...section.querySelectorAll('h1, h2, h3, p, li, td, th, span, code, a, button')].flatMap((el) => {
        const own = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
        if (!own || !shown(el)) return [];
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return [];
        return [{ text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 50), rect, el }];
      });
      for (let i = 0; i < leaves.length; i += 1) {
        for (let j = i + 1; j < leaves.length; j += 1) {
          const a = leaves[i];
          const b = leaves[j];
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const x = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
          const y = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
          if (x > 2 && y > 2) found.push(`overlap "${a.text}" ∩ "${b.text}"`);
        }
      }
      for (const leaf of leaves) {
        const host = leaf.el.closest(hosts);
        if (!host) continue;
        const box = host.getBoundingClientRect();
        const { rect } = leaf;
        if (rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1) {
          found.push(`clip "${leaf.text}"`);
        }
      }
    }
    const buys = [...document.querySelectorAll('a[data-gf-buy]')];
    if (buys.length !== 4) found.push(`${buys.length} Buy links, expected 4`);
    for (const buy of buys) {
      const rect = buy.getBoundingClientRect();
      if (!shown(buy) || rect.width < 40 || rect.height < 30) found.push('a Buy link is hidden or collapsed');
    }
    return found;
  }));
  if (width === 1280 || width === 390) {
    mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: join(shotDir, `h35-landing-${width}.png`), fullPage: true });
  }
  await close();
}

async function checkFold(width, height) {
  const { page, close } = await open(width, height);
  note(`fold ${width}x${height}`, await page.evaluate(() => {
    const found = [];
    for (const [sel, name] of [['#hero-title', 'h1'], ['.hero .cmd', 'init copy button'], ['.hero .buy', 'hero Buy']]) {
      const rect = document.querySelector(sel)?.getBoundingClientRect();
      if (!rect || rect.height < 1) found.push(`${name} missing`);
      else if (rect.bottom > window.innerHeight) found.push(`${name} below the fold (${Math.round(rect.bottom)}px)`);
    }
    return found;
  }));
  await close();
}

async function checkNavOverflow() {
  const { page, close } = await open(390, 844);
  note('nav 390', await page.evaluate(() => {
    const found = [];
    const buy = document.querySelector('.site-nav .buy');
    const box = buy?.getBoundingClientRect();
    if (!box || box.width < 40 || box.left < -1 || box.right > window.innerWidth + 1) {
      found.push('Buy for $49 is clipped or missing');
    }
    for (const link of document.querySelectorAll('.nav-link')) {
      const style = getComputedStyle(link);
      if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity) < 0.3) continue;
      const rect = link.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.left < -1 || rect.right > window.innerWidth + 1) found.push(`nav clip "${link.textContent.trim()}"`);
    }
    return found;
  }));
  await close();
}

async function checkHeroLines(width) {
  const { page, close } = await open(width, 900);
  note(`hero lines ${width}`, await page.evaluate(() => {
    const h1 = document.querySelector('#hero-title');
    if (!h1) return ['hero title missing'];
    const found = [];
    const wrap = getComputedStyle(h1).textWrap;
    if (wrap !== 'balance') found.push(`text-wrap is ${wrap}`);
    const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
    const words = [];
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? '';
      const re = /\S+/g;
      let match = re.exec(text);
      while (match) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rect = range.getClientRects()[0];
        if (rect && rect.width > 0) words.push({ word: match[0], top: rect.top });
        match = re.exec(text);
      }
      node = walker.nextNode();
    }
    const lines = [];
    for (const word of words) {
      const last = lines.at(-1);
      if (!last || Math.abs(last.top - word.top) > 2) lines.push({ top: word.top, words: [word.word] });
      else last.words.push(word.word);
    }
    if (lines.length < 2) found.push(`hero has ${lines.length} line`);
    for (const line of lines) {
      if (line.words.length < 2) found.push(`single-word line "${line.words.join(' ')}"`);
    }
    return found;
  }));
  await close();
}

async function checkMobileMenu(width, height) {
  const { page, close } = await open(width, height);
  const toggle = page.locator('.nav-toggle');
  await toggle.click();
  await settle(page);
  note(`menu ${width}`, await page.evaluate(() => {
    const found = [];
    const panel = document.querySelector('#nav-links');
    const button = document.querySelector('.nav-toggle');
    if (!panel || !button) return ['menu missing'];
    if (button.getAttribute('aria-expanded') !== 'true') found.push('aria-expanded is not true');
    const style = getComputedStyle(panel);
    if (style.display === 'none' || style.visibility === 'hidden') found.push('panel hidden while open');
    const color = style.backgroundColor;
    const parts = color.match(/[\d.]+/g)?.map(Number) ?? [];
    const alpha = parts.length >= 4 ? parts[3] : (color === 'transparent' ? 0 : 1);
    if (!(alpha >= 0.99)) found.push(`panel background ${color}`);
    const heroes = [document.querySelector('.hero .eyebrow'), document.querySelector('#hero-title')].filter(Boolean);
    for (const link of panel.querySelectorAll('a')) {
      const linkBox = link.getBoundingClientRect();
      if (linkBox.width < 1 || linkBox.height < 1) {
        found.push(`link missing "${link.textContent.trim()}"`);
        continue;
      }
      for (const hero of heroes) {
        const heroBox = hero.getBoundingClientRect();
        const x = Math.min(linkBox.right, heroBox.right) - Math.max(linkBox.left, heroBox.left);
        const y = Math.min(linkBox.bottom, heroBox.bottom) - Math.max(linkBox.top, heroBox.top);
        if (x > 2 && y > 2) found.push(`link overlaps hero "${link.textContent.trim()}"`);
      }
    }
    return found;
  }));
  await close();
}

const INIT = 'npx gatefit init';

async function checkCopy() {
  // Clipboard API granted: the real clipboard gets the command.
  {
    const { page, close } = await open(1280, 900, { permissions: ['clipboard-read', 'clipboard-write'] });
    await page.locator('.hero .cmd').click();
    await page.waitForTimeout(100);
    const found = [];
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    if (clip !== INIT) found.push(`clipboard holds ${JSON.stringify(clip)}`);
    const state = await page.evaluate(() => ({
      copied: document.querySelector('.hero .cmd')?.classList.contains('is-copied'),
      status: document.querySelector('.cmd-status')?.textContent ?? '',
    }));
    if (!state.copied) found.push('button does not show the copied state');
    if (!state.status.includes(`Copied: ${INIT}`)) found.push(`status says "${state.status}"`);
    note('copy api', found);
    await close();
  }
  // Clipboard API refused: the textarea fallback still copies; a failed fallback says so.
  for (const fallbackWorks of [true, false]) {
    const { page, close } = await open(390, 844, {
      init: `(() => {
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
        window.__copied = null;
        document.execCommand = (cmd) => {
          if (cmd !== 'copy' || !${fallbackWorks}) return false;
          window.__copied = document.activeElement && 'value' in document.activeElement ? document.activeElement.value : null;
          return true;
        };
      })()`,
    });
    await page.locator('.hero .cmd').click();
    await page.waitForTimeout(100);
    const state = await page.evaluate(() => ({
      copied: document.querySelector('.hero .cmd')?.classList.contains('is-copied'),
      status: document.querySelector('.cmd-status')?.textContent ?? '',
      value: window.__copied,
      left: document.querySelectorAll('textarea').length,
    }));
    const found = [];
    if (state.left) found.push('fallback textarea left in the page');
    if (fallbackWorks) {
      if (state.value !== INIT) found.push(`fallback copied ${JSON.stringify(state.value)}`);
      if (!state.copied || !state.status.includes(`Copied: ${INIT}`)) found.push('fallback copy not reported');
    } else {
      if (state.copied || state.status.includes('Copied')) found.push('a failed copy is reported as copied');
      if (!state.status.includes(INIT)) found.push('a failed copy does not show the command');
    }
    note(`copy fallback ${fallbackWorks ? 'ok' : 'fails'}`, found);
    await close();
  }
}

async function checkReducedMotion() {
  const { page, close } = await open(1280, 900, { reduced: true });
  note('reduced motion', await page.evaluate(() => {
    const found = [];
    const running = document.getAnimations().filter((a) => a.playState === 'running');
    if (running.length) found.push(`${running.length} animation(s) running`);
    for (const el of document.querySelectorAll('main h1, main h2, main h3, main p, main li')) {
      if (!el.textContent.trim()) continue;
      for (let node = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.visibility === 'hidden' || Number.parseFloat(style.opacity) < 0.99) {
          if (el.classList.contains('cmd-status')) break;
          found.push(`hidden "${el.textContent.trim().slice(0, 40)}"`);
          break;
        }
      }
    }
    return found;
  }));
  await close();
}

function statusPhrases(root) {
  const banned = [
    /coming soon/i,
    /polar checkout is live/i,
    /checkout is live/i,
    /merchant of record/i,
    /names match the goldens/i,
    /docs live at/i,
    /fixture goldens/i,
  ];
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (statSync(file).isDirectory()) {
        walk(file);
        continue;
      }
      if (!name.endsWith('.html')) continue;
      const text = readFileSync(file, 'utf8');
      for (const re of banned) {
        if (re.test(text)) found.push(`${name} matches /${re.source}/`);
      }
    }
  };
  walk(root);
  return found;
}

for (const [w, h] of [[360, 780], [390, 844], [768, 1024], [1024, 768], [1280, 800], [1440, 900]]) await checkLayout(w, h);
await checkFold(1280, 800);
await checkFold(1440, 900);
await checkNavOverflow();
for (const w of [360, 390, 1280, 1440]) await checkHeroLines(w);
await checkMobileMenu(360, 780);
await checkMobileMenu(390, 844);
await checkCopy();
await checkReducedMotion();
note('status copy', statusPhrases(dist));

await browser.close();
server.close();

if (issues.length) {
  console.error(`h13-frames: FAIL ${issues.length}`);
  for (const issue of issues) console.error(`  ${issue}`);
  process.exit(1);
}
console.error('h13-frames: ok');
