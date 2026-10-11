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
              return '& ' + source.slice(start,end).replace(/^\s*\\displaystyle\s*/, '') + (units[1] ? ' \\,\\text{' + units[1] + '}' : '');
            });
            if (lines.every(line => line !== null)) {
              edits.push({start:cellStart,end:cellEnd,value:'$\\displaystyle \\begin{aligned} ' + lines.join(' \\\\ ') + ' \\end{aligned}$'});
              continue;
            }
          }
          for (const [start,end] of math) {
            if (!/^\s*\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle)\b/.test(source.slice(start,end))) edits.push({start,end:start,value:'\\displaystyle '});
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
