const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
async function api(path,opt){const r=await fetch(path,opt);let d;try{d=await r.json()}catch{d={error:await r.text()}}if(!r.ok)throw new Error(d.error||'요청 실패');return d}
function show(view){$$('.view').forEach(x=>x.classList.toggle('active',x.id===view));window.scrollTo(0,0);if(view==='home')init();if(view==='model')autoGithubDiagnostic();else if(typeof stopGithubPoll==='function')stopGithubPoll();if(view==='analytics')loadAnalytics()}
$$('nav button').forEach(b=>b.onclick=()=>show(b.dataset.view));
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
  if(nr.status==='fulfilled')draw(nr.value,'networkCanvas');else draw({nodes:[],links:[]},'networkCanvas');
  autoSourceCheck();
}
function renderQuality(q){
  const cls=q.score>=95?'good':q.score>=80?'warn':'bad';
  const dims=(q.dimensions||[]).map(x=>`<div class="quality-row"><div class="quality-head"><b>${x.label}</b><span>${Number(x.percent).toFixed(1)}% · ${x.score}/${x.weight}점</span></div><div class="quality-track"><i style="width:${Math.max(0,Math.min(100,x.percent))}%"></i></div><small>${x.detail}</small></div>`).join('');
  const c=q.counts||{};
  $('#quality').innerHTML=`<div class="quality-summary"><div class="quality-score ${cls}">${q.score}<small>/100</small></div><div><b>${q.grade||''}</b><span>FIFA 회원국 ${c.fifaMembers||0} · 유효 경기 ${(c.memberMatches||0).toLocaleString()} · 최신 랭킹 ${c.latestRankingTeams||0}개국</span></div></div><div class="quality-dimensions">${dims}</div><div class="quality-foot"><span>중복 후보 처리 ${(c.duplicateCandidatesHandled||0).toLocaleString()}건</span><span>비회원 경기 자동 제외 ${(c.excludedNonMemberMatches||0).toLocaleString()}건</span><span>무효 오류 ${(c.invalid||0).toLocaleString()}건</span></div><details><summary>산식과 해석</summary><p>${q.methodology||''}</p><ul>${(q.notes||[]).map(x=>`<li>${x}</li>`).join('')}</ul></details>`
}
$('#qualityBtn').onclick=async()=>{const q=await api('/api/quality');renderQuality(q);$('#log').textContent=JSON.stringify(q,null,2)};
$('#providerTestBtn').onclick=async()=>{try{$('#log').textContent='API 연결 진단 중...';const d=await api('/api/provider/test');$('#log').textContent=JSON.stringify(d,null,2);const ok=(d.results||[]).filter(x=>x.ok).length,total=(d.results||[]).length;setHealth(d.ok?'good':'warn',d.ok?'정상':'부분 정상',`외부 데이터 소스 ${ok}/${total} 연결`)}catch(e){$('#log').textContent=e.message}};
function renderProgress(p){if(!p)return;$('#progressBar').style.width=`${p.percent}%`;$('#progressText').textContent=`${p.completed} / ${p.total} (${p.percent}%)`;$('#nextTask').textContent=p.finished?'수집 완료':`다음 작업: ${p.next?.label||'-'} · 남은 배치 ${p.remaining}개`;}
$('#collectBtn').onclick=async()=>{try{$('#log').textContent='다음 배치 수집 중...';const d=await api('/api/collect',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});$('#log').textContent=JSON.stringify(d,null,2);renderProgress(d.progress);await init()}catch(e){$('#log').textContent=e.message}};$('#resetCollectBtn').onclick=async()=>{if(!confirm('진행 커서를 처음으로 되돌릴까요? 이미 저장된 데이터는 삭제되지 않습니다.'))return;try{const d=await api('/api/collect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reset:true})});$('#log').textContent=JSON.stringify(d,null,2);renderProgress(d.progress)}catch(e){$('#log').textContent=e.message}};
function download(name,obj){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));a.download=name;a.click();URL.revokeObjectURL(a.href)}
$('#exportBtn').onclick=$('#paperExport').onclick=async()=>download('fifa-network-research-data.json',await api('/api/export'));
$('#reproExport').onclick=async()=>download('fifa-network-reproducibility-v13.json',await api('/api/reproducibility'));
$('#interpretLatest').onclick=async()=>{
  const btn=$('#interpretLatest'),orig=btn.textContent;btn.disabled=true;btn.textContent='AI 분석 중...';
  $('#paperInsight').innerHTML='<span class="warn">Cloudflare Workers AI로 최신 모형을 해설하는 중입니다... (몇 초 정도 걸릴 수 있습니다)</span>';
  try{
    const d=await api('/api/interpret');
    const badge=d.aiGenerated?`<span class="good">● AI 생성(${d.aiModel||'Workers AI'})</span>`:`<span class="warn">● 기본 요약(AI 미사용${d.aiError?': '+d.aiError:''})</span>`;
    const notes=(d.coefficientNotes||[]).map((x)=>`<li>${x}</li>`).join('');
    $('#paperInsight').innerHTML=`<div style="margin-bottom:8px">${badge}</div><b>${d.headline||''}</b><p>${d.summary||''}</p>${notes?`<h4>계수 해석</h4><ul>${notes}</ul>`:''}<h4>주의사항</h4><ul>${(d.cautions||[]).map(x=>`<li>${x}</li>`).join('')}</ul>`;
  }catch(e){$('#paperInsight').textContent=e.message}
  finally{btn.disabled=false;btn.textContent=orig}
};
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
  const f=$('#fileInput').files[0];if(!f)return alert('파일을 선택하세요');
  const btn=$('#importBtn'),orig=btn.textContent;btn.disabled=true;btn.textContent='가져오는 중...';$('#log').textContent='업로드 처리 중...';
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
$('#normalizeBtn').onclick=async()=>{
  const btn=$('#normalizeBtn'),orig=btn.textContent;btn.disabled=true;btn.textContent='정규화 중...';$('#log').textContent='FIFA 211 정규화 실행 중...';
  try{const d=await api('/api/fifa-normalize',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});$('#log').textContent=JSON.stringify(d,null,2);await init()}
  catch(e){$('#log').textContent=`정규화 실패: ${e.message}`}
  finally{btn.disabled=false;btn.textContent=orig}
};
function formula(){const terms=$$('.term:checked').map(x=>x.value);const f=`network ~ ${terms.join(' + ')||'edges'}`;$('#formula').textContent=f;return f}$$('.term').forEach(x=>x.onchange=formula);formula();


function renderGithubDiag(d){const checks=(d.checks||[]).map(x=>`<li><b>${x.name}</b> · HTTP ${x.status??'-'} · <span class="${x.ok?'good':'bad'}">${x.ok?'정상':'실패'}</span>${x.message?` · ${x.message}`:''}</li>`).join('');$('#githubDiagResult').innerHTML=`<b class="${d.ok?'good':'bad'}">${d.ok?'GitHub 연결 정상':'GitHub 연결 점검 필요'}</b><p>대상 저장소: <code>${d.owner||'-'}/${d.repo||'-'}</code> · 워크플로: <code>${d.workflow||'-'}</code> · 방식: <code>${d.dispatchMode||'-'}</code></p><ul>${checks}</ul><small>${d.recommendation||''}</small>`}
$('#githubDiagBtn').onclick=async()=>{try{$('#githubDiagResult').textContent='GitHub 저장소·워크플로·토큰 접근권한을 확인 중입니다...';const d=await api('/api/github/diagnostics');renderGithubDiag(d);$('#modelDetail').textContent=JSON.stringify(d,null,2)}catch(e){$('#githubDiagResult').innerHTML=`<b class="bad">진단 실패</b><p>${e.message}</p>`}};
function renderValidation(v){if(!v)return;const counts=v.counts||{};const errors=(v.errors||[]).map(x=>`<li>${x}</li>`).join('');const warnings=(v.warnings||[]).map(x=>`<li>${x}</li>`).join('');$('#validationResult').innerHTML=`<b class="${v.ok?'good':'bad'}">${v.ok?'분석 가능':'분석 불가'}</b><p>국가 ${counts.teams||0} · 경기 ${counts.matches||0} · 사용 가능 엣지 ${counts.usableEdges||0} · 랭킹 ${counts.rankings||0}</p>${errors?`<h4>오류</h4><ul>${errors}</ul>`:''}${warnings?`<h4>주의</h4><ul>${warnings}</ul>`:''}<small>${v.recommendation||''}</small>`}
$('#validateModel').onclick=async()=>{try{const v=await api(`/api/model-validation?type=${$('#modelNetwork').value}`);renderValidation(v);$('#modelDetail').textContent=JSON.stringify(v,null,2)}catch(e){$('#modelDetail').textContent=e.message}};
const STEP_ICON={completed_success:'✅',completed_failure:'❌',completed_cancelled:'⏹️',in_progress:'🔄',queued:'⏳',pending:'⏳'};
function stepIcon(s){if(s.status==='completed')return s.conclusion==='success'?STEP_ICON.completed_success:s.conclusion==='cancelled'?STEP_ICON.completed_cancelled:STEP_ICON.completed_failure;if(s.status==='in_progress')return STEP_ICON.in_progress;return STEP_ICON.pending}
function renderGithubStepProgress(d){
  const box=$('#githubStepProgress');if(!box)return;
  if(!d||!d.ok){box.style.display='block';box.innerHTML=`<b>GitHub 진행 상황</b><p class="warn">${d?.error||'조회할 수 없습니다.'}</p>`;return}
  if(!d.steps||!d.steps.length){box.style.display='block';box.innerHTML=`<b>GitHub 진행 상황</b><p>${d.note||'대기 중입니다...'}</p>`;return}
  box.style.display='block';
  const rows=d.steps.map(s=>`<li>${stepIcon(s)} ${s.label}</li>`).join('');
  box.innerHTML=`<b>GitHub 진행 상황</b>${d.runUrl?` · <a href="${d.runUrl}" target="_blank" rel="noopener">Actions에서 보기</a>`:''}<ul class="step-list">${rows}</ul>`;
}
let githubPollTimer=null;
function stopGithubPoll(){if(githubPollTimer){clearInterval(githubPollTimer);githubPollTimer=null}}
function startGithubPoll(runId){
  stopGithubPoll();
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
$('#runModel').onclick=async()=>{try{const d=await api('/api/models',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('#modelName').value,networkType:$('#modelNetwork').value,formula:formula()})});$('#runLookup').value=d.runId;$('#modelResult').innerHTML=`실행번호 <b>#${d.runId}</b> · ${d.status}<br>${d.note}`;renderValidation(d.validation);$('#modelDetail').textContent=JSON.stringify(d,null,2);if(d.runId)startGithubPoll(d.runId);init()}catch(e){$('#modelDetail').textContent=e.message}};
$('#checkModel').onclick=async()=>{const id=$('#runLookup').value;if(!id)return alert('실행번호를 입력하세요');try{const d=await api(`/api/models?id=${id}`);$('#modelResult').innerHTML=`실행번호 <b>#${d.id}</b> · ${d.status}`;$('#modelDetail').textContent=JSON.stringify(d,null,2);if(d.status==='completed'||d.status==='failed'){stopGithubPoll();const p=await api(`/api/github/run-progress?id=${id}`);renderGithubStepProgress(p)}else{startGithubPoll(id)}}catch(e){$('#modelDetail').textContent=e.message}};

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
async function drawExplorer(){
  const from=$('#from').value,to=$('#to').value,type=$('#networkType').value;const btn=$('#drawBtn');btn.disabled=true;btn.textContent='생성 중...';
  try{const d=await api(`/api/network?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&type=${encodeURIComponent(type)}`);draw(d,'networkCanvas2');$('#netStats').innerHTML=`노드 <b>${d.nodes.length}</b> · 엣지 <b>${d.links.length}</b> · 원자료 경기 <b>${d.meta.matches}</b> · 고립 노드 <b>${d.meta.isolateCount||0}</b>`}catch(e){$('#netStats').textContent=e.message}finally{btn.disabled=false;btn.textContent='그래프 생성'}
}
$('#drawBtn').onclick=drawExplorer;
window.addEventListener('resize',()=>{clearTimeout(window.__graphResize);window.__graphResize=setTimeout(()=>{init();if($('#network').classList.contains('active'))drawExplorer()},180)});

document.addEventListener('DOMContentLoaded',()=>{init();setTimeout(autoGithubDiagnostic,300)});

async function loadAnalytics(){try{const d=await api(`/api/analytics?type=${$('#analyticsType')?.value||'win'}`);renderAnalytics(d)}catch(e){if($('#modelComparison'))$('#modelComparison').textContent=e.message}}
function renderAnalytics(d){if(!$('#analyticsCards'))return;$('#analyticsCards').innerHTML=card('노드',d.meta.nodeCount)+card('엣지',d.meta.edgeCount)+card('커뮤니티',d.meta.communities)+card('분석유형',d.meta.type);const body=$('#centralityTable tbody');body.innerHTML=(d.top||[]).map((x,i)=>`<tr><td>${i+1}</td><td><b>${x.name}</b><small>${x.code}</small></td><td>${x.confederation}</td><td>${x.totalDegree}</td><td>${x.pageRank}</td><td>${x.community}</td></tr>`).join('');$('#confederationSummary').innerHTML=(d.confederations||[]).sort((a,b)=>b.averageDegree-a.averageDegree).map(x=>`<div class="rank-row"><b>${x.name}</b><span>${x.nodes}개국 · 평균 Degree ${x.averageDegree}</span></div>`).join('')}
$('#analyticsBtn').onclick=loadAnalytics;
$('#comparisonBtn').onclick=async()=>{try{const d=await api('/api/model-comparison');const best=d.best?`<p class="good"><b>최적 AIC 모형 #${d.best.id}</b> · AIC ${d.best.aic} · ${d.best.usedFormula}</p>`:'<p>완료된 비교 가능 모형이 없습니다.</p>';$('#modelComparison').innerHTML=best+`<div class="table-wrap"><table><thead><tr><th>ID</th><th>모형</th><th>상태</th><th>AIC</th><th>BIC</th><th>수렴</th><th>실제 식</th></tr></thead><tbody>${(d.rows||[]).map(x=>`<tr><td>#${x.id}</td><td>${x.name}</td><td>${x.status}</td><td>${x.aic??'-'}</td><td>${x.bic??'-'}</td><td>${x.converged?'예':'아니오'}</td><td><code>${x.usedFormula||x.formula}</code></td></tr>`).join('')}</tbody></table></div>`}catch(e){$('#modelComparison').textContent=e.message}};


function downloadUrl(url,name){const a=document.createElement('a');a.href=url;a.download=name;a.click()}
async function loadProjects(){try{const rows=await api('/api/projects');$('#projectList').innerHTML=rows.length?rows.map(x=>`<div class="rank-row"><b>#${x.id} ${x.project_name}</b><span>${x.network_type} · 스냅샷 ${x.snapshot_count} · 모형 ${x.model_count}</span></div>`).join(''):'프로젝트가 없습니다.';return rows}catch(e){$('#projectList').textContent=e.message;return[]}}
$('#createProjectBtn').onclick=async()=>{try{const d=await api('/api/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('#projectName').value,researchQuestion:$('#projectQuestion').value,networkType:'win'})});$('#researchLog').textContent=JSON.stringify(d,null,2);await loadProjects()}catch(e){$('#researchLog').textContent=e.message}};
$('#temporalBtn').onclick=async()=>{try{const d=await api(`/api/temporal-network?type=${$('#temporalType').value}`);$('#temporalResult').innerHTML=`<div class="table-wrap"><table><thead><tr><th>연도</th><th>노드</th><th>엣지</th><th>경기</th><th>밀도</th><th>평균차수</th></tr></thead><tbody>${d.series.map(x=>`<tr><td>${x.year}</td><td>${x.nodeCount}</td><td>${x.edgeCount}</td><td>${x.matchCount}</td><td>${x.density}</td><td>${x.averageDegree}</td></tr>`).join('')}</tbody></table></div><small>${d.note}</small>`;$('#researchLog').textContent=JSON.stringify(d,null,2)}catch(e){$('#researchLog').textContent=e.message}};
$('#freezeBtn').onclick=async()=>{try{const projects=await loadProjects(),projectId=projects[0]?.id||null;const d=await api('/api/dataset-freeze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:`FIFA Dataset ${new Date().toISOString().slice(0,10)}`,projectId})});$('#researchLog').textContent=JSON.stringify(d,null,2)}catch(e){$('#researchLog').textContent=e.message}};
$('#reportBtn').onclick=async()=>download('fifa-network-reproducibility-report-v13.json',await api('/api/reproducibility-report'));
$('#graphmlBtn').onclick=()=>downloadUrl('/api/export/graphml?type=win','fifa-network.graphml');
$('#gexfBtn').onclick=()=>downloadUrl('/api/export/gexf?type=win','fifa-network.gexf');
$('#bibtexBtn').onclick=()=>downloadUrl('/api/citation?format=bibtex','fifa-network-lab.bib');
$('#risBtn').onclick=()=>downloadUrl('/api/citation?format=ris','fifa-network-lab.ris');
$('#apaBtn').onclick=()=>downloadUrl('/api/citation?format=apa','fifa-network-lab-apa.txt');
document.addEventListener('DOMContentLoaded',()=>setTimeout(loadProjects,500));
