import * as React from 'react';
import { parseVisual, splitVisuals } from './model.js';
import { MermaidDiagram, validateMermaid } from './mermaid.js';
const h = React.createElement;
export const en = { source: 'Source', copy: 'Copy source', copied: 'Copied', export: 'Export SVG', data: 'View data', apply: 'Apply preview', cancel: 'Cancel', reset: 'Reset', edit: 'Edit visual source', preview: 'Edits affect this preview only. The conversation stays unchanged.', error: 'Could not apply this source', exportError: 'Export failed', copyError: 'Copy failed', label: 'Label', value: 'Value', note: 'Note', total: 'Total', point: 'Point', gallery: 'Visuals', galleryIntro: 'Charts and diagrams, right where the explanation needs them.', empty: 'Choose a visual to explore its design.' };
Object.assign(en, { rendering: 'Drawing diagram…', diagramError: 'Check the diagram syntax below.', from: 'From', to: 'To', condition: 'Condition' });
export const zh = { ...en };
const defaultT = key => en[key] || key;
const palette = ['#3976e8', '#13998d', '#c68a22', '#8873ca', '#c86883', '#5b8b40'];
const fmt = n => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, notation: Math.abs(n) >= 1e7 ? 'compact' : 'standard' }).format(n);
const color = i => palette[i % palette.length];
function words(text, size = 20) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const token of paragraph.split(/\s+/)) {
      if ((line + ' ' + token).length > size && line) { lines.push(line); line = ''; }
      // Break an exceptionally long token instead of overflowing the diagram.
      for (let i = 0; i < token.length; i += size) {
        const part = token.slice(i, i + size);
        if (i) { lines.push(line); line = part; }
        else line += (line ? ' ' : '') + part;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}
function textLines(text, x, y, width = 20, props = {}) {
  const lines = words(text, width);
  return h('text', { x, y, ...props }, lines.map((line, i) => h('tspan', { key: i, x, dy: i ? 17 : 0 }, line)));
}
function svgRoot(title, W, H, children, description) {
  return h('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title || description, className: 'dv-svg', xmlns: 'http://www.w3.org/2000/svg' },
    h('title', null, title || description), h('desc', null, description), children);
}
function spark(values, width = 90, height = 26) {
  if (values.length < 2) return '';
  const low = Math.min(...values), high = Math.max(...values), span = high - low || 1;
  return values.map((v, i) => `${i ? 'L' : 'M'}${i / (values.length - 1) * width},${height - (v - low) / span * (height - 4) - 2}`).join(' ');
}
function Metrics({ model, width = 720 }) {
  const count = model.rows.length, W = Math.max(280, width), cols = Math.min(count, W < 480 ? 1 : W < 650 ? 2 : 3), cell = W / cols;
  const layouts = model.rows.map(r => ({ label: words(r.label, Math.floor(cell / 8) - 2), note: words(r.note, Math.floor(cell / 7) - 2) }));
  const heights = Array.from({ length: Math.ceil(count / cols) }, (_, row) => Math.max(135, ...layouts.slice(row * cols, (row + 1) * cols).map(l => 110 + Math.max(0, l.label.length - 1) * 17 + Math.min(2, l.note.length) * 17)));
  const offsets = heights.map((_, row) => heights.slice(0, row).reduce((sum, v) => sum + v, 0));
  const H = heights.reduce((sum, v) => sum + v, 0);
  return svgRoot(model.title, W, H, model.rows.map((r, i) => {
    const row = Math.floor(i / cols), x = i % cols * cell, y = offsets[row];
    const { label, note } = layouts[i], valueY = y + 52 + Math.max(0, label.length - 1) * 17;
    return h('g', { key: i, className: 'dv-metric' },
      h('line', { x1: x + 3, y1: y + 8, x2: x + 3, y2: y + heights[row] - 22, stroke: color(i), strokeWidth: 3, strokeLinecap: 'round' }),
      textLines(label.join('\n'), x + 17, y + 21, 100, { className: 'dv-muted', fontSize: 13 }),
      h('text', { x: x + 17, y: valueY, fontSize: r.raw.length > 12 ? 23 : 32, fontWeight: 600, letterSpacing: '-0.6' }, r.raw.length > 22 ? r.raw.slice(0, 21) + '…' : r.raw),
      textLines(note.slice(0, 2).join('\n'), x + 17, valueY + 28, 100, { className: 'dv-muted', fontSize: 12 }),
      r.trend.length > 1 && h('path', { d: spark(r.trend, cell - 30, 19), transform: `translate(${x + 17} ${y + heights[row] - 28})`, stroke: color(i), fill: 'none', strokeWidth: 2 }));
  }), 'Key figures. Exact values are available in the data table.');
}
function Bars({ model }) {
  const W = 720, L = 192, R = 620, rowH = 58, H = model.rows.length * rowH + 34;
  const min = Math.min(0, ...model.rows.map(r => r.value)), max = Math.max(0, ...model.rows.map(r => r.value));
  const span = max - min || 1, x = v => L + (v - min) / span * (R - L), zero = x(0);
  return svgRoot(model.title, W, H, [
    h('line', { key: 'zero', x1: zero, x2: zero, y1: 4, y2: H - 27, className: 'dv-axis' }),
    ...model.rows.map((r, i) => {
      const y = i * rowH + 12, endpoint = x(r.value);
      return h('g', { key: i }, textLines(r.label, 0, y + 14, 24, { fontSize: 13, fontWeight: 500 }),
        h('rect', { x: L, y: y + 1, width: R - L, height: 24, rx: 4, className: 'dv-track' }),
        h('rect', { x: Math.min(zero, endpoint), y: y + 1, width: Math.max(1, Math.abs(endpoint - zero)), height: 24, rx: 4, fill: color(i) }, h('title', null, `${r.label}: ${fmt(r.value)} ${model.unit}`)),
        h('text', { x: W - 2, y: y + 18, textAnchor: 'end', fontSize: 13, fontWeight: 600 }, fmt(r.value)),
        r.note && h('text', { x: L, y: y + 44, fontSize: 11, className: 'dv-muted' }, r.note.slice(0, 64)));
    }), h('text', { key: 'min', x: L, y: H - 4, fontSize: 11, className: 'dv-muted' }, `${fmt(min)} ${model.unit}`),
    h('text', { key: 'max', x: R, y: H - 4, textAnchor: 'end', fontSize: 11, className: 'dv-muted' }, `${fmt(max)} ${model.unit}`),
  ], 'Values compared on a shared scale, including negative values.');
}
function Lines({ model }) {
  const [active, setActive] = React.useState(null);
  const W = 720, H = 330, L = 55, R = 700, T = 18, B = 245;
  const all = model.series.flatMap(s => s.values), low = Math.min(0, ...all), high = Math.max(0, ...all);
  const range = high - low || 1, min = low === high ? low - 0.5 : (low === 0 ? 0 : low - range * .08), max = low === high ? high + .5 : high + range * .08;
  const x = i => model.labels.length === 1 ? (L + R) / 2 : L + i / (model.labels.length - 1) * (R - L);
  const y = v => B - (v - min) / (max - min) * (B - T);
  const step = Math.max(1, Math.ceil(model.labels.length / 8));
  const labels = Array.from({ length: 5 }, (_, i) => min + i / 4 * (max - min));
  return h('div', null, svgRoot(model.title, W, H, [
    ...labels.map((v, i) => h('g', { key: `grid-${i}` },
      h('line', { x1: L, x2: R, y1: y(v), y2: y(v), className: 'dv-grid' }),
      h('text', { x: L - 10, y: y(v) + 4, textAnchor: 'end', fontSize: 11, className: 'dv-muted' }, fmt(v)))),
    ...model.labels.map((label, i) => i % step && i !== model.labels.length - 1 ? null : h('text', { key: `x-${i}`, x: x(i), y: B + 24, textAnchor: 'middle', fontSize: 11, className: 'dv-muted' }, label.length > 13 ? label.slice(0, 12) + '…' : label)),
    ...model.series.map((s, j) => h('g', { key: j },
      s.type === 'bar' ? s.values.map((v, i) => h('rect', { key: i, x: x(i) - 7 + j * 10, y: Math.min(y(0), y(v)), width: 8, height: Math.max(1, Math.abs(y(v) - y(0))), fill: color(j), opacity: .7 }))
        : h('path', { d: s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' '), stroke: color(j), strokeWidth: 2.5, fill: 'none', strokeLinejoin: 'round', strokeLinecap: 'round', strokeDasharray: j === 1 ? '6 4' : j === 2 ? '2 4' : undefined }),
      ...s.values.map((v, i) => h('circle', { key: `point-${i}`, cx: x(i), cy: y(v), r: active?.j === j && active?.i === i ? 6 : 3.5,
        fill: color(j), stroke: 'var(--dv-paper)', strokeWidth: 2, tabIndex: 0, role: 'button', 'aria-label': `${s.name}, ${model.labels[i]}: ${fmt(v)} ${model.unit}`,
        onMouseEnter: () => setActive({ i, j }), onMouseLeave: () => setActive(null), onFocus: () => setActive({ i, j }), onBlur: () => setActive(null),
        onClick: () => setActive({ i, j }), onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive({ i, j }); } },
      }, h('title', null, `${s.name}, ${model.labels[i]}: ${fmt(v)} ${model.unit}`))))),
  ], 'Series compared across the horizontal axis. Focus or hover a point for its exact value.'),
    h('div', { className: 'dv-legend' }, model.series.map((s, i) => h('span', { key: i }, h('i', { style: { background: color(i) } }), s.name))),
    h('div', { className: 'dv-point-readout', 'aria-live': 'polite' }, active ? `${model.series[active.j].name} · ${model.labels[active.i]}: ${fmt(model.series[active.j].values[active.i])} ${model.unit}` : '\u00a0'));
}
function Flow({ model, id }) {
  // Kahn ranks keep branches together; the remaining cycle nodes occupy successive ranks.
  const indegree = new Map(model.nodes.map(n => [n.id, 0])), ranks = new Map(model.nodes.map(n => [n.id, 0]));
  for (const e of model.edges) indegree.set(e.to, indegree.get(e.to) + 1);
  const queue = model.nodes.filter(n => !indegree.get(n.id)).map(n => n.id), visited = new Set();
  while (queue.length) {
    const from = queue.shift(); visited.add(from);
    for (const e of model.edges.filter(e => e.from === from)) {
      ranks.set(e.to, Math.max(ranks.get(e.to), ranks.get(from) + 1));
      indegree.set(e.to, indegree.get(e.to) - 1);
      if (!indegree.get(e.to)) queue.push(e.to);
    }
  }
  let rank = Math.max(0, ...ranks.values());
  for (const n of model.nodes) if (!visited.has(n.id)) ranks.set(n.id, rank++);
  const grouped = new Map();
  for (const n of model.nodes) { const r = ranks.get(n.id); if (!grouped.has(r)) grouped.set(r, []); grouped.get(r).push(n); }
  const LR = model.direction === 'LR', nodeW = 174, nodeH = Math.max(66, ...model.nodes.map(n => words(n.label, 20).length * 17 + 28));
  const rankGap = LR ? 230 : nodeH + 70, breadthGap = LR ? nodeH + 64 : 215;
  const breadth = Math.max(...[...grouped.values()].map(g => g.length));
  const maxRank = Math.max(...ranks.values());
  const W = LR ? (maxRank + 1) * rankGap + 40 : breadth * breadthGap + 40;
  const H = LR ? breadth * breadthGap + 80 : (maxRank + 1) * rankGap + 70;
  const positions = new Map();
  for (const [r, group] of grouped) group.forEach((n, i) => positions.set(n.id, { x: LR ? 30 + r * rankGap : 30 + i * breadthGap + (breadth - group.length) * breadthGap / 2,
    y: LR ? 50 + i * breadthGap + (breadth - group.length) * breadthGap / 2 : 35 + r * rankGap }));
  return h('div', { className: 'dv-flow-scroll' }, svgRoot(model.title, W, H, [
    h('defs', { key: 'defs' }, h('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#8090a5' }))),
    ...model.edges.map((e, i) => {
      const a = positions.get(e.from), b = positions.get(e.to);
      let x1 = a.x + (LR ? nodeW : nodeW / 2), y1 = a.y + (LR ? nodeH / 2 : nodeH), x2 = b.x + (LR ? 0 : nodeW / 2), y2 = b.y + (LR ? nodeH / 2 : 0);
      const back = ranks.get(e.to) <= ranks.get(e.from);
      let d, lx, ly;
      if (back && LR) { y1 = a.y; y2 = b.y; x1 = a.x + nodeW / 2; x2 = b.x + nodeW / 2; const top = Math.max(8, Math.min(a.y, b.y) - 28 - i % 3 * 8); d = `M${x1},${y1} V${top} H${x2} V${y2}`; lx = (x1 + x2) / 2; ly = top - 5; }
      else if (back) { const right = W - 10 - i % 3 * 8; x1 = a.x + nodeW; x2 = b.x + nodeW; y1 = a.y + nodeH / 2; y2 = b.y + nodeH / 2; d = `M${x1},${y1} H${right} V${y2} H${x2}`; lx = right - 8; ly = (y1 + y2) / 2; }
      else if (LR) { const mid = (x1 + x2) / 2; d = `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`; lx = mid; ly = (y1 + y2) / 2 - 9; }
      else { const mid = (y1 + y2) / 2; d = `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`; lx = (x1 + x2) / 2 + 12; ly = mid; }
      return h('g', { key: `edge-${i}` }, h('path', { d, fill: 'none', stroke: '#8090a5', strokeWidth: 1.5, markerEnd: `url(#${id})` }), e.label && h('text', { x: lx, y: ly, textAnchor: 'middle', fontSize: 11, className: 'dv-edge-label' }, e.label));
    }),
    ...model.nodes.map((n, i) => {
      const p = positions.get(n.id), lines = words(n.label, 20);
      return h('g', { key: n.id }, h('rect', { x: p.x, y: p.y, width: nodeW, height: nodeH, rx: n.decision ? 22 : 9, className: 'dv-node', stroke: n.decision ? color(2) : color(i % 2), strokeWidth: n.decision ? 2 : 1 }),
        textLines(n.label, p.x + nodeW / 2, p.y + nodeH / 2 - (lines.length - 1) * 8.5 + 4, 20, { fontSize: 13, fontWeight: 500, textAnchor: 'middle' }));
    }),
  ], 'Directed process. Arrows indicate the direction; labelled connections describe decisions.'));
}
function Timeline({ model }) {
  const heights = model.rows.map(r => Math.max(78, words(r.note, 67).length * 17 + words(r.label, 52).length * 17 + 36));
  let cursor = 20;
  const points = model.rows.map((r, i) => { const y = cursor; cursor += heights[i]; return { ...r, y }; });
  return svgRoot(model.title, 720, cursor, [h('line', { key: 'spine', x1: 147, x2: 147, y1: 19, y2: points.at(-1).y + 10, className: 'dv-axis' }),
    ...points.map((r, i) => h('g', { key: i }, h('circle', { cx: 147, cy: r.y + 8, r: 5, fill: color(i) }),
      h('text', { x: 123, y: r.y + 13, textAnchor: 'end', fontSize: 12, className: 'dv-muted' }, r.raw.slice(0, 16)),
      textLines(r.label, 169, r.y + 13, 52, { fontSize: 15, fontWeight: 600 }),
      textLines(r.note, 169, r.y + 39 + (words(r.label, 52).length - 1) * 17, 67, { fontSize: 12, className: 'dv-muted' }))),
  ], 'Milestones in the order shown, with their dates and descriptions.');
}
function Steps({ model }) {
  let y = 12;
  const rows = model.rows.map((r, i) => { const p = { ...r, y, i }; y += Math.max(82, words(r.label, 58).length * 17 + words(r.note, 65).length * 17 + 45); return p; });
  return svgRoot(model.title, 720, y, rows.map(r => h('g', { key: r.i },
    h('circle', { cx: 18, cy: r.y + 14, r: 16, className: 'dv-step-disc' }), h('text', { x: 18, y: r.y + 19, textAnchor: 'middle', fontSize: 12, fontWeight: 600, fill: color(r.i) }, r.i + 1),
    textLines(r.label, 50, r.y + 19, 58, { fontSize: 15, fontWeight: 600 }),
    h('text', { x: 710, y: r.y + 18, textAnchor: 'end', fontSize: 11, className: 'dv-muted' }, r.raw.slice(0, 14)),
    textLines(r.note, 50, r.y + 44 + (words(r.label, 58).length - 1) * 17, 65, { fontSize: 12, className: 'dv-muted' }),
  )), 'An ordered procedure with time estimates and details.');
}
function Donut({ model, t }) {
  const total = model.rows.reduce((s, r) => s + r.value, 0), radius = 81, circumference = 2 * Math.PI * radius;
  let offset = 0;
  return svgRoot(model.title, 720, Math.max(260, model.rows.length * 35 + 25), [
    ...model.rows.map((r, i) => { const start = offset; offset += r.value / total * circumference; return h('circle', { key: i, cx: 135, cy: 130, r: radius,
      fill: 'none', stroke: color(i), strokeWidth: 24, strokeDasharray: `${Math.max(0, r.value / total * circumference - (model.rows.length > 1 ? 2 : 0))} ${circumference}`, strokeDashoffset: -start,
      transform: 'rotate(-90 135 130)' }, h('title', null, `${r.label}: ${fmt(r.value)} (${fmt(r.value / total * 100)}%)`)); }),
    h('text', { key: 'total', x: 135, y: 126, textAnchor: 'middle', fontSize: 29, fontWeight: 600 }, fmt(total)),
    h('text', { key: 'unit', x: 135, y: 150, textAnchor: 'middle', fontSize: 12, className: 'dv-muted' }, model.unit || t('total')),
    ...model.rows.map((r, i) => h('g', { key: `label-${i}` }, h('circle', { cx: 292, cy: 27 + i * 35, r: 4, fill: color(i) }),
      h('text', { x: 307, y: 31 + i * 35, fontSize: 13 }, r.label.slice(0, 32)),
      h('text', { x: 617, y: 31 + i * 35, textAnchor: 'end', fontSize: 13, fontWeight: 600 }, fmt(r.value)),
      h('text', { x: 714, y: 31 + i * 35, textAnchor: 'end', fontSize: 12, className: 'dv-muted' }, `${fmt(r.value / total * 100)}%`))),
  ], 'Parts of a whole. Labels give exact amounts and percentages.');
}
function tableData(model) {
  if (model.kind === 'line') return { headers: ['Point', ...model.series.map(s => s.name)], rows: model.labels.map((l, i) => [l, ...model.series.map(s => fmt(s.values[i]))]) };
  if (model.kind === 'flowchart') return { headers: ['From', 'To', 'Condition'], rows: model.edges.map(e => [model.nodes.find(n => n.id === e.from).label, model.nodes.find(n => n.id === e.to).label, e.label]) };
  return { headers: ['Label', 'Value', 'Note'], rows: model.rows.map(r => [r.label, r.raw, r.note]) };
}
export function exportSVG(svg) {
  const clone = svg.cloneNode(true), originals = [svg, ...svg.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
  originals.forEach((el, i) => {
    const computed = getComputedStyle(el);
    for (const prop of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'opacity', 'paint-order']) copies[i].style.setProperty(prop, computed.getPropertyValue(prop));
    copies[i].removeAttribute('tabindex'); copies[i].removeAttribute('role');
  });
  const box = (svg.getAttribute('viewBox') || '').trim().split(/[ ,]+/).map(Number);
  if (box.length !== 4 || box.some(v => !Number.isFinite(v)) || box[2] <= 0 || box[3] <= 0) throw new Error('The SVG has no valid dimensions.');
  clone.setAttribute('width', box[2]); clone.setAttribute('height', box[3]);
  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('width', '100%'); background.setAttribute('height', '100%');
  background.setAttribute('fill', getComputedStyle(svg.closest('.dv-figure')).backgroundColor || '#ffffff');
  clone.insertBefore(background, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}
/** A self-contained graphic with local editing, accessible data and export. */
export function VisualFigure({ source, language = 'visual', t = defaultT }) {
  const [edited, setEdited] = React.useState(null), [draft, setDraft] = React.useState(source), [editing, setEditing] = React.useState(false), [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
  const root = React.useRef(null), id = 'dv-' + React.useId().replace(/:/g, '');
  const [width, setWidth] = React.useState(720);
  React.useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !root.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.min(720, entries[0].contentRect.width)));
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  React.useEffect(() => { setEdited(null); setDraft(source); setError(''); }, [source]);
  const value = edited ?? source;
  let model;
  try { model = parseVisual(value, language); } catch (cause) { return h('pre', { className: 'dv-fallback' }, value); }
  const tables = model.kind === 'mermaid' ? null : tableData(model);
  const charts = { metrics: Metrics, bars: Bars, line: Lines, flowchart: Flow, timeline: Timeline, steps: Steps, donut: Donut, mermaid: MermaidDiagram };
  const copy = async () => { try { await navigator.clipboard.writeText(value); setNotice(t('copied')); } catch { setNotice(t('copyError')); } };
  const download = () => {
    try {
      const svg = root.current.querySelector('svg');
      const blob = new Blob([exportSVG(svg)], { type: 'image/svg+xml' }), url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = (model.title || model.kind).replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 80) + '.svg'; document.body.append(a); a.click(); a.remove();
      // Keep the object alive until the browser has consumed the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setNotice(t('exportError')); }
  };
  return h('figure', { ref: root, className: 'dv-figure', 'data-visual-kind': model.kind },
    h('div', { className: 'dv-heading' }, h('figcaption', null, model.title || model.kind), h('div', { className: 'dv-actions' },
      h('button', { type: 'button', onClick: () => { setDraft(value); setEditing(!editing); setError(''); } }, t('source')),
      h('button', { type: 'button', onClick: copy }, t('copy')), h('button', { type: 'button', onClick: download }, t('export')))),
    h('div', { className: 'dv-canvas' }, h(charts[model.kind], { model, id, t, width })),
    model.caption && h('p', { className: 'dv-caption' }, model.caption),
    tables && h('details', { className: 'dv-data' }, h('summary', null, t('data')), h('div', { className: 'dv-table-scroll' }, h('table', null,
      h('thead', null, h('tr', null, tables.headers.map((s, i) => h('th', { key: i, scope: 'col' }, ({ Label: t('label'), Value: t('value'), Note: t('note'), Point: t('point'), From: t('from'), To: t('to'), Condition: t('condition') })[s] || s)))),
      h('tbody', null, tables.rows.map((r, i) => h('tr', { key: i }, r.map((s, j) => h(j ? 'td' : 'th', { key: j, ...(j ? {} : { scope: 'row' }) }, s)))))))),
    editing && h('div', { className: 'dv-editor' }, h('label', { htmlFor: id + '-source' }, t('edit')), h('textarea', { id: id + '-source', value: draft, spellCheck: false, onChange: e => setDraft(e.target.value), rows: 9 }),
      h('p', null, t('preview')), error && h('p', { role: 'alert', className: 'dv-error' }, `${t('error')}: ${error}`),
      h('div', { className: 'dv-editor-actions' }, h('button', { onClick: async () => { try { const parsed = parseVisual(draft, language); if (parsed.kind === 'mermaid') await validateMermaid(draft); setEdited(draft); setEditing(false); setError(''); } catch (e) { setError(e.message); } } }, t('apply')),
        h('button', { onClick: () => setEditing(false) }, t('cancel')), edited !== null && h('button', { onClick: () => { setEdited(null); setDraft(source); setEditing(false); } }, t('reset')))),
    h('span', { className: 'dv-notice', role: 'status' }, notice));
}

/** Preserve native UI behaviour while placing visuals between native prose segments. */
export function makeAssistantWrapper(Native, useTranslate = () => defaultT) {
  return function VisualAssistant(props) {
    const t = useTranslate();
    const { data } = props.node;
    if (props.groupPart === 'reasoning') return h(Native, props);
    const pieces = []; let pending = [], index = 0, hasVisual = false;
    const flush = () => { if (pending.length) { pieces.push({ type: 'native', blocks: pending, key: `native-${index++}` }); pending = []; } };
    for (const block of data.blocks) {
      if (block.kind !== 'text') { pending.push(block); continue; }
      for (const part of splitVisuals(block.text, data.status === 'running')) {
        if (part.type === 'prose') pending.push({ ...block, text: part.text });
        else { flush(); hasVisual = true; pieces.push({ ...part, key: `visual-${index++}` }); }
      }
    }
    flush();
    if (!hasVisual) return h('div', { className: 'dv-answer' }, h(Native, { ...props, key: 'native-0' }));
    // An interrupted reply ending in a graphic still gets the native stopped marker once.
    if (data.status === 'interrupted' && pieces.at(-1)?.type !== 'native') pieces.push({ type: 'native', blocks: [], key: 'terminal' });
    return h('div', { className: 'dv-answer' }, pieces.map((piece, i) => piece.type === 'visual'
      ? h(VisualFigure, { key: piece.key, source: piece.source, language: piece.language, t })
      : h(Native, { ...props, key: piece.key, node: { ...props.node, data: { ...data, blocks: piece.blocks,
        status: data.status === 'interrupted' && i !== pieces.length - 1 ? 'settled' : data.status } } })));
  };
}
