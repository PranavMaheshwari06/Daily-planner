const fs=require('fs');
const r=p=>fs.readFileSync(__dirname+'/'+p,'utf8');
let t=r('template.html');
const sub=(k,v)=>{t=t.replace('/*'+k+'*/',()=>v.replace(/<\/script/gi,'<\\/script'));};
sub('CSS',r('src/style.css'));sub('LOGIC',r('src/logic.js'));sub('UI',r('src/ui.js'));
fs.mkdirSync(__dirname+'/dist',{recursive:true});fs.writeFileSync(__dirname+'/dist/planner.html',t);
console.log('dist/planner.html',t.length,'bytes');
