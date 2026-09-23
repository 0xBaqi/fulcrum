// Wallet Standard discovery; only the selected wallet may sign.
const registered=new Set();
const registration=Object.freeze({register(...wallets){wallets.forEach(w=>registered.add(w));return ()=>wallets.forEach(w=>registered.delete(w));}});
window.addEventListener('wallet-standard:register-wallet',event=>event.detail(registration));
window.dispatchEvent(new CustomEvent('wallet-standard:app-ready',{detail:registration}));
window.fulcrumStandardWallet=async name=>{
 const matches=[...registered].filter(w=>w.name.toLowerCase()===name.toLowerCase());
 if(matches.length!==1)throw Error(name+' Wallet not detected. Open this page in the browser where its extension is installed.');
 const wallet=matches[0],connect=wallet.features['standard:connect'],sign=wallet.features['solana:signTransaction'];
 if(!connect||!sign?.supportedTransactionVersions.includes(0))throw Error('Wallet must support signing Solana v0 transactions.');
 await connect.connect();const account=wallet.accounts.find(a=>a.chains.includes('solana:mainnet')&&a.features.includes('solana:signTransaction'));
 if(!account)throw Error('No Solana mainnet account connected.');
 const check=()=>{if(!wallet.accounts.some(a=>a.address===account.address))throw Error('Wallet account changed.');};
 return {connect:async()=>{},publicKey:{toBase58:()=>{check();return account.address;}},signTransaction:async tx=>{
  check();const results=await sign.signTransaction({account,chain:'solana:mainnet',transaction:tx.serialize()});check();
  if(results.length!==1)throw Error('Unexpected wallet signature response.');
  return solanaWeb3.VersionedTransaction.deserialize(results[0].signedTransaction);
 }};
};
