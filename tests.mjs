import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('required files',()=>['public/index.html','public/app.js','src/index.ts','migrations/0001_init.sql','migrations/0002_provider_state.sql','migrations/0003_free_sources.sql','V5_FREE_SOURCES_KO.md','wrangler.jsonc'].forEach(f=>assert.ok(fs.existsSync(f),f)));
test('no missing local static refs',()=>{const h=fs.readFileSync('public/index.html','utf8');for(const f of ['/style.css','/app.js'])assert.ok(h.includes(f))});
test('free sources configured',()=>{const s=fs.readFileSync('wrangler.jsonc','utf8');assert.match(s,/martj42\/international_results/);assert.match(s,/api\.worldbank\.org/);assert.doesNotMatch(s,/FOOTBALLDATA_API_KEY/)});
test('v5 routes present',()=>{const s=fs.readFileSync('src/index.ts','utf8');for(const x of ['/api/collect','/api/provider/test','/api/network','/api/export'])assert.ok(s.includes(x))});
