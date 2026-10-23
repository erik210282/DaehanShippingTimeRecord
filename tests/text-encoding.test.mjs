import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {registerDowntime} from '../src/production/downtimeCodes.mjs';
const dir=fs.existsSync('src/production/liveTranslations.js')?'src/production/':'production/';
const source=fs.readFileSync(dir+'liveTranslations.js','utf8');
const bundles={};
const context={registerDowntime,i18n:{addResourceBundle(lang,namespace,values){bundles[lang]={...bundles[lang],...values};}}};
vm.runInNewContext(source.replace(/^import[^\n]*\n/gm,'').replace('export function registerLive','function registerLive')+'\nregisterLive(i18n);',context);
assert.equal(bundles.es.pl_title,'Seguimiento de producción');
assert.equal(bundles.ko.pl_title,'생산 모니터링');
assert.equal(bundles.ko.pl_finish_product,'제품 종료');
for(const lang of ['es','ko'])for(const [key,value] of Object.entries(bundles[lang])){
 assert.ok(!/[\ufffd]|Ã|Â|â€|ï¿½|\?\?/.test(value),lang+': '+key+' has damaged text');
}
console.log('PASS exact Spanish accents, Korean text and all monitoring translations');
