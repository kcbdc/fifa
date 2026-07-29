import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('required files',()=>['public/index.html','public/app.js','src/index.ts','migrations/0001_init.sql','migrations/0002_provider_state.sql','migrations/0003_free_sources.sql','V6_BATCH_COLLECTION_KO.md','wrangler.jsonc'].forEach(f=>assert.ok(fs.existsSync(f),f)));
test('no missing local static refs',()=>{const h=fs.readFileSync('public/index.html','utf8');for(const f of ['/style.css','/app.js'])assert.ok(h.includes(f))});
test('free sources configured',()=>{const s=fs.readFileSync('wrangler.jsonc','utf8');assert.match(s,/martj42\/international_results/);assert.match(s,/Dato-Futbol\/fifa-ranking/);assert.match(s,/BATCH_STATEMENTS/);assert.doesNotMatch(s,/FOOTBALLDATA_API_KEY/)});
test('v7 batch routes and cursor',()=>{const s=fs.readFileSync('src/index.ts','utf8');for(const x of ['/api/collect','/api/progress','v6_cursor','DB.batch','one task per invocation'])assert.ok(s.includes(x),x)});
test('v7 UI progress',()=>{const h=fs.readFileSync('public/index.html','utf8'),a=fs.readFileSync('public/app.js','utf8');assert.match(h,/progressBar/);assert.match(h,/다음 배치 수집/);assert.match(a,/renderProgress/)});

test('v7 ERGM automation files and routes',()=>{
  const src=fs.readFileSync('src/index.ts','utf8');
  const workflow=fs.readFileSync('.github/workflows/analyze.yml','utf8');
  const r=fs.readFileSync('r-analysis/run_ergm.R','utf8');
  assert.match(src,/repository_dispatch|dispatches/);
  assert.match(src,/\/api\/model-input/);
  assert.match(src,/\/api\/model-results/);
  assert.match(workflow,/name: ERGM Analysis/);
  assert.match(workflow,/setup-r-dependencies@v2/);
  assert.match(r,/ergm\(/);
  assert.match(r,/mcmc\.diagnostics/);
  assert.match(r,/gof\(/);
});

test('v8 validation and robust R conversion',()=>{
  const ts=fs.readFileSync('src/index.ts','utf8'), r=fs.readFileSync('r-analysis/run_ergm.R','utf8'), js=fs.readFileSync('public/app.js','utf8');
  assert.match(ts,/api\/model-validation/);
  assert.match(ts,/validation_failed/);
  assert.match(r,/records_to_df/);
  assert.match(r,/data-validation\.json/);
  assert.match(js,/validateModel/);
});
