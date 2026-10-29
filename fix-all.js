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
  if (filePath.endsWith('tsconfig.json')) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('"../../tsconfig.base.json"')) {
      content = content.replace('"../../tsconfig.base.json"', '"../../../tsconfig.base.json"');
      fs.writeFileSync(filePath, content);
      console.log('Fixed tsconfig:', filePath);
    }
  }
  
  if (filePath.endsWith('.ts') && !filePath.includes('node_modules')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;
    if (content.includes('\\`')) {
      content = content.replace(/\\`/g, '`');
      changed = true;
    }
    if (content.includes('\\${')) {
      content = content.replace(/\\\${/g, '${');
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(filePath, content);
      console.log('Fixed backticks in:', filePath);
    }
  }
});
