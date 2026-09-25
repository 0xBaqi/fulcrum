import http from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {appService,ROOT} from './service.mjs';
import {walletSession} from './wallet-session.mjs';

export function createServer({
  service=appService(),
  wallet=walletSession()
}={}){
  const nonce=randomBytes(32).toString('hex');

  const server=http.createServer(async(req,res)=>{
    const origin=process.env.PUBLIC_ORIGIN ||
      'http://127.0.0.1:'+server.address().port;

    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    );

    const json=(status,data)=>{
      if(status>=400){
        res.setHeader('Connection','close');
        req.resume();
      }

      res.writeHead(status,{'Content-Type':'application/json'});
      res.end(JSON.stringify(data));
    };
try{
  if(
    req.headers.host!==new URL(origin).host ||
    (req.headers.origin&&req.headers.origin!==origin) ||
    (
      req.headers['sec-fetch-site']==='cross-site' &&
      req.method!=='GET'
    )
  ){
    return json(403,{error:{code:'ORIGIN_REJECTED'}});
  }

  const path=new URL(req.url,origin).pathname;

      if(req.method==='GET'&&path==='/api/bootstrap'){
        return json(200,{
          csrfToken:nonce,
          captures:await service.catalog(),
          assets:[{underlying:'TSLA',name:'Tesla'}],
          signingAvailable:true,
          broadcastAvailable:true
        });
      }

      if(req.method==='GET'&&path==='/api/wallet/session'){
        return json(200,{
          csrfToken:nonce,
          ...wallet.view()
        });
      }

      if(
        req.method==='GET' &&
        /^\/api\/jobs\/[a-f0-9-]+$/.test(path)
      ){
        return json(
          200,
          service.get(path.split('/').at(-1))
        );
      }

      if(req.method==='POST'){
        const provided=Buffer.from(
          req.headers['x-stocklana-token']??''
        );

        if(
          provided.length!==nonce.length ||
          !timingSafeEqual(
            provided,
            Buffer.from(nonce)
          )
        ){
          return json(
            403,
            {error:{code:'REQUEST_TOKEN_REQUIRED'}}
          );
        }

        if(req.headers['content-type']!=='application/json'){
          return json(
            415,
            {error:{code:'JSON_REQUIRED'}}
          );
        }

        let body='';
        let size=0;

        for await(const chunk of req){
          size+=chunk.length;

          if(size>4096){
            return json(
              413,
              {error:{code:'BODY_TOO_LARGE'}}
            );
          }

          body+=chunk;
        }

        let input;

        try{
          input=JSON.parse(body);
        }catch{
          return json(
            400,
            {error:{code:'INVALID_JSON'}}
          );
        }

        if(path==='/api/analyses'){
          return json(
            202,
            service.start(input)
          );
        }

        if(
          /^\/api\/jobs\/[a-f0-9-]+\/prepare$/.test(path)
        ){
          return json(
            202,
            service.prepare(
              path.split('/')[3],
              input
            )
          );
        }

        if(path==='/api/wallet/prepare'){
          return json(
            200,
            await wallet.prepare(input.wallet)
          );
        }

        if(path==='/api/wallet/submit'){
          return json(
            200,
            await wallet.submit(input)
          );
        }

        if(path==='/api/wallet/reconcile'){
          return json(
            200,
            await wallet.reconcile()
          );
        }

        return json(
          404,
          {error:{code:'ENDPOINT_NOT_FOUND'}}
        );
      }

      const files={
        '/':['index.html','text/html'],
        '/app.js':['app.js','text/javascript'],
        '/style.css':['style.css','text/css'],
        '/wallet-standard.js':['wallet-standard.js','text/javascript'],
        '/web3.js':[
          '../node_modules/@solana/web3.js/lib/index.iife.min.js',
          'text/javascript'
        ]
      };

      if(req.method==='GET'&&files[path]){
        const [file,type]=files[path];

        res.writeHead(
          200,
          {'Content-Type':type+'; charset=utf-8'}
        );

        return res.end(
          await readFile(
            join(ROOT,'web',file)
          )
        );
      }

      return json(
        404,
        {error:{code:'ENDPOINT_NOT_FOUND'}}
      );
    }catch(e){
      const raw=e.code??e.message;
      const code=/^[A-Z][A-Z0-9_]+$/.test(raw)
        ? raw
        : 'APPLICATION_ERROR';

      return json(
        code==='JOB_NOT_FOUND'?404:400,
        {error:{code}}
      );
    }
  });

  server.requestTimeout=15000;
  server.headersTimeout=10000;

  return server;
}

if(
  process.argv[1] &&
  import.meta.url===pathToFileURL(process.argv[1]).href
){
  const port=Number(process.env.PORT||4317);

  const id=new Date()
    .toISOString()
    .replaceAll(':','-');

  const dir=join(ROOT,'evidence','execution');

  await mkdir(dir,{recursive:true});

  const receiptPath=join(
    dir,
    'wallet-'+id+'.json'
  );

  const wallet=walletSession({
    persist:body=>
      writeFile(
        receiptPath,
        JSON.stringify(body,null,2)
      )
  });

  createServer({wallet}).listen(
    port,
    process.env.HOST || '127.0.0.1',
    ()=>{
      console.log(
        'Fulcrum: http://127.0.0.1:'+port+
        ' | execution receipt: '+receiptPath
      );
    }
  );
}
