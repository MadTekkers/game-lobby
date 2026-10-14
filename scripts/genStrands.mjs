// Builds Strands boards (6 rows x 5 cols) by randomized backtracking tiling.
import fs from 'fs';
const R=6,C=5;
import {bank as specs} from './strandsBank.mjs';
const existing=fs.existsSync('src/data/strands.json')?JSON.parse(fs.readFileSync('src/data/strands.json')):[];
const limit=+(process.argv[2]||999);
function rng(s){return()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff}}
const nb=(r,c)=>{const o=[];for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){if(!dr&&!dc)continue;const a=r+dr,b=c+dc;if(a>=0&&a<R&&b>=0&&b<C)o.push([a,b])}return o};
function connectedOk(g){ // every empty region size must be fillable: no isolated region < 3
  const seen=new Set();for(let r=0;r<R;r++)for(let c=0;c<C;c++){if(g[r][c]||seen.has(r*C+c))continue;let n=0;const st=[[r,c]];seen.add(r*C+c);while(st.length){const[a,b]=st.pop();n++;for(const[x,y]of nb(a,b))if(!g[x][y]&&!seen.has(x*C+y)){seen.add(x*C+y);st.push([x,y])}}if(n<3)return false}return true}
function place(g,word,rand,paths,spans){
  const cells=[];for(let r=0;r<R;r++)for(let c=0;c<C;c++)if(!g[r][c])cells.push([r,c]);
  cells.sort(()=>rand()-.5);
  const path=[];
  function dfs(r,c,i){g[r][c]=word[i];path.push([r,c]);
    if(i===word.length-1){const ok=(!spans||spans(path))&&connectedOk(g);if(ok)return true}
    else{const n=nb(r,c).filter(([a,b])=>!g[a][b]).sort(()=>rand()-.5);for(const[a,b]of n)if(dfs(a,b,i+1))return true}
    g[r][c]=null;path.pop();return false}
  for(const[r,c]of cells){if(dfs(r,c,0)){paths.push(path.slice());return true}}
  return false}
const spans=p=>{const rs=p.map(x=>x[0]),cs=p.map(x=>x[1]);return(rs.includes(0)&&rs.includes(R-1))||(cs.includes(0)&&cs.includes(C-1))};
const out=[...existing];let added=0;
for(const s of specs){if(existing.some(e=>e.theme===s.theme))continue;if(added>=limit)break;added++;
  const total=s.spangram.length+s.words.join('').length; if(total!==30) throw new Error(s.theme+" "+total);
  let done=false;
  for(let seed=1;seed<20000&&!done;seed++){const rand=rng(seed);const g=Array.from({length:R},()=>Array(C).fill(null));const paths=[];
    if(!place(g,s.spangram,rand,paths,spans))continue;let ok=true;
    for(const w of s.words){if(!place(g,w,rand,paths)){ok=false;break}}
    if(ok){out.push({...s,grid:g.map(r=>r.join('')),paths:{[s.spangram]:paths[0],...Object.fromEntries(s.words.map((w,i)=>[w,paths[i+1]]))}});done=true}}
  if(!done)throw new Error("fail "+s.theme)}
fs.writeFileSync('src/data/strands.json',JSON.stringify(out,null,1));console.log(out.length,"boards");
