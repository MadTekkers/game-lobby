import fs from 'fs';import {bank as raw} from './connectionsBank.mjs';
const bank=raw.filter(b=>b[2].length>=4);
function rng(s){return()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff}}
export function makePuzzle(seed){const r=rng(seed*7919+13);const pick=a=>a[Math.floor(r()*a.length)];
 for(let t=0;t<500;t++){const groups=[];const used=new Set();let ok=true;
  for(let lvl=0;lvl<4;lvl++){const cats=bank.filter(b=>b[0]===lvl&&!groups.some(g=>g.category===b[1]));const c=pick(cats);
   const words=[...c[2]].sort(()=>r()-.5).filter(w=>!used.has(w)).slice(0,4);
   // reject if any chosen word also belongs to another chosen/selected category (ambiguity)
   if(words.length<4){ok=false;break}words.forEach(w=>used.add(w));groups.push({level:lvl,category:c[1],words})}
  if(!ok)continue;
  const all=groups.flatMap(g=>g.words);
  const amb=groups.some(g=>bank.some(b=>b[1]!==g.category&&groups.some(o=>o.category===b[1])&&g.words.some(w=>b[2].includes(w))));
  if(new Set(all).size===16&&!amb)return {id:seed,groups}}
 throw new Error('no puzzle '+seed)}
if(process.argv[1].endsWith('genConnections.mjs')){const n=+(process.argv[2]||60);const out=[];for(let i=1;i<=n;i++)out.push(makePuzzle(i));
 fs.writeFileSync('src/data/connections.json',JSON.stringify(out));console.log(out.length,'connections puzzles')}
