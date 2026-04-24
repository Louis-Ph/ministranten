#!/usr/bin/env node
/**
 * Rasterisiert icon.svg in zwei Größen (192, 512) jeweils als
 *  - icon-<size>.png           (volle Fläche, "any")
 *  - icon-<size>-maskable.png  (20% Safe-Zone-Padding, für maskable)
 *
 * Nutzt das bereits installierte Playwright-Chromium.
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const svg = readFileSync(path.join(root, 'icon.svg'), 'utf8');

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const page = await ctx.newPage();

async function render({ size, maskable, out }) {
  const innerSize = maskable ? Math.round(size * 0.8) : size;
  const offset = Math.round((size - innerSize) / 2);
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:#0047a3;width:${size}px;height:${size}px;overflow:hidden}
    .wrap{width:${size}px;height:${size}px;position:relative}
    .inner{position:absolute;left:${offset}px;top:${offset}px;width:${innerSize}px;height:${innerSize}px}
    svg{width:100%;height:100%;display:block}
  </style></head><body><div class="wrap"><div class="inner">${svg}</div></div></body></html>`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html);
  const buf = await page.screenshot({ omitBackground: false, type: 'png', fullPage: false, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(path.join(root, out), buf);
  console.log('wrote', out, '(' + buf.length + ' bytes)');
}

for (const size of [192, 512]) {
  await render({ size, maskable: false, out: `icon-${size}.png` });
  await render({ size, maskable: true,  out: `icon-${size}-maskable.png` });
}
await browser.close();
