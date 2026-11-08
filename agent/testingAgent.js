'use strict';
const { spawn }=require('child_process');
function checkJavaScript(source,{timeoutMs=10000}={}) {
 return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--check','-'],{stdio:['pipe','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Syntax check timed out'));},timeoutMs);child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',code=>{clearTimeout(timer);resolve({valid:code===0,exitCode:code,stdout:out,stderr:err})});child.stdin.end(String(source||''));});
}
module.exports={checkJavaScript};
