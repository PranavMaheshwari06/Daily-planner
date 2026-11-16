const fs=require('fs');
const r=p=>fs.readFileSync(__dirname+'/'+p,'utf8');
let t=r('template.html');
const sub=(k,v)=>{t=t.replace('/*'+k+'*/',()=>v.replace(/<\/script/gi,'<\/script'));};
sub('CSS',r('src/style.css'));sub('CLOUD',r('src/cloud.js'));sub('LOGIC',r('src/logic.js'));sub('UI',r('src/ui.js'));
const out=__dirname+'/dist/';
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'planner.html',t);   // standalone copy
fs.writeFileSync(out+'index.html',t);     // the site (GitHub Pages)
fs.writeFileSync(out+'logic.js',r('src/logic.js'));   // loaded by the weekly Sheets export
console.log('dist/index.html',t.length,'bytes');
