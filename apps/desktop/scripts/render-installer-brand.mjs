/** Reproducible native installer artwork from the same vector mark as the app icon. */
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const root = new URL('../installer/assets/', import.meta.url)
const mark = (await readFile(new URL('../resources/icon-windows.svg', import.meta.url), 'utf8'))
  .replace(/<\/?svg[^>]*>/g, '').replace(/<title>.*?<\/title>/g, '')
for (const [name, width, height, dark, scale] of [
  ['brand', 600, 196, false, 1], ['brand-2x', 1200, 392, false, 2],
  ['brand-dark', 600, 196, true, 1], ['brand-dark-2x', 1200, 392, true, 2],
  ['uninstaller-sidebar', 164, 314, false, 1],
]) {
  const sidebar = name === 'uninstaller-sidebar'
  const iconSize = sidebar ? 128 : 132
  const iconX = sidebar ? 18 : 234
  const iconY = sidebar ? 64 : 0
  const textY = sidebar ? 222 : 180
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width / scale} ${height / scale}">
    <rect width="100%" height="100%" fill="${dark ? '#151517' : '#ffffff'}"/>
    <g transform="translate(${iconX} ${iconY}) scale(${iconSize / 512})">${mark}</g>
    <text x="${width / scale / 2}" y="${textY}" text-anchor="middle" font-family="DejaVu Sans,sans-serif" font-size="${sidebar ? 19 : 32}" font-weight="700" fill="${dark ? '#ffffff' : '#0f1115'}">BharatCode</text>
  </svg>`
  await writeFile(new URL(`${name}.png`, root), await sharp(Buffer.from(svg)).png().toBuffer())
}
