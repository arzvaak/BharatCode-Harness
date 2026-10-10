import mermaid from 'mermaid';
import purify from 'dompurify';
import zenuml from '@mermaid-js/mermaid-zenuml';
let ready;
export function createEngine() {
  return ready ??= mermaid.registerExternalDiagrams([zenuml]).then(() => ({ mermaid, purify })).catch(error => { ready = undefined; throw error; });
}
