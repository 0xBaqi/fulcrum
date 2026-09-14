import {mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {hash} from '../engine.mjs';
// Only public audit evidence is stored. Filename is derived, never supplied by a wallet.
export function fileReceiptStore(directory='evidence/execution'){
 return async bundle=>{const r=bundle.receipt,id=hash([r.analysis.snapshotSha256,r.walletPublicKey,r.createdAt]);await mkdir(directory,{recursive:true});const path=join(directory,id+'.json');await writeFile(path+'.tmp',JSON.stringify(bundle,null,2));await rename(path+'.tmp',path);};
}
