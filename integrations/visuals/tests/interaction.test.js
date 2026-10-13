import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { VisualFigure } from '../src/view.js';
import { configureMermaidEngine, validateMermaid } from '../src/mermaid.js';

async function mounted(run) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const saved = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, MutationObserver: dom.window.MutationObserver, DOMParser: dom.window.DOMParser, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  try { await run(root, dom.window); }
  finally {
    await act(() => root.unmount());
    for (const [key, value] of saved) value ? Object.defineProperty(globalThis, key, value) : delete globalThis[key];
    dom.window.close();
  }
}

test('source disclosure exposes state, Escape closes it and restores keyboard focus', async () => {
  await mounted(async (root, win) => {
    await act(() => root.render(React.createElement(VisualFigure, {source:'bars\ntitle Budget\nHosting | 1200'})));
    const source = document.querySelector('button');
    assert.equal(source.getAttribute('aria-expanded'), 'false');
    await act(() => source.click());
    assert.equal(source.getAttribute('aria-expanded'), 'true');
    const editor = document.getElementById(source.getAttribute('aria-controls'));
    assert.ok(editor?.querySelector('textarea'));
    await act(() => editor.querySelector('textarea').dispatchEvent(new win.KeyboardEvent('keydown', {key:'Escape', bubbles:true})));
    assert.equal(document.querySelector('textarea'), null);
    assert.equal(document.activeElement, source);
  });
});

test('simple charts fit a narrow panel without forced horizontal scrolling', async () => {
  await mounted(async root => {
    let resize;
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {constructor(callback){resize=callback;} observe(){} disconnect(){}};
    try {
      for (const source of ['bars\nHosting | 1200\nCredits | -200', 'line\nx-axis [0, 1, 2]\nline "Loss" [2, 1, 0]', 'timeline\nVerify | Oct 11 | Check the UI', 'steps\nVerify | 5 min | Check the UI', 'donut\nBuild | 60\nVerify | 40']) {
        await act(() => root.render(React.createElement(VisualFigure, {source})));
        await act(() => resize([{contentRect:{width:320}}]));
        const width = Number(document.querySelector('svg').getAttribute('viewBox').split(' ')[2]);
        assert.equal(width, 320, source);
      }
    } finally {globalThis.ResizeObserver = original;}
  });
});

test('reduced motion suppresses reveals and normal updates do not replay them', async () => {
  await mounted(async (root, win) => {
    const saved = {matchMedia:globalThis.matchMedia};
    let allowed = false, animations = 0, cancels = 0;
    globalThis.matchMedia = () => ({matches:allowed});
    win.Element.prototype.animate = () => {animations++; return {cancel(){cancels++;}};};
    try {
      const source = 'bars\nHosting | 1200';
      await act(() => root.render(React.createElement(VisualFigure, {source})));
      assert.equal(animations, 0);
      allowed = true;
      await act(() => root.render(React.createElement(VisualFigure, {source:source + '\nCredits | -200'})));
      assert.ok(animations >= 1);
      const count = animations;
      await act(() => document.querySelector('button').click());
      assert.equal(animations, count);
      await act(() => root.unmount());
      assert.equal(cancels, animations);
    } finally {globalThis.matchMedia = saved.matchMedia;}
  });
});

test('line legends isolate series without allowing an empty chart and points support arrow navigation', async () => {
  await mounted(async (root, win) => {
    await act(() => root.render(React.createElement(VisualFigure, {source:'line\nx-axis [A, B, C]\nline "First" [3, 2, 1]\nline "Second" [4, 3, 2]'})));
    const legends = [...document.querySelectorAll('.dv-legend button')];
    assert.equal(legends.length, 2);
    await act(() => legends[1].click());
    assert.equal(legends[1].getAttribute('aria-pressed'), 'false');
    assert.equal(document.querySelectorAll('circle[role=button]').length, 3);
    assert.equal(legends[0].disabled, true);
    const point = document.querySelector('circle[role=button]');
    await act(() => point.dispatchEvent(new win.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true})));
    assert.match(document.activeElement.getAttribute('aria-label'), /First, B: 2/);
    assert.match(document.querySelector('.dv-point-readout').textContent, /First · B: 2/);
  });
});

test('diagrams expose bounded zoom, fit resets it, and source replacement clears zoom', async () => {
  await mounted(async root => {
    const source = 'flowchart LR\nA[Start] --> B[Finish]';
    await act(() => root.render(React.createElement(VisualFigure, {source})));
    const button = label => [...document.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === label);
    assert.ok(button('Zoom in'));
    await act(() => button('Zoom in').click());
    assert.equal(document.querySelector('[data-visual-zoom]').getAttribute('data-visual-zoom'), '1.25');
    const canvas = document.querySelector('[data-visual-zoom]');
    canvas.scrollTop = 200; canvas.scrollLeft = 300;
    await act(() => button('Fit diagram').click());
    assert.equal(canvas.scrollTop, 0); assert.equal(canvas.scrollLeft, 0);
    assert.equal(document.querySelector('[data-visual-zoom]').getAttribute('data-visual-zoom'), '1');
    for (let i = 0; i < 12; i++) await act(() => button('Zoom in').click());
    assert.equal(button('Zoom in').disabled, true);
    await act(() => root.render(React.createElement(VisualFigure, {source:source + '\nB --> C[Done]'})));
    assert.equal(document.querySelector('[data-visual-zoom]').getAttribute('data-visual-zoom'), '1');
  });
});

test('changing reduced-motion preference cancels active animations immediately', async () => {
  await mounted(async (root, win) => {
    const previous = globalThis.matchMedia;
    let listener, cancelled = 0, started = 0;
    const preference = {matches:true, addEventListener(_event, callback){listener=callback;}, removeEventListener(){listener=null;}};
    globalThis.matchMedia = () => preference;
    win.Element.prototype.animate = () => {started++; return {cancel(){cancelled++;}};};
    try {
      await act(() => root.render(React.createElement(VisualFigure, {source:'bars\nBuild | 3\nVerify | 2'})));
      assert.ok(started > 1);
      preference.matches = false;
      listener();
      assert.equal(cancelled, started);
      await act(() => root.unmount());
      assert.equal(listener, null);
      assert.equal(cancelled, started);
    } finally {globalThis.matchMedia = previous;}
  });
});

test('SVG exports preserve final geometry and dashed strokes during reveals', async () => {
  await mounted(async (_root, win) => {
    const { exportSVG } = await import('../src/view.js');
    const prior = {getComputedStyle:globalThis.getComputedStyle, XMLSerializer:globalThis.XMLSerializer};
    globalThis.XMLSerializer = win.XMLSerializer;
    document.querySelector('#root').innerHTML = '<figure class="dv-figure"><svg viewBox="0 0 200 100"><g opacity=".8"><path d="M0 0 L200 100" stroke-dasharray="5 4" transform="translate(2 3)"/></g></svg></figure>';
    const svg = document.querySelector('svg');
    svg.querySelector('g').getAnimations = () => [{}];
    globalThis.getComputedStyle = el => ({backgroundColor:'#24221e', getPropertyValue:prop => prop === 'opacity' ? '0' : prop === 'stroke-dasharray' ? el.getAttribute(prop) || 'none' : ''});
    try {
      const exported = new win.DOMParser().parseFromString(exportSVG(svg), 'image/svg+xml');
      assert.equal(exported.querySelector('g').style.opacity, '0.8');
      assert.equal(exported.querySelector('path').getAttribute('d'), 'M0 0 L200 100');
      assert.equal(exported.querySelector('path').getAttribute('transform'), 'translate(2 3)');
      assert.equal(exported.querySelector('path').style.strokeDasharray, '5 4');
    } finally {Object.assign(globalThis, prior);}
  });
});

test('diagram Fit recalculates when the output pane grows beyond the chart width cap', async () => {
  await mounted(async root => {
    let resize;
    const previous = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {constructor(callback){resize=callback;} observe(){} disconnect(){}};
    try {
      const source = 'flowchart TD\n' + Array.from({length:23},(_,i)=>`N${i}[Stage ${i}] --> N${i+1}[Stage ${i+1}]`).join('\n');
      await act(() => root.render(React.createElement(VisualFigure, {source})));
      await act(() => resize([{contentRect:{width:800}}]));
      const canvas = document.querySelector('[data-visual-zoom]');
      const first = Number(canvas.getAttribute('data-visual-zoom'));
      await act(() => resize([{contentRect:{width:1000}}]));
      const second = Number(canvas.getAttribute('data-visual-zoom'));
      assert.ok(Math.abs(second / first - .8) < .0001);
    } finally {globalThis.ResizeObserver = previous;}
  });
});

test('delayed diagram Apply cannot overwrite a newer source', async () => {
  await mounted(async root => {
    let release, validating;
    const started = new Promise(resolve => { validating = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    const rendered = [];
    const a = 'flowchart LR\nA[Old] --> B[Draft]';
    const b = 'flowchart LR\nC[New] --> D[Source]';
    configureMermaidEngine(() => ({
      mermaid: {
        initialize() {},
        async parse(source) { if (source === a) { validating(); await pending; } },
        async render(id, source) { rendered.push(source); return {svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text>${source === b ? 'New source' : 'Old draft'}</text></svg>`}; },
      },
      purify: {sanitize: source => source},
    }));
    await act(async () => { root.render(React.createElement(VisualFigure, {source:a, language:'mermaid'})); });
    await act(async () => { await validateMermaid('barrier'); });
    await act(() => document.querySelector('.dv-actions button').click());
    await act(async () => { document.querySelector('.dv-editor-actions button').click(); await started; });
    await act(() => root.render(React.createElement(VisualFigure, {source:b, language:'mermaid'})));
    assert.equal(document.querySelector('textarea'), null);
    await act(async () => { release(); await validateMermaid('barrier'); });
    assert.equal(document.querySelector('svg text').textContent, 'New source');
    assert.equal(rendered.at(-1), b);
    assert.equal(rendered.filter(source => source === a).length, 1);
    assert.equal(document.querySelector('[role="alert"]'), null);
  });
});
