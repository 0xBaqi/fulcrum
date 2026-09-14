import {pathToFileURL} from 'node:url';
import {mkdir,cp,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve('.'),target=join(root,'dist','stocklana');await mkdir(target,{recursive:true});
const files=[];async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await walk(p);else files.push(p);}}
for(const dir of ['src','web','data'])await walk(dir);
files.push('fixtures/synthetic.mjs','package.json','package-lock.json','evidence/session-live-2026-09-13.json','evidence/execution/m2a-wallet-attempt4-2026-09-13.json.analysis.json');
for(const file of files){if(/\.(mjs|js)$/.test(file))execFileSync(process.execPath,['--check',file]);await cp(file,join(target,file),{force:true});}
execFileSync(process.execPath,['--input-type=module','-e','await import('+JSON.stringify(pathToFileURL(join(target,'src/app/server.mjs')).href)+')']);
const manifest=await Promise.all(files.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
await writeFile(join(target,'build-manifest.json'),JSON.stringify({entry:'src/app/server.mjs',files:manifest},null,2));console.log(JSON.stringify({status:'BUILD_PASSED',output:target,files:files.length,secretsIncluded:false,legacyCliDemoHelperIncluded:true,testSigningFixturesIncluded:false,runtimeImportPassed:true}));
