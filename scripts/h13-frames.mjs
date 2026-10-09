#!/usr/bin/env node
// Settled hero and leak frames must not stack text or clip it.
// The landing also must not scroll sideways at 390px, and the hero
// headline must not leave a one-word line at desktop widths.
// Stripe event names in the hero panel must not split inside a word.
// Playwright drives the built site. Chrome is the system browser, or a
// headless shell installed into /tmp when CI has neither.

import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

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

async function inspect(page, scope) {
  return page.evaluate((scopeSel) => {
    const root = document.querySelector(scopeSel);
    if (!root || getComputedStyle(root).display === 'none') return [];
    const used = (el) => {
      let opacity = 1;
      for (let node = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return 0;
        opacity *= Number.parseFloat(style.opacity);
        if (Number.isNaN(opacity)) return 0;
      }
      return opacity;
    };
    const leaves = [...root.querySelectorAll('h3, p, span, li, button')].flatMap((el) => {
      const own = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
      if (!own || used(el) < 0.3) return [];
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return [];
      return [{ text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), rect, el }];
    });
    const found = [];
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
    const hosts = '.db, .node, .sim-row, .verdicts, .leak-headlines, .m-node, .stack-card';
    for (const leaf of leaves) {
      const host = leaf.el.parentElement?.closest(hosts);
      if (!host) continue;
      const box = host.getBoundingClientRect();
      const { rect } = leaf;
      if (rect.left < box.left - 2 || rect.right > box.right + 2 || rect.top < box.top - 2 || rect.bottom > box.bottom + 2) {
        found.push(`clip "${leaf.text}"`);
      }
    }
    return found;
  }, scope);
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

const heroStates = ['created', 'paid', 'refund', 'dispute', 'past_due'];

async function checkHero(width, height, reduced) {
  const page = await browser.newPage();
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height });
  await page.goto(`${origin}/?frames=1`, { waitUntil: 'networkidle' });
  await settle(page);
  for (const state of heroStates) {
    await page.evaluate((next) => {
      document.querySelector('#sim')?.setAttribute('data-state', next);
    }, state);
    await settle(page);
    const label = `hero ${state} ${width}x${height}${reduced ? ' reduced' : ''}`;
    note(label, await inspect(page, '#sim'));
    if (width < 900) note(label, await inspect(page, '.leak-mobile'));
  }
  await page.close();
}

async function checkLeak(width) {
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${origin}/?frames=1`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: 'html { scroll-snap-type: none !important; }' });
  await settle(page);
  const steps = [
    ['000', 0.08],
    ['025', 0.35],
    ['050', 0.5],
    ['075', 0.75],
    ['100', 0.92],
  ];
  for (const [name, progress] of steps) {
    await page.evaluate((fraction) => {
      const track = document.querySelector('#leak-track');
      if (!track) return;
      const top = track.getBoundingClientRect().top + window.scrollY;
      const pin = Math.max(track.offsetHeight - window.innerHeight, 0);
      window.scrollTo(0, top + pin * fraction);
    }, progress);
    await settle(page);
    note(`leak ${name} ${width}`, await inspect(page, '#leak-stage'));
  }
  await page.close();
}

async function checkNavOverflow() {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/?frames=1`, { waitUntil: 'networkidle' });
  await settle(page);
  await page.waitForTimeout(1600);
  note('nav 390', await page.evaluate(() => {
    const found = [];
    const doc = document.documentElement;
    const extra = doc.scrollWidth - doc.clientWidth;
    if (extra > 1) found.push(`horizontal overflow ${extra}px`);
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
  await page.close();
}

async function checkEventNames(width) {
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${origin}/?frames=1`, { waitUntil: 'networkidle' });
  await settle(page);
  note(`event names ${width}`, await page.evaluate(() => {
    const found = [];
    for (const el of document.querySelectorAll('#sim .sim-row .name')) {
      const label = (el.textContent ?? '').replace(/\s+/g, '');
      if (!label) {
        found.push('empty event name');
        continue;
      }
      if (el.scrollWidth > el.clientWidth + 1) found.push(`clipped "${label}"`);
      const parts = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const value = node.textContent ?? '';
        for (let i = 0; i < value.length; i += 1) {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rect = range.getClientRects()[0];
          if (!rect || rect.width < 0.2) continue;
          parts.push({ ch: value[i], top: rect.top });
        }
        node = walker.nextNode();
      }
      let word = [];
      const flush = () => {
        if (word.length < 2) {
          word = [];
          return;
        }
        const top = word[0].top;
        if (word.some((part) => Math.abs(part.top - top) > 2)) {
          found.push(`mid-word "${word.map((part) => part.ch).join('')}" in "${label}"`);
        }
        word = [];
      };
      for (const part of parts) {
        if (/[A-Za-z0-9]/.test(part.ch)) word.push(part);
        else flush();
      }
      flush();
    }
    return found;
  }));
  await page.close();
}

async function checkHeroLines(width) {
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${origin}/?frames=1`, { waitUntil: 'networkidle' });
  await settle(page);
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
  await page.close();
}

await checkHero(1440, 900, false);
await checkHero(390, 844, false);
await checkHero(1440, 900, true);
await checkHero(390, 844, true);
await checkLeak(1440);
await checkLeak(1100);
await checkNavOverflow();
await checkHeroLines(1280);
await checkHeroLines(1440);
await checkHeroLines(1920);
await checkEventNames(1280);
await checkEventNames(1440);
await checkEventNames(1920);

await browser.close();
server.close();

if (issues.length) {
  console.error(`h13-frames: FAIL ${issues.length}`);
  for (const issue of issues) console.error(`  ${issue}`);
  process.exit(1);
}
console.error('h13-frames: ok');
