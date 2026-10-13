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
  assert.ok(formatted.includes(String.raw`$\displaystyle [r^n(\prod_{i<j}d_{ij}^2)]^{\frac{1}{n^2}}$`));
  assert.ok(formatted.includes(String.raw`\text{H/m} \\ & =0.4605`));
  assert.ok(formatted.includes(String.raw`\text{mH/km}`));
  assert.ok(formatted.startsWith('Inline $a+b$.'));
  assert.ok(source.includes(String.raw`$2\times10^{-7}\ln(D/r)$ H/m`));
  assert.ok(formatted.includes(String.raw`& 2\times10^{-7}\ln(\frac{D}{r})`));
  assert.equal(prepareReadingText(formatted), formatted);
});

test('ordinary tables, source code, escaped dollars and unfinished math stay intact', () => {
  const source = '| A | B | C |\n|---|---|---|\n| 1 | $x$ | 3 |\n\n```md\n| A | B |\n|---|---|\n| x | $a$ |\n```\n\n| A | B |\n|---|---|\n| price | \\$20 |\n| source | `$x$` |\n| unfinished | $x |';
  assert.equal(prepareReadingText(source), source);
});

test('formula tables show unambiguous division as stacked fractions and preserve units', () => {
  const source = String.raw`| Quantity | Formula |
|---|---|
| L | $2\times10^{-7}\ln(\text{GMD}/D_s)$ H/m $=0.4605\log_{10}(\text{GMD}/D_s)$ mH/km |
| C | $2\pi\varepsilon_0/\ln(\text{GMD}/r)$ F/m $=0.0242/\log_{10}(\text{GMD}/r)$ μF/km |
| Z | $Z_c=\sqrt{L/C}$ $P_n=V_{LL}^2/Z_c$ |`;
  const formatted = prepareReadingText(source);
  assert.ok(formatted.includes(String.raw`\frac{\text{GMD}}{D_s}`));
  assert.ok(formatted.includes(String.raw`\frac{2\pi\varepsilon_0}{\ln(\frac{\text{GMD}}{r})}`));
  assert.ok(formatted.includes(String.raw`\frac{0.0242}{\log_{10}(\frac{\text{GMD}}{r})}`));
  assert.ok(formatted.includes(String.raw`\sqrt{\frac{L}{C}}`));
  assert.ok(formatted.includes(String.raw`\frac{V_{LL}^2}{Z_c}`));
  assert.ok(formatted.includes(String.raw`\text{H/m}`));
  assert.equal(prepareReadingText(formatted), formatted);
  assert.equal(prepareReadingText('Inline $L/C$. Code `GMD/r`.'), 'Inline $L/C$. Code `GMD/r`.');
});


test('ambiguous slash chains and text labels are preserved', () => {
  const source = String.raw`| Quantity | Formula |
|---|---|
| A | $a/b/c$ |
| B | $a/b c$ |
| U | $\text{H/m}$ |`;
  const result = prepareReadingText(source);
  assert.ok(result.includes('$\\displaystyle a/b/c$'));
  assert.ok(result.includes('$\\displaystyle a/b c$'));
  assert.ok(result.includes(String.raw`\text{H/m}`));
});
