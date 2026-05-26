const fs = require('fs');
const path = require('path');
const html = fs.readFileSync('frontend/report.html', 'utf8');
const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g);
let allJS = scriptMatch.map(m => m.replace(/<\/?script[^>]*>/g, '')).join('\n');

const outPath = path.resolve('./tmp_report_check.js');
fs.writeFileSync(outPath, allJS);
console.log('Written to ' + outPath + ' (' + allJS.length + ' chars)');
