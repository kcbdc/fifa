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
  assert.match(workflow,/name: ERGM and TERGM Analysis/);
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


test('v9 GitHub diagnostics and ERGM fallback',()=>{
 const ts=fs.readFileSync('src/index.ts','utf8');
 const js=fs.readFileSync('public/app.js','utf8');
 const html=fs.readFileSync('public/index.html','utf8');
 const r=fs.readFileSync('r-analysis/run_ergm.R','utf8');
 assert.match(ts,/api\/github\/diagnostics/);
 assert.match(ts,/githubDiagnostics/);
 assert.match(ts,/GITHUB_DISPATCH_MODE/);
 assert.match(js,/githubDiagBtn/);
 assert.match(html,/GitHub 연결 진단/);
 assert.match(r,/candidate_rhs/);
 assert.match(r,/fallback_used/);
});

test('v10 immediate dashboard health and fixed GitHub target',()=>{
  const app=fs.readFileSync('public/app.js','utf8');
  const worker=fs.readFileSync('src/index.ts','utf8');
  const wrangler=fs.readFileSync('wrangler.jsonc','utf8');
  assert.match(app,/async function loadHealth/);
  assert.match(app,/Promise\.allSettled/);
  assert.match(app,/autoSourceCheck\(\)/);
  assert.match(worker,/async function systemHealth/);
  assert.match(worker,/VERSION='14\.0\.0'/);
  assert.match(wrangler,/"GITHUB_OWNER": "kcbdc"/);
  assert.match(wrangler,/"GITHUB_REPO": "fifa"/);
  assert.doesNotMatch(wrangler,/REPLACE_WITH_GITHUB_OWNER|REPLACE_WITH_GITHUB_REPO/);
});


test('v11 FIFA 211 normalization',()=>{
 const ts=fs.readFileSync('src/index.ts','utf8');
 const master=fs.readFileSync('src/fifa-master.ts','utf8');
 const migration=fs.readFileSync('migrations/0005_fifa_211_normalization.sql','utf8');
 const html=fs.readFileSync('public/index.html','utf8');
 assert.match(ts,/api\/fifa-normalize/);
 assert.match(ts,/is_fifa_member=1/);
 assert.match(ts,/unmapped_team_names/);
 assert.match(master,/FIFA_MEMBERS/);
 assert.equal((master.match(/"code":/g)||[]).length,211);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS fifa_members/);
 assert.match(html,/FIFA 211 정규화/);
});


test('v12 advanced research analytics',()=>{const ts=fs.readFileSync('src/index.ts','utf8'),h=fs.readFileSync('public/index.html','utf8'),a=fs.readFileSync('public/app.js','utf8');for(const x of ['/api/analytics','/api/model-comparison','/api/reproducibility','/api/interpret'])assert.ok(ts.includes(x),x);assert.match(ts,/VERSION='14\.0\.0'/);assert.match(h,/고급 네트워크 분석/);assert.match(a,/loadAnalytics/);assert.match(a,/reproExport/)});


test('v13 research competitiveness features',()=>{const ts=fs.readFileSync('src/index.ts','utf8'),h=fs.readFileSync('public/index.html','utf8'),a=fs.readFileSync('public/app.js','utf8'),m=fs.readFileSync('migrations/0006_research_competitiveness.sql','utf8');for(const x of ['/api/temporal-network','/api/export/graphml','/api/export/gexf','/api/citation','/api/projects','/api/dataset-freeze','/api/reproducibility-report'])assert.ok(ts.includes(x),x);assert.match(ts,/VERSION='14\.0\.0'/);assert.match(h,/논문 경쟁력 센터/);assert.match(a,/temporalBtn/);assert.match(a,/freezeBtn/);assert.match(m,/CREATE TABLE IF NOT EXISTS research_projects/);assert.match(m,/CREATE TABLE IF NOT EXISTS dataset_snapshots/);});


test("v14 TERGM workflow integration", async () => {
  const workflow = fs.readFileSync(".github/workflows/analyze.yml", "utf8");
  const script = fs.readFileSync("r-analysis/run_tergm.R", "utf8");
  const worker = fs.readFileSync("src/index.ts", "utf8");
  assert.match(workflow, /any::tergm/);
  assert.match(workflow, /analysis_mode/);
  assert.match(script, /Persist\(~edges\)/);
  assert.match(script, /estimate = "CMLE"/);
  assert.match(worker, /api\/temporal-results/);
});
