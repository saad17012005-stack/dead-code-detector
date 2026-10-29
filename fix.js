const fs = require('fs');
let code = fs.readFileSync('packages/workers/similarity-worker/src/index.ts', 'utf8');
code = code.replace(/\\`/g, '`');
code = code.replace(/\\\${/g, '${');
fs.writeFileSync('packages/workers/similarity-worker/src/index.ts', code);
console.log('Fixed syntax errors in similarity-worker');
