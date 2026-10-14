import fs from 'fs';import {makePuzzle} from './connectionsGen.mjs';import {mediumBank} from './connectionsMediumBank.mjs';
const out=[];for(let i=1;i<=40;i++)out.push(makePuzzle(1000+i,mediumBank));
fs.writeFileSync('src/data/connections-medium.json',JSON.stringify(out));console.log(out.length,'medium');
