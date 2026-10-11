/**
 * Wrap app HTML in the sandbox bootstrap document with a restrictive resource policy.
 * @param html - Admitted MCP app HTML resource.
 * @returns Sandbox document containing the bootstrap and resource policy.
 */
export function sandboxDocument(html: string): string {
  const policy =
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  const content = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}">${html}`
  // The app cannot reach the relay DOM: both frames have distinct opaque origins.
  // frame-src on the trusted parent also denies an app's self-navigation, which
  // connect-src on a single app frame would not prevent.
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style><script>
const child=document.createElement('iframe');child.setAttribute('sandbox','allow-scripts');child.referrerPolicy='no-referrer';
child.srcdoc=${JSON.stringify(content).replaceAll('<', '\\u003c')};
window.addEventListener('message',event=>{if(event.source===parent)child.contentWindow?.postMessage(event.data,'*');else if(event.source===child.contentWindow)parent.postMessage(event.data,'*')});
document.addEventListener('DOMContentLoaded',()=>document.body.append(child));
</script>`
}
