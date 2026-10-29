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
  if (filePath.endsWith('package.json') && !filePath.includes('node_modules')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let newContent = content.replace(/"dev":\s*"tsc\s*-w\s*&\s*node\s*dist\/index\.js"/g, '"dev": "tsx watch src/index.ts"');
    if (content !== newContent) {
      fs.writeFileSync(filePath, newContent);
      console.log('Fixed dev script in:', filePath);
    }
  }
});
