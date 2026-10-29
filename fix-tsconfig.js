const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

walkDir('packages', function(filePath) {
  if (filePath.endsWith('tsconfig.json') && !filePath.includes('node_modules')) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Count depth based on number of path separators after 'packages'
    const depth = filePath.split(path.sep).length - 1; // packages/api/tsconfig.json -> 3 parts
    
    let expectedPath = "";
    if (depth === 2) { // e.g. packages/api/tsconfig.json
      expectedPath = '"../../tsconfig.base.json"';
    } else if (depth === 3) { // e.g. packages/workers/api-worker/tsconfig.json
      expectedPath = '"../../../tsconfig.base.json"';
    }
    
    if (expectedPath) {
      let newContent = content.replace(/"\.\.\/\.\.\/tsconfig\.base\.json"/g, expectedPath)
                              .replace(/"\.\.\/\.\.\/\.\.\/tsconfig\.base\.json"/g, expectedPath);
      if (content !== newContent) {
        fs.writeFileSync(filePath, newContent);
        console.log('Fixed tsconfig path correctly:', filePath, 'to', expectedPath);
      }
    }
  }
});
