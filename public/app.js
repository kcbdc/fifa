const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
async function api(path,opt){const r=await fetch(path,opt);let d;try{d=await r.json()}catch{d={error:await r.text()}}if(!r.ok)throw new Error(d.error||'요청 실패');return d}
function show(view){$$('.view').forEach(x=>x.classList.toggle('active',x.id===view));window.scrollTo(0,0);if(view==='home')init();if(view==='model')autoGithubDiagnostic();else if(typeof stopGithubPoll==='function')stopGithubPoll();if(view==='analytics')loadAnalytics()}
$$('nav button').forEach(b=>b.onclick=()=>show(b.dataset.view));

// v34: 전수 점검 결과 12개 버튼이 클릭해도 즉시 아무 반응이 없어서(응답이 올 때까지
// 화면이 그대로라) "클릭이 씹혔나?" 오해를 유발하고 있었습니다. 모든 버튼이 공통으로
// 이 래퍼를 거치도록 정리했습니다.
//   1) 클릭 즉시 버튼을 비활성화하고 로딩 문구로 바꿉니다 → 반응이 없어 보이는 문제 원천 차단
//   2) 이미 처리 중이면 재클릭을 무시합니다 → 중복 요청(예: 모형을 여러 번 실행 요청해
//      GitHub Actions가 중복 실행되는 문제)을 원천 차단
//   3) 결과 표시 영역이 있으면 그 영역에도 즉시 "처리 중" 문구를 넣습니다
//   4) 에러가 나면 반드시 화면에 표시됩니다(콘솔에만 찍히고 조용히 사라지지 않음)
//   5) 성공/실패와 무관하게 버튼은 항상 원래 상태로 복구됩니다
function withBusy(btn,run,opts={}){
  const loadingText=opts.loadingText,targetEl=opts.targetEl,loadingHtml=opts.loadingHtml;
  return async(...args)=>{
    if(btn&&btn.disabled)return;
    const origText=btn?btn.textContent:null;
    if(btn){btn.disabled=true;if(loadingText)btn.textContent=loadingText}
    if(targetEl&&loadingHtml!==false)targetEl.innerHTML=loadingHtml||'처리 중...';
    try{
      await run(...args);
    }catch(err){
      const msg=err&&err.message?err.message:String(err);
      if(targetEl)targetEl.textContent=msg;else alert(msg);
    }finally{
      if(btn){btn.disabled=false;if(origText!==null)btn.textContent=origText}
    }
  };
}
function flashButton(btn,text,ms=1200){
  if(!btn)return;const orig=btn.textContent;btn.disabled=true;btn.textContent=text;
  setTimeout(()=>{btn.textContent=orig;btn.disabled=false},ms);
}

function card(k,v){return `<div class="metric"><span>${k}</span><b>${v??'-'}</b></div>`}
function setHealth(kind,text,detail=''){const el=$('#health');if(!el)return;const cls=kind==='good'?'good':kind==='warn'?'warn':'bad';el.innerHTML=`<span class="${cls}">● ${text}</span>${detail?`<small>${detail}</small>`:''}`}
async function loadHealth(){try{const h=await api('/api/health');setHealth('good','정상',`DB 연결 · v${h.version} · ${new Date(h.time).toLocaleString()}`);return h}catch(e){setHealth('bad','연결 오류',e.message);throw e}}
async function loadProvider(){const p=await api('/api/provider');if($('#providerStatus'))$('#providerStatus').innerHTML=`<div class="metric"><span>공급자</span><b>${p.provider}</b></div><p><b>랭킹 CSV</b><br><code>${p.rankingUrl}</code></p><p><b>경기 CSV</b><br><code>${p.matchUrl}</code></p><p class="good">API 키 불필요</p>`;renderProgress(p.progress);return p}
async function autoSourceCheck(){try{const d=await api('/api/provider/test');const ok=(d.results||[]).filter(x=>x.ok).length,total=(d.results||[]).length;if(d.ok)setHealth('good','정상',`DB 및 외부 데이터 소스 ${ok}/${total} 연결`);else setHealth('warn','부분 정상',`외부 데이터 소스 ${ok}/${total} 연결`);if($('#log')&&$('#log').textContent==='대기 중')$('#log').textContent=JSON.stringify(d,null,2)}catch(e){setHealth('warn','DB 정상',`외부 소스 진단 지연: ${e.message}`)}}
async function init(){
  await loadHealth().catch(()=>null);
  const results=await Promise.allSettled([api('/api/dashboard'),api('/api/quality'),api('/api/rankings'),loadProvider(),api('/api/network')]);
  const [dr,qr,rr,pr,nr]=results;
  if(dr.status==='fulfilled'){const d=dr.value;$('#cards').innerHTML=card('FIFA 회원국',d.teams)+card('원시 팀',d.rawTeams)+card('제외 팀',d.excludedTeams)+card('미매핑 이름',d.unmappedNames)+card('경기',d.matches)+card('랭킹 기록',d.rankings)+card('미해결 이슈',d.issues)+card('모형 실행',d.runs.length);renderProgress(d.progress);if(d.teams===211)setHealth('good','정상',`FIFA 211개 회원국 정규화 · DB 연결`)}
  else $('#cards').innerHTML=card('상태','데이터 요약 로딩 실패');
  if(qr.status==='fulfilled')renderQuality(qr.value);else $('#quality').textContent='품질정보를 불러오지 못했습니다.';
  if(rr.status==='fulfilled'){const rows=Array.isArray(rr.value)?rr.value:[];const snapshot=rows[0];$('#rankingList').innerHTML=(snapshot?`<small class="muted">발표일 ${snapshot.release_date} · ${snapshot.snapshot_coverage||rows.length}개국 기준</small>`:'')+rows.slice(0,8).map(x=>`<div><b>${x.rank}</b> ${x.name_ko||x.name_en||x.fifa_code} <span class="pill">${Number(x.points||0).toFixed(1)}</span></div>`).join('')||'데이터 없음'}
  else $('#rankingList').textContent='랭킹 정보를 불러오지 못했습니다.';
  if(nr.status==='fulfilled'){window.__lastHomeNetwork=nr.value;draw(nr.value,'networkCanvas')}else draw({nodes:[],links:[]},'networkCanvas');
  autoSourceCheck();
}
function renderQuality(q){
  const cls=q.score>=95?'good':q.score>=80?'warn':'bad';
  const dims=(q.dimensions||[]).map(x=>`<div class="quality-row"><div class="quality-head"><b>${x.label}</b><span>${Number(x.percent).toFixed(1)}% · ${x.score}/${x.weight}점</span></div><div class="quality-track"><i style="width:${Math.max(0,Math.min(100,x.percent))}%"></i></div><small>${x.detail}</small></div>`).join('');
  const c=q.counts||{};
  $('#quality').innerHTML=`<div class="quality-summary"><div class="quality-score ${cls}">${q.score}<small>/100</small></div><div><b>${q.grade||''}</b><span>FIFA 회원국 ${c.fifaMembers||0} · 유효 경기 ${(c.memberMatches||0).toLocaleString()} · 최신 랭킹 ${c.latestRankingTeams||0}개국</span></div></div><div class="quality-dimensions">${dims}</div><div class="quality-foot"><span>중복 후보 처리 ${(c.duplicateCandidatesHandled||0).toLocaleString()}건</span><span>비회원 경기 자동 제외 ${(c.excludedNonMemberMatches||0).toLocaleString()}건</span><span>무효 오류 ${(c.invalid||0).toLocaleString()}건</span></div><details><summary>산식과 해석</summary><p>${q.methodology||''}</p><ul>${(q.notes||[]).map(x=>`<li>${x}</li>`).join('')}</ul></details>`
}
$('#qualityBtn').onclick=withBusy($('#qualityBtn'),async()=>{
  const q=await api('/api/quality');renderQuality(q);$('#log').textContent=JSON.stringify(q,null,2);
},{loadingText:'검사 중...',targetEl:$('#quality'),loadingHtml:'<p>품질 검사를 실행하는 중입니다...</p>'});
$('#providerTestBtn').onclick=withBusy($('#providerTestBtn'),async()=>{
  const d=await api('/api/provider/test');$('#log').textContent=JSON.stringify(d,null,2);
  const ok=(d.results||[]).filter(x=>x.ok).length,total=(d.results||[]).length;
  setHealth(d.ok?'good':'warn',d.ok?'정상':'부분 정상',`외부 데이터 소스 ${ok}/${total} 연결`);
},{loadingText:'진단 중...',targetEl:$('#log'),loadingHtml:'API 연결 진단 중...'});
function renderProgress(p){if(!p)return;$('#progressBar').style.width=`${p.percent}%`;$('#progressText').textContent=`${p.completed} / ${p.total} (${p.percent}%)`;$('#nextTask').textContent=p.finished?'수집 완료':`다음 작업: ${p.next?.label||'-'} · 남은 배치 ${p.remaining}개`;}
$('#collectBtn').onclick=withBusy($('#collectBtn'),async()=>{
  const d=await api('/api/collect',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  $('#log').textContent=JSON.stringify(d,null,2);renderProgress(d.progress);await init();
},{loadingText:'수집 중...',targetEl:$('#log'),loadingHtml:'다음 배치 수집 중...'});
const doResetCollect=withBusy($('#resetCollectBtn'),async()=>{
  const d=await api('/api/collect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reset:true})});
  $('#log').textContent=JSON.stringify(d,null,2);renderProgress(d.progress);
},{loadingText:'재설정 중...',targetEl:$('#log'),loadingHtml:'진행 커서를 초기화하는 중...'});
$('#resetCollectBtn').onclick=()=>{if(confirm('진행 커서를 처음으로 되돌릴까요? 이미 저장된 데이터는 삭제되지 않습니다.'))doResetCollect()};

function triggerBlobDownload(blob,name){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function download(name,obj){triggerBlobDownload(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),name)}
async function downloadUrl(url,name){
  try{
    const res=await fetch(url);
    if(!res.ok){
      let msg=`다운로드 실패(HTTP ${res.status})`;
      try{const t=await res.clone().json();if(t.error)msg=t.error}catch{}
      throw new Error(msg)
    }
    triggerBlobDownload(await res.blob(),name)
  }catch(e){alert(`파일을 받아오지 못했습니다: ${e.message}`)}
}
$('#exportBtn').onclick=$('#paperExport').onclick=withBusy($('#exportBtn'),async()=>download('fifa-network-research-data.json',await api('/api/export')),{loadingText:'내보내는 중...'});
$('#reproExport').onclick=withBusy($('#reproExport'),async()=>download('fifa-network-reproducibility-v13.json',await api('/api/reproducibility')),{loadingText:'내보내는 중...'});
$('#interpretLatest').onclick=async()=>{
  const btn=$('#interpretLatest');if(btn.disabled)return;
  const orig=btn.textContent;btn.disabled=true;btn.textContent='AI 분석 중...';
  $('#paperInsight').innerHTML='<span class="warn">Cloudflare Workers AI로 최신 모형을 해설하는 중입니다... (몇 초 정도 걸릴 수 있습니다)</span>';
  try{
    const d=await api('/api/interpret');
    const badge=d.aiGenerated?`<span class="good">● AI 생성(${d.aiModel||'Workers AI'})</span>`:`<span class="warn">● 기본 요약(AI 미사용)</span>`;
    const errNote=d.aiError?`<p style="color:#e0a23a;font-size:12px;word-break:break-word">${d.aiError}</p>`:'';
    const runNote=d.runId?`<div style="margin-bottom:4px;color:#91a7be;font-size:12px">완료된 실행번호 #${d.runId} 기준</div>`:'';
    const notes=(d.coefficientNotes||[]).map((x)=>`<li>${x}</li>`).join('');
    $('#paperInsight').innerHTML=`${runNote}<div style="margin-bottom:4px">${badge}</div>${errNote}<b>${d.headline||''}</b><p>${d.summary||''}</p>${notes?`<h4>계수 해석</h4><ul>${notes}</ul>`:''}<h4>주의사항</h4><ul>${(d.cautions||[]).map(x=>`<li>${x}</li>`).join('')}</ul>`;
  }catch(e){$('#paperInsight').textContent=e.message}
  finally{btn.disabled=false;btn.textContent=orig}
};
const doGofView=withBusy($('#gofViewBtn'),async()=>{
  const id=$('#gofRunId').value;
  const d=await api(`/api/gof-report?id=${id}`);
  if(!d.ok){$('#gofReportBox').textContent=d.error||'리포트를 생성할 수 없습니다.';return}
  if(d.note){$('#gofReportBox').textContent=d.note;return}
  const coefRows=(d.coefficients||[]).map(c=>`<tr><td>${c.term}</td><td>${Number(c.estimate).toFixed(4)}</td><td>${Number(c.std_error).toFixed(4)}</td><td>${Number(c.p_value).toFixed(4)}</td><td>${Number(c.odds_ratio).toFixed(3)}</td></tr>`).join('');
  const effectRows=(d.effectSizes||[]).filter(x=>x.deltaPercentagePoints!==undefined).map(x=>`<tr><td>${x.term}</td><td>${x.baselineProbability}%</td><td>${x.newProbability}%</td><td style="color:${x.deltaPercentagePoints>=0?'#5fd58e':'#e0715f'}">${x.deltaPercentagePoints>=0?'+':''}${x.deltaPercentagePoints}%p</td></tr>`).join('');
  $('#gofReportBox').innerHTML=`
    <div style="margin-bottom:8px"><b>${d.modelName||''}</b> · ${d.networkType==='win'?'승리 네트워크':'경기 네트워크'} · 실행번호 #${d.runId}</div>
    <div style="margin-bottom:8px">공식: <code>${d.formula||'-'}</code>${d.fallbackUsed?' <span class="warn">(자동 단순화됨)</span>':''}</div>
    <div style="margin-bottom:8px">AIC ${d.aic??'-'} · BIC ${d.bic??'-'} · 수렴 ${d.converged?'예':'확인 필요'} · MCMC 사용 ${d.mcmcUsed?'예':'아니오(MPLE)'} · GOF ${d.gofAvailable?'가능':'생략됨'}</div>
    <div class="table-wrap"><table><thead><tr><th>항</th><th>Estimate</th><th>SE</th><th>p-value</th><th>Odds Ratio</th></tr></thead><tbody>${coefRows||'<tr><td colspan="5">계수 없음</td></tr>'}</tbody></table></div>
    ${effectRows?`<h4 style="margin-top:12px">실질적 효과 크기(확률 환산, 근사치)</h4><div class="table-wrap"><table><thead><tr><th>항</th><th>기준 확률</th><th>1단위 증가 시</th><th>변화</th></tr></thead><tbody>${effectRows}</tbody></table></div>`:''}
    <h4 style="margin-top:12px">GOF 원본 출력</h4><pre>${(d.gofText||[]).join('\n')||'(GOF 출력 없음)'}</pre>
    ${d.mcmcDiagnosticsNote?`<h4>MCMC 진단 참고</h4><p style="color:#91a7be">${d.mcmcDiagnosticsNote}</p>`:''}
  `;
},{loadingText:'조회 중...',targetEl:$('#gofReportBox'),loadingHtml:'불러오는 중...'});
$('#gofViewBtn').onclick=()=>{if(!$('#gofRunId').value)return alert('실행번호를 입력하세요');doGofView()};
const doGofExport=withBusy($('#gofExportBtn'),async()=>{
  const id=$('#gofRunId').value;
  await downloadUrl(`/api/gof-report/export?id=${id}`,`gof-report-run-${id}.md`);
},{loadingText:'내보내는 중...'});
$('#gofExportBtn').onclick=()=>{if(!$('#gofRunId').value)return alert('실행번호를 입력하세요');doGofExport()};

function uploadWithProgress(path,payload,onProgress){
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open('POST',path);
    xhr.setRequestHeader('content-type','application/json');
    xhr.upload.onprogress=(ev)=>{if(ev.lengthComputable)onProgress(Math.round(ev.loaded/ev.total*100))};
    xhr.upload.onload=()=>onProgress(100);
    xhr.onload=()=>{
      let d;try{d=JSON.parse(xhr.responseText)}catch{d={error:xhr.responseText}}
      if(xhr.status>=200&&xhr.status<300)resolve(d);else reject(new Error(d.error||`요청 실패(HTTP ${xhr.status})`))
    };
    xhr.onerror=()=>reject(new Error('네트워크 오류로 업로드에 실패했습니다'));
    xhr.send(JSON.stringify(payload));
  });
}
function setImportProgress(pct,label){
  const wrap=$('#importProgressWrap');if(!wrap)return;
  wrap.style.display='block';
  $('#importProgressBar').style.width=`${pct}%`;
  $('#importProgressText').textContent=label||`${pct}%`;
}
$('#importBtn').onclick=async()=>{
  const btn=$('#importBtn');if(btn.disabled)return;
  const f=$('#fileInput').files[0];if(!f)return alert('파일을 선택하세요');
  const orig=btn.textContent;btn.disabled=true;btn.textContent='가져오는 중...';$('#log').textContent='업로드 처리 중...';
  setImportProgress(0,'파일 읽는 중...');
  try{
    let rows;
    if(f.name.endsWith('.json')){rows=JSON.parse(await f.text())}
    else{
      const text=(await f.text()).trim();
      const lines=[];let row=[],cell='',q=false;
      for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];
        if(q){if(c==='"'&&n==='"'){cell+='"';i++}else if(c==='"')q=false;else cell+=c}
        else if(c==='"')q=true;
        else if(c===','){row.push(cell);cell=''}
        else if(c==='\n'){row.push(cell.replace(/\r$/,''));lines.push(row);row=[];cell=''}
        else cell+=c}
      if(cell||row.length){row.push(cell);lines.push(row)}
      const head=lines.shift().map(x=>x.trim());
      rows=lines.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(head.map((k,i)=>[k,(r[i]??'').trim()])))
    }
    setImportProgress(0,'업로드 중... 0%');
    const d=await uploadWithProgress('/api/import',{kind:$('#importKind').value,rows},(pct)=>{
      setImportProgress(pct,pct<100?`업로드 중... ${pct}%`:'서버 처리 중...')
    });
    setImportProgress(100,`완료 · 저장 ${d.inserted??0} · 건너뜀 ${d.skipped??0}`);
    $('#log').textContent=JSON.stringify(d,null,2);
    await init();
  }catch(e){$('#log').textContent=`업로드 실패: ${e.message}`;setImportProgress(0,'실패')}
  finally{btn.disabled=false;btn.textContent=orig;setTimeout(()=>{const w=$('#importProgressWrap');if(w)w.style.display='none'},4000)}
};
$('#normalizeBtn').onclick=withBusy($('#normalizeBtn'),async()=>{
  $('#log').textContent='FIFA 211 정규화 실행 중...';
  const d=await api('/api/fifa-normalize',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  $('#log').textContent=JSON.stringify(d,null,2);await init();
},{loadingText:'정규화 중...'});

function formula(){const terms=$$('.term:checked').map(x=>x.value);const f=`network ~ ${terms.join(' + ')||'edges'}`;$('#formula').textContent=f;return f}$$('.term').forEach(x=>x.onchange=formula);formula();

function renderGithubDiag(d){const checks=(d.checks||[]).map(x=>`<li><b>${x.name}</b> · HTTP ${x.status??'-'} · <span class="${x.ok?'good':'bad'}">${x.ok?'정상':'실패'}</span>${x.message?` · ${x.message}`:''}</li>`).join('');$('#githubDiagResult').innerHTML=`<b class="${d.ok?'good':'bad'}">${d.ok?'GitHub 연결 정상':'GitHub 연결 점검 필요'}</b><p>대상 저장소: <code>${d.owner||'-'}/${d.repo||'-'}</code> · 워크플로: <code>${d.workflow||'-'}</code> · 방식: <code>${d.dispatchMode||'-'}</code></p><ul>${checks}</ul><small>${d.recommendation||''}</small>`}
$('#githubDiagBtn').onclick=withBusy($('#githubDiagBtn'),async()=>{
  const d=await api('/api/github/diagnostics');renderGithubDiag(d);$('#modelDetail').textContent=JSON.stringify(d,null,2);
},{loadingText:'진단 중...',targetEl:$('#githubDiagResult'),loadingHtml:'GitHub 저장소·워크플로·토큰 접근권한을 확인 중입니다...'});
function renderValidation(v){if(!v)return;const counts=v.counts||{};const errors=(v.errors||[]).map(x=>`<li>${x}</li>`).join('');const warnings=(v.warnings||[]).map(x=>`<li>${x}</li>`).join('');$('#validationResult').innerHTML=`<b class="${v.ok?'good':'bad'}">${v.ok?'분석 가능':'분석 불가'}</b><p>국가 ${counts.teams||0} · 경기 ${counts.matches||0} · 사용 가능 엣지 ${counts.usableEdges||0} · 랭킹 ${counts.rankings||0}</p>${errors?`<h4>오류</h4><ul>${errors}</ul>`:''}${warnings?`<h4>주의</h4><ul>${warnings}</ul>`:''}<small>${v.recommendation||''}</small>`}
$('#validateModel').onclick=withBusy($('#validateModel'),async()=>{
  const v=await api(`/api/model-validation?type=${$('#modelNetwork').value}`);renderValidation(v);$('#modelDetail').textContent=JSON.stringify(v,null,2);
},{loadingText:'검증 중...',targetEl:$('#validationResult'),loadingHtml:'실행 전 검증을 수행하는 중입니다...'});
const STEP_ICON={completed_success:'✅',completed_failure:'❌',completed_cancelled:'⏹️',in_progress:'🔄',queued:'⏳',pending:'⏳'};
function stepIcon(s){if(s.status==='completed')return s.conclusion==='success'?STEP_ICON.completed_success:s.conclusion==='cancelled'?STEP_ICON.completed_cancelled:STEP_ICON.completed_failure;if(s.status==='in_progress')return STEP_ICON.in_progress;return STEP_ICON.pending}
function renderGithubStepProgress(d){
  const box=$('#githubStepProgress');if(!box)return;
  if(!d||!d.ok){box.style.display='block';box.innerHTML=`<b>GitHub 진행 상황</b><p class="warn">${d?.error||'조회할 수 없습니다.'}</p>`;return}
  if(!d.steps||!d.steps.length){
    // v35: 아직 GitHub Actions 큐에서 실행이 뽑히지 않아 실제 진행률 데이터가 없는
    // 상태입니다. 그냥 문구만 보여주면 "멈춘 건가?" 오해가 생기므로, 불확정(shimmer)
    // 진행바와 경과시간 카운터를 함께 보여줘서 "기다리는 중"임을 눈으로 알 수 있게 합니다.
    box.style.display='block';
    box.innerHTML=`<b>GitHub 진행 상황</b><p>${d.note||'대기 중입니다...'}</p><div class="indeterminate-track"><div class="indeterminate-bar"></div></div><p class="wait-elapsed" id="githubWaitElapsed">GitHub Actions 큐에서 실행이 시작되길 기다리는 중입니다... (0초 경과)</p>`;
    startWaitElapsedCounter();
    return;
  }
  stopWaitElapsedCounter();
  box.style.display='block';
  // v29: analyze.yml이 여러 job(report-run/static-ergm/temporal-tergm/manifest)으로
  // 나뉘어 정적·시간적 모형이 병렬 실행되므로, job별로 묶어서 표시합니다.
  const byJob=new Map();
  for(const s of d.steps){const key=s.jobLabel||s.job||'';if(!byJob.has(key))byJob.set(key,[]);byJob.get(key).push(s)}
  const groups=[...byJob.entries()].map(([job,steps])=>`<div style="margin-top:8px"><b style="font-size:12px;color:#8fc9ff">${job}</b><ul class="step-list">${steps.map(s=>`<li>${stepIcon(s)} ${s.label}</li>`).join('')}</ul></div>`).join('');
  box.innerHTML=`<b>GitHub 진행 상황</b>${d.runUrl?` · <a href="${d.runUrl}" target="_blank" rel="noopener">Actions에서 보기</a>`:''}${groups}`;
}
let githubWaitStart=null,githubWaitTimer=null;
function startWaitElapsedCounter(){
  if(githubWaitTimer)return; // 이미 카운트 중이면 다시 시작하지 않음(초가 튀지 않도록)
  githubWaitStart=Date.now();
  const tick=()=>{
    const el=$('#githubWaitElapsed');if(!el){stopWaitElapsedCounter();return}
    const sec=Math.floor((Date.now()-githubWaitStart)/1000);
    el.textContent=`GitHub Actions 큐에서 실행이 시작되길 기다리는 중입니다... (${sec}초 경과)${sec>60?' — 러너가 몰리면 1분 이상 걸릴 수 있습니다.':''}`;
  };
  tick();
  githubWaitTimer=setInterval(tick,1000);
}
function stopWaitElapsedCounter(){if(githubWaitTimer){clearInterval(githubWaitTimer);githubWaitTimer=null;githubWaitStart=null}}
let githubPollTimer=null;
function stopGithubPoll(){if(githubPollTimer){clearInterval(githubPollTimer);githubPollTimer=null}stopWaitElapsedCounter()}
function startGithubPoll(runId){
  stopGithubPoll();
  // v35: 첫 폴링 응답(네트워크 왕복 필요)을 기다리지 않고, 폴링을 시작하는 즉시
  // 대기 UI(불확정 진행바)를 먼저 보여줍니다 — 이 사이의 공백이 "멈춘 것 같다"는
  // 오해의 마지막 틈이었습니다.
  renderGithubStepProgress({ok:true,steps:[],note:'GitHub 실행 등록을 확인하는 중입니다...'});
  const tick=async()=>{
    try{
      const d=await api(`/api/github/run-progress?id=${runId}`);
      renderGithubStepProgress(d);
      const jobDone=d.jobStatus==='completed';
      const modelDone=d.phase==='completed'||d.phase==='failed';
      if(jobDone&&modelDone)stopGithubPoll();
    }catch(e){/* 일시적 오류는 조용히 무시하고 다음 폴링에서 재시도 */}
  };
  tick();
  githubPollTimer=setInterval(tick,8000);
}
// v34: "모형 실행" 클릭 후 오른쪽 "분석 상태" 패널이 서버 응답이 올 때까지(POST 요청 +
// GitHub Actions 디스패치 호출까지 포함해 1~2초 이상 걸릴 수 있음) 아무 변화가 없어서
// "클릭이 됐나?" 오해를 유발하고 있었습니다. 이제 클릭 즉시 버튼이 비활성화되고, 오른쪽
// 패널에도 바로 "요청하는 중입니다" 문구가 표시됩니다.
$('#runModel').onclick=withBusy($('#runModel'),async()=>{
  const d=await api('/api/models',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('#modelName').value,networkType:$('#modelNetwork').value,formula:formula(),analysisMode:$('#analysisMode').value})});
  $('#runLookup').value=d.runId;
  $('#modelResult').innerHTML=`실행번호 <b>#${d.runId}</b> · ${d.status}<br>${d.note}`;
  renderValidation(d.validation);$('#modelDetail').textContent=JSON.stringify(d,null,2);
  if(d.runId)startGithubPoll(d.runId);
  init();
},{loadingText:'요청 중...',targetEl:$('#modelResult'),loadingHtml:'<span class="warn">모형 실행을 요청하는 중입니다... (GitHub Actions 디스패치 포함, 몇 초 걸릴 수 있습니다)</span>'});
const doCheckModel=withBusy($('#checkModel'),async()=>{
  const id=$('#runLookup').value;
  const d=await api(`/api/models?id=${id}`);
  $('#modelResult').innerHTML=`실행번호 <b>#${d.id}</b> · ${d.status}`;$('#modelDetail').textContent=JSON.stringify(d,null,2);
  if(d.status==='completed'||d.status==='failed'){stopGithubPoll();const p=await api(`/api/github/run-progress?id=${id}`);renderGithubStepProgress(p)}
  else{startGithubPoll(id)}
},{loadingText:'조회 중...',targetEl:$('#modelResult'),loadingHtml:'상태를 조회하는 중입니다...'});
$('#checkModel').onclick=()=>{if(!$('#runLookup').value)return alert('실행번호를 입력하세요');doCheckModel()};

let githubDiagLoaded=false;
async function autoGithubDiagnostic(){if(githubDiagLoaded)return;githubDiagLoaded=true;try{$('#githubDiagResult').textContent='GitHub 연결을 자동 확인 중입니다...';const d=await api('/api/github/diagnostics');renderGithubDiag(d);$('#modelDetail').textContent=JSON.stringify(d,null,2)}catch(e){githubDiagLoaded=false;$('#githubDiagResult').innerHTML=`<b class="bad">자동 진단 실패</b><p>${e.message}</p>`}}

function graphColor(group){return ({AFC:'#54c6ff',CAF:'#ffbd59',CONCACAF:'#ff7f8f',CONMEBOL:'#71e6a8',OFC:'#bf8cff',UEFA:'#7aa7ff'}[group]||'#9fb5cc')}
function draw(data,canvasId){
  const canvas=document.getElementById(canvasId);if(!canvas)return;
  const ctx=canvas.getContext('2d'),cssW=Math.max(320,canvas.clientWidth||canvas.width||900),cssH=Math.max(300,Number(canvas.getAttribute('height'))||440),dpr=Math.min(2,window.devicePixelRatio||1);
  canvas.width=Math.round(cssW*dpr);canvas.height=Math.round(cssH*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssW,cssH);ctx.fillStyle='#091727';ctx.fillRect(0,0,cssW,cssH);
  const nodes=Array.isArray(data?.nodes)?data.nodes:[],links=Array.isArray(data?.links)?data.links:[];
  if(!nodes.length){ctx.fillStyle='#91a7be';ctx.font='16px sans-serif';ctx.textAlign='center';ctx.fillText('표시할 네트워크 데이터가 없습니다.',cssW/2,cssH/2);return}
  const degree=new Map(nodes.map(n=>[n.id,0]));for(const l of links){degree.set(l.source,(degree.get(l.source)||0)+Number(l.value||1));degree.set(l.target,(degree.get(l.target)||0)+Number(l.value||1))}
  const groups=[...new Set(nodes.map(n=>n.group||'UNK'))].sort(),byGroup=new Map(groups.map(g=>[g,nodes.filter(n=>(n.group||'UNK')===g)]));
  const pos=new Map(),cx=cssW/2,cy=cssH/2,R=Math.max(90,Math.min(cssW,cssH)*.39);
  groups.forEach((g,gi)=>{const arr=byGroup.get(g)||[],base=2*Math.PI*gi/groups.length-Math.PI/2,spread=Math.min(1.15,Math.PI*2/groups.length*.8);arr.forEach((n,i)=>{const off=arr.length===1?0:(i/(arr.length-1)-.5)*spread,rank=(i%3),r=R-rank*22;pos.set(n.id,{x:cx+Math.cos(base+off)*r,y:cy+Math.sin(base+off)*r})})});
  ctx.globalAlpha=.16;ctx.lineWidth=.7;ctx.strokeStyle='#74a9d8';for(const l of links){const a=pos.get(l.source),b=pos.get(l.target);if(!a||!b)continue;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}ctx.globalAlpha=1;
  const top=new Set([...nodes].sort((a,b)=>(degree.get(b.id)||0)-(degree.get(a.id)||0)).slice(0,12).map(n=>n.id));
  for(const n of nodes){const p=pos.get(n.id),d=degree.get(n.id)||0,r=n.isolate?2.2:Math.min(7,2.7+Math.sqrt(d)*.18);ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle=n.isolate?'#53677d':graphColor(n.group);ctx.fill();if(top.has(n.id)){ctx.font='10px sans-serif';ctx.fillStyle='#eaf2ff';ctx.textAlign='left';ctx.fillText(n.id,p.x+r+2,p.y+3)}}
  ctx.fillStyle='#91a7be';ctx.font='12px sans-serif';ctx.textAlign='left';ctx.fillText(`노드 ${nodes.length} · 엣지 ${links.length} · 고립 노드 ${data?.meta?.isolateCount??nodes.filter(n=>n.isolate).length}`,12,20);
}
function exportCanvasPNG(canvasId,filename){
  const canvas=document.getElementById(canvasId);if(!canvas)return alert('그래프를 먼저 생성하세요');
  const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download=filename;a.click();
}
function buildNetworkSVG(data,width=1200,height=700){
  const nodes=Array.isArray(data?.nodes)?data.nodes:[],links=Array.isArray(data?.links)?data.links:[];
  if(!nodes.length)return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#091727"/><text x="50%" y="50%" fill="#91a7be" font-size="16" text-anchor="middle">표시할 네트워크 데이터가 없습니다.</text></svg>`;
  const degree=new Map(nodes.map(n=>[n.id,0]));for(const l of links){degree.set(l.source,(degree.get(l.source)||0)+Number(l.value||1));degree.set(l.target,(degree.get(l.target)||0)+Number(l.value||1))}
  const groups=[...new Set(nodes.map(n=>n.group||'UNK'))].sort(),byGroup=new Map(groups.map(g=>[g,nodes.filter(n=>(n.group||'UNK')===g)]));
  const pos=new Map(),cx=width/2,cy=height/2,R=Math.max(90,Math.min(width,height)*.39);
  groups.forEach((g,gi)=>{const arr=byGroup.get(g)||[],base=2*Math.PI*gi/groups.length-Math.PI/2,spread=Math.min(1.15,Math.PI*2/groups.length*.8);arr.forEach((n,i)=>{const off=arr.length===1?0:(i/(arr.length-1)-.5)*spread,rank=(i%3),r=R-rank*22;pos.set(n.id,{x:cx+Math.cos(base+off)*r,y:cy+Math.sin(base+off)*r})})});
  const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let edgesSvg='';
  for(const l of links){const a=pos.get(l.source),b=pos.get(l.target);if(!a||!b)continue;edgesSvg+=`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#74a9d8" stroke-opacity="0.22" stroke-width="0.7"/>`}
  const top=new Set([...nodes].sort((a,b)=>(degree.get(b.id)||0)-(degree.get(a.id)||0)).slice(0,12).map(n=>n.id));
  let nodesSvg='';
  for(const n of nodes){const p=pos.get(n.id);if(!p)continue;const d=degree.get(n.id)||0,r=n.isolate?2.2:Math.min(7,2.7+Math.sqrt(d)*.18),color=n.isolate?'#53677d':graphColor(n.group);
    nodesSvg+=`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}"/>`;
    if(top.has(n.id))nodesSvg+=`<text x="${(p.x+r+2).toFixed(1)}" y="${(p.y+3).toFixed(1)}" font-size="10" font-family="sans-serif" fill="#eaf2ff">${esc(n.id)}</text>`;
  }
  const legend=groups.map((g,i)=>`<circle cx="14" cy="${34+i*18}" r="5" fill="${graphColor(g)}"/><text x="26" y="${38+i*18}" font-size="11" font-family="sans-serif" fill="#cdd9e6">${esc(g)}</text>`).join('');
  const caption=`노드 ${nodes.length} · 엣지 ${links.length} · 고립 노드 ${data?.meta?.isolateCount??nodes.filter(n=>n.isolate).length}${data?.meta?.from?` · ${esc(data.meta.from)} ~ ${esc(data.meta.to)}`:''}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#091727"/>
  <g>${edgesSvg}</g>
  <g>${nodesSvg}</g>
  <g>${legend}</g>
  <text x="12" y="20" font-size="12" font-family="sans-serif" fill="#91a7be">${esc(caption)}</text>
</svg>`;
}
function exportNetworkSVG(data,filename){
  if(!data||!Array.isArray(data.nodes)||!data.nodes.length)return alert('그래프를 먼저 생성하세요');
  const svg=buildNetworkSVG(data,1200,700);
  triggerBlobDownload(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}),filename);
}
$('#exportPngBtn1').onclick=()=>{exportCanvasPNG('networkCanvas','fifa-network-dashboard.png');flashButton($('#exportPngBtn1'),'저장됨 ✓')};
$('#exportSvgBtn1').onclick=()=>{exportNetworkSVG(window.__lastHomeNetwork,'fifa-network-dashboard.svg');flashButton($('#exportSvgBtn1'),'저장됨 ✓')};
$('#exportPngBtn2').onclick=()=>{exportCanvasPNG('networkCanvas2','fifa-network-explorer.png');flashButton($('#exportPngBtn2'),'저장됨 ✓')};
$('#exportSvgBtn2').onclick=()=>{exportNetworkSVG(window.__lastExplorerNetwork,'fifa-network-explorer.svg');flashButton($('#exportSvgBtn2'),'저장됨 ✓')};
async function drawExplorer(){
  const from=$('#from').value,to=$('#to').value,type=$('#networkType').value,matchType=$('#matchTypeFilter')?.value||'all';const btn=$('#drawBtn');if(btn.disabled)return;
  const orig=btn.textContent;btn.disabled=true;btn.textContent='생성 중...';
  try{const d=await api(`/api/network?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&type=${encodeURIComponent(type)}&matchType=${encodeURIComponent(matchType)}`);window.__lastExplorerNetwork=d;draw(d,'networkCanvas2');$('#netStats').innerHTML=`노드 <b>${d.nodes.length}</b> · 엣지 <b>${d.links.length}</b> · 원자료 경기 <b>${d.meta.matches}</b> · 고립 노드 <b>${d.meta.isolateCount||0}</b>`}catch(e){$('#netStats').textContent=e.message}finally{btn.disabled=false;btn.textContent=orig}
}
$('#drawBtn').onclick=drawExplorer;
window.addEventListener('resize',()=>{
  clearTimeout(window.__graphResize);
  window.__graphResize=setTimeout(()=>{
    // v28: 창 크기 변경(모바일 키보드 열림/닫힘 포함)은 캔버스만 다시 그리면 충분합니다.
    if(window.__lastHomeNetwork)draw(window.__lastHomeNetwork,'networkCanvas');
    else init();
    if($('#network').classList.contains('active')){
      if(window.__lastExplorerNetwork)draw(window.__lastExplorerNetwork,'networkCanvas2');
      else drawExplorer();
    }
  },180)
});

document.addEventListener('DOMContentLoaded',()=>{init();setTimeout(autoGithubDiagnostic,300)});

async function loadAnalytics(){
  if($('#analyticsCards'))$('#analyticsCards').innerHTML='<div class="metric"><span>불러오는 중</span><b>...</b></div>';
  try{const d=await api(`/api/analytics?type=${$('#analyticsType')?.value||'win'}&matchType=${$('#analyticsMatchType')?.value||'all'}`);renderAnalytics(d)}catch(e){if($('#analyticsCards'))$('#analyticsCards').innerHTML=`<div class="metric"><span>오류</span><b>${e.message}</b></div>`}
}
$('#nullModelBtn').onclick=withBusy($('#nullModelBtn'),async()=>{
  const type=$('#analyticsType').value,matchType=$('#analyticsMatchType').value;
  const d=await api(`/api/null-model?type=${type}&matchType=${matchType}`);
  if(!d.ok){$('#nullModelResult').textContent=d.error||'실패했습니다.';return}
  $('#nullModelResult').innerHTML=`
    <div class="table-wrap"><table><thead><tr><th>지표</th><th>실제 관측</th><th>ER 무작위 기대값</th><th>비율(관측/기대)</th></tr></thead><tbody>
      <tr><td>군집계수(clustering)</td><td>${d.observed.clustering}</td><td>${d.erNullModel.clustering}</td><td>${d.clusteringRatio??'-'}</td></tr>
      <tr><td>차수 분산</td><td>${d.observed.degreeVariance}</td><td>${d.erNullModel.degreeVariance}</td><td>${d.degreeVarianceRatio??'-'}</td></tr>
    </tbody></table></div>
    <p style="margin-top:8px">노드 ${d.n}개 · 엣지 ${d.m}개 · 밀도 ${d.density}</p>
    <p style="color:#91a7be">${d.interpretation}</p>
  `;
},{loadingText:'계산 중...',targetEl:$('#nullModelResult'),loadingHtml:'계산 중...'});
$('#confedBtn').onclick=withBusy($('#confedBtn'),async()=>{
  const type=$('#analyticsType').value,matchType=$('#analyticsMatchType').value;
  const d=await api(`/api/confederation-breakdown?type=${type}&matchType=${matchType}`);
  if(!d.ok){$('#confedResult').textContent=d.error||'실패했습니다.';return}
  const rows=d.confederations.map(c=>`<tr><td>${c.confederation}</td><td>${c.nodeCount}</td><td>${c.withinEdgeCount}</td><td>${c.density}</td><td>${c.averageDegree}</td></tr>`).join('');
  $('#confedResult').innerHTML=`
    <div class="table-wrap"><table><thead><tr><th>연맹</th><th>국가 수</th><th>연맹 내 엣지</th><th>밀도</th><th>평균 연결</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p style="margin-top:8px">연맹 내부 연결 비율(withinShare): <b>${(d.homophily.withinShare*100).toFixed(1)}%</b> (연맹 내 ${d.homophily.withinEdges} / 연맹 간 ${d.homophily.crossEdges})</p>
    <p style="color:#91a7be">${d.note}</p>
  `;
},{loadingText:'계산 중...',targetEl:$('#confedResult'),loadingHtml:'계산 중...'});
function renderAnalytics(d){if(!$('#analyticsCards'))return;$('#analyticsCards').innerHTML=card('노드',d.meta.nodeCount)+card('엣지',d.meta.edgeCount)+card('커뮤니티',d.meta.communities)+card('분석유형',d.meta.type);const body=$('#centralityTable tbody');body.innerHTML=(d.top||[]).map((x,i)=>`<tr><td>${i+1}</td><td><b>${x.name}</b><small>${x.code}</small></td><td>${x.confederation}</td><td>${x.totalDegree}</td><td>${x.pageRank}</td><td>${x.community}</td></tr>`).join('');$('#confederationSummary').innerHTML=(d.confederations||[]).sort((a,b)=>b.averageDegree-a.averageDegree).map(x=>`<div class="rank-row"><b>${x.name}</b><span>${x.nodes}개국 · 평균 Degree ${x.averageDegree}</span></div>`).join('')}
$('#analyticsBtn').onclick=withBusy($('#analyticsBtn'),loadAnalytics,{loadingText:'계산 중...'});
$('#comparisonBtn').onclick=withBusy($('#comparisonBtn'),async()=>{
  const d=await api('/api/model-comparison');
  const best=d.best?`<p class="good"><b>최적 AIC 모형 #${d.best.id}</b> · AIC ${d.best.aic} · ${d.best.usedFormula}</p>`:'<p>완료된 비교 가능 모형이 없습니다.</p>';
  $('#modelComparison').innerHTML=best+`<div class="table-wrap"><table><thead><tr><th>ID</th><th>모형</th><th>상태</th><th>AIC</th><th>BIC</th><th>수렴</th><th>실제 식</th></tr></thead><tbody>${(d.rows||[]).map(x=>`<tr><td>#${x.id}</td><td>${x.name}</td><td>${x.status}</td><td>${x.aic??'-'}</td><td>${x.bic??'-'}</td><td>${x.converged?'예':'아니오'}</td><td><code>${x.usedFormula||x.formula}</code></td></tr>`).join('')}</tbody></table></div>`;
},{loadingText:'비교 중...',targetEl:$('#modelComparison'),loadingHtml:'모형 비교를 불러오는 중입니다...'});

async function loadProjects(){try{const rows=await api('/api/projects');$('#projectList').innerHTML=rows.length?rows.map(x=>`<div class="rank-row"><b>#${x.id} ${x.project_name}</b><span>${x.network_type} · 스냅샷 ${x.snapshot_count} · 모형 ${x.model_count}</span></div>`).join(''):'프로젝트가 없습니다.';return rows}catch(e){$('#projectList').textContent=e.message;return[]}}
$('#createProjectBtn').onclick=withBusy($('#createProjectBtn'),async()=>{
  const d=await api('/api/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('#projectName').value,researchQuestion:$('#projectQuestion').value,networkType:'win'})});
  $('#researchLog').textContent=JSON.stringify(d,null,2);await loadProjects();
},{loadingText:'생성 중...',targetEl:$('#researchLog'),loadingHtml:'프로젝트를 생성하는 중입니다...'});
$('#temporalBtn').onclick=withBusy($('#temporalBtn'),async()=>{
  const d=await api(`/api/temporal-network?type=${$('#temporalType').value}`);
  $('#temporalResult').innerHTML=`<div class="table-wrap"><table><thead><tr><th>연도</th><th>노드</th><th>엣지</th><th>경기</th><th>밀도</th><th>평균차수</th></tr></thead><tbody>${d.series.map(x=>`<tr><td>${x.year}</td><td>${x.nodeCount}</td><td>${x.edgeCount}</td><td>${x.matchCount}</td><td>${x.density}</td><td>${x.averageDegree}</td></tr>`).join('')}</tbody></table></div><small>${d.note}</small>`;
  $('#researchLog').textContent=JSON.stringify(d,null,2);
},{loadingText:'계산 중...',targetEl:$('#temporalResult'),loadingHtml:'연도별 지표를 계산하는 중입니다...'});
const doPeriodCompare=withBusy($('#periodCompareBtn'),async()=>{
  const type=$('#periodType').value,aFrom=$('#periodAFrom').value,aTo=$('#periodATo').value,bFrom=$('#periodBFrom').value,bTo=$('#periodBTo').value;
  const d=await api(`/api/period-comparison?type=${type}&aFrom=${aFrom}&aTo=${aTo}&bFrom=${bFrom}&bTo=${bTo}`);
  if(!d.ok){$('#periodResult').textContent=d.error||'비교에 실패했습니다.';return}
  const metricRow=(label,a,b,delta)=>`<tr><td>${label}</td><td>${a}</td><td>${b}</td><td>${delta}</td></tr>`;
  const moversRows=(d.topMovers||[]).map(m=>`<tr><td>${m.name}</td><td>${m.rankA??'-'}</td><td>${m.rankB??'-'}</td><td style="color:${m.delta>0?'#5fd58e':m.delta<0?'#e0715f':'#91a7be'}">${m.delta>0?'▲':m.delta<0?'▼':'-'} ${Math.abs(m.delta)}</td></tr>`).join('');
  $('#periodResult').innerHTML=`
    <div style="margin-bottom:8px">기간 A: ${d.periodA.from} ~ ${d.periodA.to} &nbsp;|&nbsp; 기간 B: ${d.periodB.from} ~ ${d.periodB.to}</div>
    <div class="table-wrap"><table><thead><tr><th>지표</th><th>기간 A</th><th>기간 B</th><th>변화</th></tr></thead><tbody>
      ${metricRow('노드 수',d.periodA.nodeCount,d.periodB.nodeCount,d.delta.nodeCount)}
      ${metricRow('엣지 수',d.periodA.edgeCount,d.periodB.edgeCount,d.delta.edgeCount)}
      ${metricRow('활성 노드(고립 아님)',d.periodA.activeNodes,d.periodB.activeNodes,d.periodB.activeNodes-d.periodA.activeNodes)}
      ${metricRow('밀도',d.periodA.density,d.periodB.density,d.delta.density)}
      ${metricRow('평균 연결수',d.periodA.avgDegree,d.periodB.avgDegree,d.delta.avgDegree)}
      ${metricRow('커뮤니티 수',d.periodA.communities,d.periodB.communities,d.periodB.communities-d.periodA.communities)}
    </tbody></table></div>
    <h4 style="margin-top:12px">순위 변동이 큰 국가 (PageRank 기준, 상위 15개)</h4>
    <div class="table-wrap"><table><thead><tr><th>국가</th><th>기간 A 순위</th><th>기간 B 순위</th><th>변동</th></tr></thead><tbody>${moversRows||'<tr><td colspan="4">비교할 데이터가 부족합니다</td></tr>'}</tbody></table></div>
  `;
},{loadingText:'비교 중...',targetEl:$('#periodResult'),loadingHtml:'비교 계산 중...'});
$('#periodCompareBtn').onclick=()=>{
  const aFrom=$('#periodAFrom').value,aTo=$('#periodATo').value,bFrom=$('#periodBFrom').value,bTo=$('#periodBTo').value;
  if(!aFrom||!aTo||!bFrom||!bTo)return alert('기간 A, B의 시작·종료 날짜를 모두 입력하세요');
  doPeriodCompare();
};
$('#freezeBtn').onclick=withBusy($('#freezeBtn'),async()=>{
  const projects=await loadProjects(),projectId=projects[0]?.id||null;
  const d=await api('/api/dataset-freeze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:`FIFA Dataset ${new Date().toISOString().slice(0,10)}`,projectId})});
  $('#researchLog').textContent=JSON.stringify(d,null,2);
},{loadingText:'동결 중...',targetEl:$('#researchLog'),loadingHtml:'데이터셋을 동결하는 중입니다...'});
$('#reportBtn').onclick=withBusy($('#reportBtn'),async()=>download('fifa-network-reproducibility-report-v13.json',await api('/api/reproducibility-report')),{loadingText:'생성 중...'});
$('#graphmlBtn').onclick=withBusy($('#graphmlBtn'),()=>downloadUrl('/api/export/graphml?type=win','fifa-network.graphml'),{loadingText:'내보내는 중...'});
$('#gexfBtn').onclick=withBusy($('#gexfBtn'),()=>downloadUrl('/api/export/gexf?type=win','fifa-network.gexf'),{loadingText:'내보내는 중...'});
$('#bibtexBtn').onclick=withBusy($('#bibtexBtn'),()=>downloadUrl('/api/citation?format=bibtex','fifa-network-lab.bib'),{loadingText:'내보내는 중...'});
$('#risBtn').onclick=withBusy($('#risBtn'),()=>downloadUrl('/api/citation?format=ris','fifa-network-lab.ris'),{loadingText:'내보내는 중...'});
$('#apaBtn').onclick=withBusy($('#apaBtn'),()=>downloadUrl('/api/citation?format=apa','fifa-network-lab-apa.txt'),{loadingText:'내보내는 중...'});
document.addEventListener('DOMContentLoaded',()=>setTimeout(loadProjects,500));
