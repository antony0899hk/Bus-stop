const fs=require('fs'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../watch-sync.js'),'utf8');

assert(html.includes('id="watchHelp"'));
assert(html.includes('id="watchHelpDialog"'));
assert(html.includes('Apple Watch 設定'));
assert(html.includes('將連結傳畀自己'));
assert(html.includes('唔係原生 App 或錶面功能'));
assert(js.includes('dialog?.showModal()'));
assert(js.includes('dialog?.close()'));

console.log('Passed: Watch help opens an in-page setup guide and clearly describes the web-based sync flow.');
