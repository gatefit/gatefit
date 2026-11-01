// GATEFIT-H27: render the committed brand SVGs in site/brand/ into site/public/.
//   node scripts/brand-assets.mjs           write favicon.svg, favicon-32.png, favicon.ico,
//                                           apple-touch-icon.png, og.png
//   node scripts/brand-assets.mjs --check   re-render in memory, exit 1 if any file drifted
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = (f) => readFileSync(join(site, 'brand', f));
const check = process.argv.includes('--check');

// Render well above the target size, then downsample, so 16px and 32px stay crisp.
async function png(svg, size, height = size) {
	return sharp(svg, { density: 72 * 8 })
		.resize(size, height, { kernel: 'lanczos3' })
		.png({ compressionLevel: 9, adaptiveFiltering: false })
		.toBuffer();
}

// ICO with PNG frames (Vista+); every browser that asks for /favicon.ico reads these.
function ico(frames) {
	const head = Buffer.alloc(6 + frames.length * 16);
	head.writeUInt16LE(0, 0);
	head.writeUInt16LE(1, 2);
	head.writeUInt16LE(frames.length, 4);
	let offset = head.length;
	frames.forEach(({ size, data }, i) => {
		const e = 6 + i * 16;
		head[e] = size;
		head[e + 1] = size;
		head.writeUInt16LE(1, e + 4);
		head.writeUInt16LE(32, e + 6);
		head.writeUInt32LE(data.length, e + 8);
		head.writeUInt32LE(offset, e + 12);
		offset += data.length;
	});
	return Buffer.concat([head, ...frames.map((f) => f.data)]);
}

const favicon = brand('favicon.svg');
const [f16, f32] = await Promise.all([png(favicon, 16), png(favicon, 32)]);
const outputs = {
	'favicon.svg': favicon,
	'favicon-32.png': f32,
	'favicon.ico': ico([{ size: 16, data: f16 }, { size: 32, data: f32 }]),
	'apple-touch-icon.png': await png(favicon, 180),
	'og.png': await png(brand('og.svg'), 1200, 630),
};

let drift = 0;
for (const [name, buf] of Object.entries(outputs)) {
	const file = join(site, 'public', name);
	if (!check) {
		writeFileSync(file, buf);
		console.log(`brand: wrote public/${name} (${buf.length} bytes)`);
		continue;
	}
	let cur;
	try {
		cur = readFileSync(file);
	} catch {
		cur = Buffer.alloc(0);
	}
	if (!cur.equals(buf)) {
		drift++;
		console.error(`brand: public/${name} drifted (${cur.length} committed vs ${buf.length} rendered bytes); run npm run brand`);
	}
}
if (check) {
	if (drift) process.exit(1);
	console.log('brand: public/ matches site/brand/');
}
