import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';

// Project presentation commands into settled formula tables only. Persisted
// answers remain untouched. Source offsets preserve TeX; code and URLs are skipped.
function mathRanges(source, node) {
  if (node.type !== 'text') return (node.children || []).flatMap(child => mathRanges(source, child));
  const start = node.position?.start.offset, end = node.position?.end.offset;
  if (start === undefined || end === undefined) return [];
  const text = source.slice(start, end), ranges = [];
  const escaped = index => { let slashes = 0; while (index > 0 && text[--index] === '\\') slashes++; return slashes % 2 === 1; };
  let opening = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '$' || escaped(i) || text[i-1] === '$' || text[i+1] === '$') continue;
    if (opening < 0) opening = i;
    else { if (i > opening + 1) ranges.push([start + opening + 1, start + i]); opening = -1; }
  }
  return ranges;
}
// Parse simple TeX products rather than replacing arbitrary slash text. A single
// denominator atom is unambiguous; chained division and mixed prose stay as authored.
function readingFractions(tex, depth = 0) {
  if (depth > 24 || !tex.includes('/')) return tex;
  let i = 0;
  const tokens = [];
  function group(opaque = false) {
    const open = tex[i], close = open === '{' ? '}' : open === '(' ? ')' : ']';
    const start = ++i;
    let level = 1;
    while (i < tex.length && level) {
      if (tex[i] === open && tex[i-1] !== '\\') level++;
      if (tex[i] === close && tex[i-1] !== '\\') level--;
      if (level) i++;
    }
    if (level) return open + tex.slice(start);
    const inner = tex.slice(start, i++);
    return open + (opaque ? inner : readingFractions(inner, depth + 1)) + close;
  }
  function suffix() {
    let value = '';
    while (tex[i] === '_' || tex[i] === '^' || tex[i] === "'") {
      const mark = tex[i++];
      value += mark;
      if (mark !== "'") value += tex[i] === '{' ? group() : (tex[i++] ?? '');
    }
    return value;
  }
  while (i < tex.length) {
    const c = tex[i];
    if (/\s/.test(c)) { tokens.push({kind:'space',value:c}); i++; continue; }
    if ('/+=-&;,'.includes(c)) { tokens.push({kind:'operator',value:c}); i++; continue; }
    let value;
    if (c === '\\') {
      const command = tex.slice(i).match(/^\\(?:[A-Za-z]+|[,;! ])/);
      if (!command) return tex;
      value = command[0]; i += value.length;
      const opaque = /^\\(?:text|mathrm|operatorname)$/.test(value);
      value += suffix();
      if (tex[i] === '{' || tex[i] === '(' || tex[i] === '[') value += group(opaque);
      // A fraction owns two brace arguments; neither becomes a separate product.
      if (command[0] === '\\frac' && tex[i] === '{') value += group();
    } else if (c === '{' || c === '(' || c === '[') value = group();
    else {
      const atom = tex.slice(i).match(/^(?:[A-Za-z]+|\d+(?:\.\d+)?)/);
      if (!atom) return tex;
      value = atom[0]; i += value.length;
    }
    value += suffix();
    tokens.push({kind:'atom',value});
  }
  const render = part => {
    const slash = part.flatMap((t,j) => t.value === '/' ? [j] : []);
    if (slash.length !== 1) return part.map(t=>t.value).join('');
    const left = part.slice(0,slash[0]), right = part.slice(slash[0]+1);
    const atoms = side => side.filter(t=>t.kind !== 'space');
    if (!atoms(left).length || atoms(right).length !== 1 ||
        ![...atoms(left),...atoms(right)].every(t=>t.kind === 'atom')) return part.map(t=>t.value).join('');
    return '\\frac{' + left.map(t=>t.value).join('').trim() + '}{' + right.map(t=>t.value).join('').trim() + '}';
  };
  let output = '', part = [];
  for (const token of tokens) {
    if (token.kind === 'operator' && token.value !== '/') { output += render(part) + token.value; part = []; }
    else part.push(token);
  }
  return output + render(part);
}
export function prepareReadingText(source) {
  if (!source.includes('|') || !source.includes('$') || source.length > 262144) return source;
  const root = fromMarkdown(source, {extensions:[gfm()], mdastExtensions:[gfmFromMarkdown()]});
  const edits = [];
  function visit(node) {
    if (node.type === 'table' && node.children[0]?.children.length === 2) {
      const cells = node.children.slice(1).map(row => row.children[1]);
      const ranges = cells.map(cell => cell ? mathRanges(source, cell) : []);
      if (ranges.filter(r => r.length).length >= Math.max(1, cells.length / 2)) {
        for (let index = 0; index < ranges.length; index++) {
          const cell = cells[index], math = ranges[index];
          const cellStart = cell?.children[0]?.position?.start.offset, cellEnd = cell?.children.at(-1)?.position?.end.offset;
          // Keep units attached, and put equivalent expressions on separate
          // aligned lines. Mixed Markdown or unknown prose takes the fallback.
          if (math.length > 1 && cell.children.every(child => child.type === 'text') &&
              source.slice(cellStart, math[0][0]-1).trim() === '') {
            const lines = math.map(([start,end], i) => {
              const suffix = source.slice(end+1, i+1 < math.length ? math[i+1][0]-1 : cellEnd).trim();
              const units = suffix.match(/^[\s,;]*(H\/m|mH\/km|F\/m|[μµ]F\/km)?[\s,;]*$/);
              if (!units) return null;
              return '& ' + readingFractions(source.slice(start,end).replace(/^\s*\\displaystyle\s*/, '')) + (units[1] ? ' \\,\\text{' + units[1] + '}' : '');
            });
            if (lines.every(line => line !== null)) {
              edits.push({start:cellStart,end:cellEnd,value:'$\\displaystyle \\begin{aligned} ' + lines.join(' \\\\ ') + ' \\end{aligned}$'});
              continue;
            }
          }
          for (const [start,end] of math) {
            const original = source.slice(start,end), fraction = readingFractions(original);
            const style = /^\s*\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle)\b/.test(original) ? '' : '\\displaystyle ';
            if (style || fraction !== original) edits.push({start,end,value:style + fraction});
          }
        }
      }
    } else for (const child of node.children || []) visit(child);
  }
  visit(root);
  let result = source;
  for (const edit of edits.sort((a,b) => b.start-a.start)) result = result.slice(0,edit.start) + edit.value + result.slice(edit.end);
  return result;
}
