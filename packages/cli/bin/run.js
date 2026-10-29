#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

const distPath = path.join(__dirname, '../dist/index.js');

if (!fs.existsSync(distPath)) {
  console.error('CLI is not built. Please run "npm run build" in the cli package.');
  process.exit(1);
}

require(distPath);
