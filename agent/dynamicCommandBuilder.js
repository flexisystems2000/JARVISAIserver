'use strict';
const fs=require('fs'); const path=require('path');
const NAME=/^[a-z][a-z0-9_]{1,47}$/;
const ALLOWED_OPERATIONS=new Set(['echo','template']);
class DynamicCommandBuilder {
  constructor({ directory, registry }) { this.directory=directory||path.join(process.cwd(),'data','commands'); this.registry=registry; }
  async load() { await fs.promises.mkdir(this.directory,{recursive:true,mode:0o700}); const files=(await fs.promises.readdir(this.directory)).filter(x=>x.endsWith('.json')); for(const f of files){try{const spec=JSON.parse(await fs.promises.readFile(path.join(this.directory,f),'utf8'));this.registerSpec(spec);}catch(e){console.error('[DYNAMIC COMMAND] Skipped invalid command:',f,e.message);}} }
  validate(spec) {
    if(!spec||!NAME.test(spec.name||'')||!spec.description||!spec.parameters||!spec.implementation) throw new Error('Command needs a valid name, description, parameter schema and implementation');
    if(this.registry?.tools?.has(spec.name)) throw new Error(`Command name ${spec.name} is already registered`);
    if(!ALLOWED_OPERATIONS.has(spec.implementation.operation)) throw new Error('Generated commands may use only the safe echo/template operations');
    if(spec.implementation.operation==='template'&&typeof spec.implementation.template!=='string') throw new Error('Template operation requires a template string');
    if(spec.implementation.operation==='template'&&spec.implementation.template.length>4000) throw new Error('Template is too long');
    if(spec.implementation.operation==='template') { const names=[...spec.implementation.template.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map(x=>x[1]); for(const name of names) if(!spec.parameters.properties?.[name]) throw new Error(`Template placeholder ${name} is not declared in parameters`); }
    return spec;
  }
  registerSpec(raw) { const s=this.validate(raw); this.registry.register({name:s.name,description:s.description,parameters:s.parameters,permissions:['admin'],dynamicCommand:true,handler:async args=>({text:s.implementation.operation==='echo'?String(args.text||''):s.implementation.template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g,(_,k)=>String(args[k]??''))})}); return {name:s.name, registered:true}; }
  async list() { await fs.promises.mkdir(this.directory,{recursive:true,mode:0o700}); const files=(await fs.promises.readdir(this.directory)).filter(x=>x.endsWith('.json')); return files.map(x=>x.slice(0,-5)); }
  async create(spec,{approved=false}={}) { if(!approved) throw new Error('Authorised administrator approval required to persist a generated command'); const s=this.validate(spec); const file=path.join(this.directory,`${s.name}.json`); await fs.promises.writeFile(file,JSON.stringify(s,null,2),{mode:0o600,flag:'wx'}); this.registerSpec(s); return {name:s.name,persisted:true,permissions:['admin']}; }
}
module.exports={DynamicCommandBuilder};
