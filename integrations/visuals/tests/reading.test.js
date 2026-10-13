import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareReadingText } from '../src/reading.js';

test('formula-table math gets display metrics without changing the original answer', () => {
  const source = String.raw`Inline $a+b$.

| Quantity | Formula |
|---|---|
| Bundle | $[r^n(\prod_{i<j}d_{ij}^2)]^{1/n^2}$ |
| L | $2\times10^{-7}\ln(D/r)$ H/m $=0.4605\log_{10}(D/r)$ mH/km |`;
  const formatted = prepareReadingText(source);
  assert.ok(formatted.includes(String.raw`$\displaystyle [r^n(\prod_{i<j}d_{ij}^2)]^{1/n^2}$`));
  assert.ok(formatted.includes(String.raw`\text{H/m} \\ & =0.4605`));
  assert.ok(formatted.includes(String.raw`\text{mH/km}`));
  assert.ok(formatted.startsWith('Inline $a+b$.'));
  assert.ok(source.includes(String.raw`$2\times10^{-7}\ln(D/r)$ H/m`));
  assert.ok(formatted.includes(String.raw`& 2\times10^{-7}\ln(D/r)`));
  assert.equal(prepareReadingText(formatted), formatted);
});

test('ordinary tables, source code, escaped dollars and unfinished math stay intact', () => {
  const source = '| A | B | C |\n|---|---|---|\n| 1 | $x$ | 3 |\n\n```md\n| A | B |\n|---|---|\n| x | $a$ |\n```\n\n| A | B |\n|---|---|\n| price | \\$20 |\n| source | `$x$` |\n| unfinished | $x |';
  assert.equal(prepareReadingText(source), source);
});
