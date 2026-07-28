import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('required files',()=>['public/index.html','public/app.js','src/index.ts','migrations/0001_init.sql','migrations/0002_provider_state.sql','PROVIDER_SETUP_KO.md','wrangler.jsonc'].forEach(f=>assert.ok(fs.existsSync(f),f)));
test('no missing local static refs',()=>{const h=fs.readFileSync('public/index.html','utf8');for(const f of ['/style.css','/app.js'])assert.ok(h.includes(f))});
test('seed references existing teams',()=>{const s=fs.readFileSync('scripts/seed.sql','utf8');for(const c of ['COL','TUN','JOR'])assert.ok(s.includes(`'${c}'`))});

test('provider endpoints included',()=>{const s=fs.readFileSync('wrangler.jsonc','utf8');assert.match(s,/fifa-rankings\/current/);assert.match(s,/fixtures\/results/);assert.match(s,/FOOTBALLDATA_PERIODS_URL/)});
