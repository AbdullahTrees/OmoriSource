'use strict';
// Metadata only: never copy generated executable bootstraps into handover evidence.
const fs=require('node:fs'),path=require('node:path'),root=process.argv[2];
const state=path.join(root,'bootstrap'),out=path.join(root,'module-maps');
fs.mkdirSync(out,{recursive:true});let count=0;
for(const name of fs.readdirSync(state).filter(n=>/^bootstrap-[a-f0-9]+\.js$/.test(n))){
  const ranges=[];let span=null;
  fs.readFileSync(path.join(state,name),'utf8').split('\n').forEach((line,i)=>{
    if(line.startsWith('// BEGIN '))span={label:line.slice(9),start:i+2};
    else if(line.startsWith('// END ')&&span){span.end=i;ranges.push(span);span=null;}
  });
  if(!ranges.length)throw Error('Missing module ranges: '+name);
  fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(ranges));count++;
}
if(!count)throw Error('No generated bootstrap maps');
