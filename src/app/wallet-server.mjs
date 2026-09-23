import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {walletSession} from './wallet-session.mjs';
const root=new URL('../../',import.meta.url);
export function createWalletServer({session=walletSession()}={}){
 const nonce=randomBytes(32).toString('hex');
 const files={'/':['web/wallet.html','text/html'],'/wallet.js':['web/wallet.js','text/javascript'],'/wallet-standard.js':['web/wallet-standard.js','text/javascript'],'/web3.js':['node_modules/@solana/web3.js/lib/index.iife.min.js','text/javascript']};
 const server=http.createServer(async(req,res)=>{
  const origin='http://127.0.0.1:'+server.address().port;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const json=(status,data)=>{if(status>=400){res.setHeader('Connection','close');req.resume();}res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  try{
   if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site')return json(403,{error:'ORIGIN_REJECTED'});
   const path=new URL(req.url,origin).pathname;
   if(req.method==='GET'&&path==='/api/session')return json(200,{csrfToken:nonce,...session.view()});
   if(req.method==='GET'&&files[path]){const [file,type]=files[path];res.writeHead(200,{'Content-Type':type});return res.end(await readFile(new URL(file,root)));}
   if(req.method!=='POST')return json(404,{error:'NOT_FOUND'});
   const token=Buffer.from(req.headers['x-fulcrum-token']??'');
   if(req.headers.origin!==origin||token.length!==nonce.length||!timingSafeEqual(token,Buffer.from(nonce)))return json(403,{error:'REQUEST_TOKEN_REQUIRED'});
   if(req.headers['content-type']!=='application/json')return json(415,{error:'JSON_REQUIRED'});
   let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>4096)return json(413,{error:'BODY_TOO_LARGE'});body+=chunk;}
   const input=JSON.parse(body);
   if(path==='/api/prepare')return json(200,await session.prepare(input.wallet));
   if(path==='/api/submit')return json(200,await session.submit(input));
   if(path==='/api/reconcile')return json(200,await session.reconcile());
   return json(404,{error:'NOT_FOUND'});
  }catch(e){return json(400,{error:/^[A-Z][A-Z0-9_]+$/.test(e.code??e.message)?e.code??e.message:'REQUEST_FAILED'});}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const id=new Date().toISOString().replaceAll(':','-');
 const dir=new URL('evidence/execution/',root);await mkdir(dir,{recursive:true});
 const path=new URL('wallet-'+id+'.json',dir);
 const session=walletSession({persist:b=>writeFile(path,JSON.stringify(b,null,2))});
 createWalletServer({session}).listen(4318,'127.0.0.1',()=>console.log('Fulcrum wallet: http://127.0.0.1:4318 | receipt: '+fileURLToPath(path)));
}
