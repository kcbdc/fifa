import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('required files',()=>['public/index.html','public/app.js','src/index.ts','migrations/0001_init.sql','wrangler.jsonc'].forEach(f=>assert.ok(fs.existsSync(f),f)));
test('no missing local static refs',()=>{const h=fs.readFileSync('public/index.html','utf8');for(const f of ['/style.css','/app.js'])assert.ok(h.includes(f))});
test('seed references existing teams',()=>{const s=fs.readFileSync('scripts/seed.sql','utf8');for(const c of ['COL','TUN','JOR'])assert.ok(s.includes(`'${c}'`))});
