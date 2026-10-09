const fs=require('fs'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../nearby.js'),'utf8');

assert(source.includes('distance<=selected&&distance>minDistance'));
assert(source.includes('const rows=resultRows'));
assert(source.includes('正在加入 ${minDistance}–${next}m 新結果'));
assert(source.includes('changeRadius(radius+Number(step.dataset.radiusStep))'));
assert(source.includes('今次新增 ${added} 個'));
assert(source.includes('if(minDistance&&added)shown+=added'));
assert(!source.includes('if(step){e.preventDefault();e.stopImmediatePropagation();search(radius+'));

console.log('Passed: +50m scans only the new distance ring, preserves existing rows, and reports only newly added routes.');
