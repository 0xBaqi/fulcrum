import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const evidence=JSON.parse(readFileSync('preservation/git-import-normalization.json'));
const historical={
 'src/engine.mjs':'77fe0626712c3a2af20850d203aba13b9bc19b6e2ce1d8b799f70148f8a3de09',
 'test/execution-safety.test.mjs':'99eb38663fb77fbcb0fce23f3b2f818a9717cb1d0104cbddbb8b7e3f760a473c',
 'test/execution.test.mjs':'224757cd174c375d0ea951d83337e1d1696e9a1a64bc08743c93a6517aaaa0c1'
};
test('integrity normalization evidence covers exactly the three historical files',()=>{
 assert.deepEqual(evidence.files.map(f=>f.path).sort(),Object.keys(historical).sort());
 assert.equal(evidence.files.reduce((n,f)=>n+f.manifests.length,0),4);
});
for(const f of evidence.files)test('historical bytes authenticate LF import: '+f.path,()=>{
 const original=Buffer.from(f.originalBytesBase64,'base64');
 assert.equal(sha(original),historical[f.path]);
 assert.equal(f.originalSha256,historical[f.path]);
 const normalized=Buffer.from(original.toString('utf8').replace(/\r\n/g,'\n'),'utf8');
 assert.equal(sha(normalized),f.gitBlobSha256);
 assert.deepEqual(readFileSync(f.path),normalized);
 for(const name of f.manifests)assert.equal(JSON.parse(readFileSync('preservation/'+name))[f.path],sha(normalized));
 const mutated=Buffer.from(normalized);mutated[0]^=1;
 assert.notEqual(sha(mutated),f.gitBlobSha256);
});
