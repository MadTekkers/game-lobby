// Weekly job: add 7 new Connections puzzles (deterministic from bank) and any new Strands themes from the bank.
import fs from 'fs';import {execSync} from 'child_process';import {makePuzzle} from './genConnections.mjs';
const f='src/data/connections.json';const cur=JSON.parse(fs.readFileSync(f));
const start=cur.length?Math.max(...cur.map(p=>p.id))+1:1;
for(let i=0;i<7;i++)cur.push(makePuzzle(start+i));fs.writeFileSync(f,JSON.stringify(cur));
execSync('node scripts/genStrands.mjs 2',{stdio:'inherit'});
console.log('connections now',cur.length);
