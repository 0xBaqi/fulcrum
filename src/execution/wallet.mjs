// Browser-only adapter boundary. No environment, RPC credentials, or private keys.
// Supply the wallet adapter selected by the user and web3 VersionedTransaction.
export async function connectWallet(adapter,VersionedTransaction){
 await adapter.connect();const publicKey=adapter.publicKey?.toBase58();
 if(!publicKey)throw Error('WALLET_CONNECTION_FAILED');
 return {publicKey,async signTransaction(unsignedBase64){
  if(adapter.publicKey?.toBase58()!==publicKey)throw Error('WALLET_CHANGED');
  const bytes=Uint8Array.from(atob(unsignedBase64),c=>c.charCodeAt(0));
  const signed=await adapter.signTransaction(VersionedTransaction.deserialize(bytes));
  if(adapter.publicKey?.toBase58()!==publicKey)throw Error('WALLET_CHANGED');
  return btoa(String.fromCharCode(...signed.serialize()));
 }};
}
