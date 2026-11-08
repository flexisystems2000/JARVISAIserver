'use strict';
const fs = require('fs');
const path = require('path');
function createAuditLogger({ directory } = {}) {
  const dir = directory || path.join(process.cwd(),'data','audit');
  return { async write(event) {
    await fs.promises.mkdir(dir,{recursive:true,mode:0o700});
    const safe = { timestamp: new Date().toISOString(), ...event };
    await fs.promises.appendFile(path.join(dir, `${new Date().toISOString().slice(0,10)}.jsonl`), JSON.stringify(safe)+'\n', {mode:0o600});
  }};
}
module.exports = { createAuditLogger };
