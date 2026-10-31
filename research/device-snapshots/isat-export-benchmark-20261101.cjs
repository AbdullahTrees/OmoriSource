'use strict';
// Run after measurement, never during a timing window. Export module ranges rather
// than executable bootstraps or proprietary save contents into the handover evidence.
const fs=require('node:fs'),path=require('node:path');
const root=process.argv[2];
const maps=path.join(root,'module-maps');fs.mkdirSync(maps,{recursive:true});
let exported=0;
for(const dir of fs.readdirSync(root).filter(name=>name.startsWith('bootstrap-'))) {
  for(const file of fs.readdirSync(path.join(root,dir)).filter(name=>/^bootstrap-.*\.js$/.test(name))) {
    const source=fs.readFileSync(path.join(root,dir,file),'utf8').split('\n');
    const ranges=[];let current=null;
    source.forEach((line,index)=>{
      if(line.startsWith('// BEGIN '))current={label:line.slice(9),start:index+2};
      else if(line.startsWith('// END ')&&current){current.end=index;ranges.push(current);current=null;}
    });
    if(!ranges.length) throw Error('No bundled module ranges: '+file);
    fs.writeFileSync(path.join(maps,file+'.json'),JSON.stringify(ranges));exported++;
  }
}
if(!exported) throw Error('No bootstrap module maps found');
