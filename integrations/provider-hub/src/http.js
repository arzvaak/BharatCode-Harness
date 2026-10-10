/** This route accepts only the authenticated local desktop's same-origin requests. */
export function trusted(req) {
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)||req.headers['sec-fetch-site']==='cross-site')return false;
  try {const base=new URL(`http://${req.headers.host}`);if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname)||base.username||base.password||base.pathname!=='/')return false;
    return req.headers.origin ? new URL(req.headers.origin).host===base.host : req.headers['sec-fetch-site']==='same-origin'|| /(?:^|;)\s*dsh-auth-[^=]+=.+/.test(req.headers.cookie||'');
  }catch{return false;}
}
export function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
export async function body(req){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw Error('JSON required');let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)throw Error('Request too large');chunks.push(chunk);}const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Invalid request');return value;}
