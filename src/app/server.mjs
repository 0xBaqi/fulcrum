import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {appService,ROOT} from './service.mjs';
export function createServer({service=appService()}={}){
 const nonce=randomBytes(32).toString('hex');
 const server=http.createServer(async(req,res)=>{
  const origin='http://127.0.0.1:'+server.address().port;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const json=(status,data)=>{if(status>=400){res.setHeader('Connection','close');req.resume();}res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  try{
   if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site')return json(403,{error:{code:'ORIGIN_REJECTED'}});
   const path=new URL(req.url,origin).pathname;
   if(req.method==='GET'&&path==='/api/bootstrap')return json(200,{csrfToken:nonce,captures:await service.catalog(),assets:[{underlying:'TSLA',name:'Tesla'}],signingAvailable:false,broadcastAvailable:false});
   if(req.method==='GET'&&/^\/api\/jobs\/[a-f0-9-]+$/.test(path))return json(200,service.get(path.split('/').at(-1)));
   if(req.method==='POST'){
    const provided=Buffer.from(req.headers['x-stocklana-token']??'');if(provided.length!==nonce.length||!timingSafeEqual(provided,Buffer.from(nonce)))return json(403,{error:{code:'REQUEST_TOKEN_REQUIRED'}});
    if(req.headers['content-type']!=='application/json')return json(415,{error:{code:'JSON_REQUIRED'}});
    let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>4096)return json(413,{error:{code:'BODY_TOO_LARGE'}});body+=chunk;}let input;try{input=JSON.parse(body);}catch{return json(400,{error:{code:'INVALID_JSON'}});}
    if(path==='/api/analyses')return json(202,service.start(input));
    if(/^\/api\/jobs\/[a-f0-9-]+\/prepare$/.test(path))return json(202,service.prepare(path.split('/')[3],input));
    return json(404,{error:{code:'ENDPOINT_NOT_FOUND'}});
   }
   const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
   if(req.method==='GET'&&files[path]){const [file,type]=files[path];res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});return res.end(await readFile(join(ROOT,'web',file)));}
   return json(404,{error:{code:'ENDPOINT_NOT_FOUND'}});
  }catch(e){const code=/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'APPLICATION_ERROR';return json(code==='JOB_NOT_FOUND'?404:400,{error:{code}});}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const port=Number(process.env.PORT||4317);createServer().listen(port,'127.0.0.1',()=>console.log('Stocklana operator surface: http://127.0.0.1:'+port));}
