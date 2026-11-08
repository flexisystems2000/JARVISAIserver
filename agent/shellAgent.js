'use strict';
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const ALLOWED = new Set(['pwd','ls','find','grep','cat','head','tail','wc','node','npm','git','python3']);
function runSandboxed(command, { cwd = '/workspace', timeoutMs = 15000, image = 'node:20-alpine', maxOutput = 50000 } = {}) {
  if (typeof command !== 'string' || !command.trim() || command.length > 4000) return Promise.reject(new Error('Invalid shell command'));
  if (/[;&|`$<>\\n]/.test(command) || /\.\.\//.test(command)) return Promise.reject(new Error('Shell operators, expansions and parent-directory paths are blocked'));
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const executable = tokens.shift();
  if (!ALLOWED.has(executable)) return Promise.reject(new Error(`Command is not allowlisted: ${executable}`));
  const argv = tokens.map(value => value.replace(/^['"]|['"]$/g,''));
  const normalizedCwd = path.posix.normalize(cwd);
  if (!path.posix.isAbsolute(cwd) || (normalizedCwd !== '/workspace' && !normalizedCwd.startsWith('/workspace/'))) return Promise.reject(new Error('Working directory must be inside /workspace'));
  cwd = normalizedCwd;
  const id = crypto.randomBytes(8).toString('hex');
  return new Promise((resolve,reject) => {
    const args = ['run','--rm','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=64','--memory=256m','--cpus=1','--tmpfs','/tmp:rw,noexec,nosuid,size=32m','-v',`${process.env.JARVIS_SANDBOX_WORKSPACE || path.resolve(process.cwd(),'sandbox-workspace')}:/workspace:rw`,'-w',cwd,image,executable,...argv];
    const child=spawn(process.env.DOCKER_BIN || 'docker',args,{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',settled=false;
    const append=(target,chunk)=>chunk.toString().slice(0,Math.max(0,maxOutput-target.length));
    child.stdout.on('data',c=>{stdout+=append(stdout,c);});
    child.stderr.on('data',c=>{stderr+=append(stderr,c);});
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish({timedOut:true,exitCode:null});},Math.max(1000,Math.min(timeoutMs,60000)));
    function finish(extra={}) { if(settled)return; settled=true; clearTimeout(timer); resolve({id,stdout,stderr,...extra}); }
    child.on('error',err=>{if(settled)return;settled=true;clearTimeout(timer);reject(new Error(`Sandbox unavailable (Docker required): ${err.message}`));});
    child.on('close',(code,signal)=>finish({exitCode:code,signal,timedOut:false}));
  });
}
module.exports={runSandboxed};
