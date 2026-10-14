import fs from 'fs';import {makePuzzle} from './connectionsGen.mjs';
export {makePuzzle};
if(process.argv[1].endsWith('genConnections.mjs')){const n=+(process.argv[2]||60);const out=[];for(let i=1;i<=n;i++)out.push(makePuzzle(i));
 fs.writeFileSync('src/data/connections.json',JSON.stringify(out));console.log(out.length,'connections puzzles')}
