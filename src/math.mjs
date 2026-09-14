// Exact rational arithmetic. Decimal rendering is informational; ranking never rounds.
const gcd = (a,b) => b ? gcd(b,a%b) : (a<0n?-a:a);
export function rational(n,d=1n) {
  n=BigInt(n); d=BigInt(d);
  if(d===0n) throw Error('ZERO_DENOMINATOR');
  if(d<0n){n=-n;d=-d;}
  const g=gcd(n,d); return {n:n/g,d:d/g};
}
export function decimal(value) {
  if(typeof value!=='string' || !/^-?\d{1,80}(\.\d{1,80})?$/.test(value)) throw Error('INVALID_DECIMAL');
  const [a,b='']=value.split('.'); return rational(BigInt(a+b),10n**BigInt(b.length));
}
export const mul=(a,b)=>rational(a.n*b.n,a.d*b.d);
export const div=(a,b)=>rational(a.n*b.d,a.d*b.n);
export const sub=(a,b)=>rational(a.n*b.d-b.n*a.d,a.d*b.d);
export const abs=a=>rational(a.n<0n?-a.n:a.n,a.d);
export const cmp=(a,b)=>a.n*b.d>b.n*a.d?1:a.n*b.d<b.n*a.d?-1:0;
export const json=a=>({numerator:String(a.n),denominator:String(a.d)});
export function display(a,places=12){
  const sign=a.n<0n?'-':''; const n=a.n<0n?-a.n:a.n;
  return sign+String(n/a.d)+'.'+String(n%a.d*10n**BigInt(places)/a.d).padStart(places,'0');
}
export function atomic(value){
  if(typeof value!=='string'|| !/^[1-9]\d{0,39}$/.test(value)) throw Error('INVALID_ATOMIC_AMOUNT');
  return BigInt(value);
}
export function usdcAmount(value){
  if(!/^\d{1,12}(\.\d{1,6})?$/.test(value)) throw Error('USDC_REQUIRES_POSITIVE_DECIMAL_MAX_6_PLACES');
  const [a,b='']=value.split('.'); const raw=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));
  atomic(String(raw)); return String(raw);
}
