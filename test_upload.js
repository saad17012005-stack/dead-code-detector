const fs = require('fs');
const FormData = require('form-data');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function run() {
  const form = new FormData();
  form.append('file', fs.createReadStream('demo/dummy_code.ts'));
  const r = await fetch('http://localhost:3001/v1/scans/upload', { method: 'POST', body: form });
  console.log(await r.json());
}
run();
