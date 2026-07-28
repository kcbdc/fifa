interface Env {
  DB: D1Database; ASSETS: Fetcher; AI: Ai;
  APP_NAME: string; DATA_WINDOW_YEARS: string;
  DATA_PROVIDER?: string;
  FIFA_RANKING_URL?: string; MATCH_API_URL?: string;
  SPORTRADAR_ACCESS_LEVEL?: string; SPORTRADAR_LANGUAGE?: string;
  BACKFILL_DAYS_PER_RUN?: string;
  SPORTRADAR_API_KEY?: string; FOOTBALLDATA_API_KEY?: string;
  FOOTBALLDATA_PERIODS_URL?: string; COUNTRY_API_URL?: string;
  RANKING_BACKFILL_PER_RUN?: string; MATCH_WINDOW_DAYS?: string;
  GITHUB_OWNER: string; GITHUB_REPO: string;
  GITHUB_TOKEN?: string; ADMIN_TOKEN?: string;
}

type AnyObj = Record<string, any>;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store'}});
const bad=(m:string,s=400)=>json({ok:false,error:m},s);
const auth=(r:Request,e:Env)=>!e.ADMIN_TOKEN||r.headers.get('authorization')===`Bearer ${e.ADMIN_TOKEN}`;
const isoDate=(d:Date)=>d.toISOString().slice(0,10);
const yearsAgo=(years:number)=>{const d=new Date();d.setUTCFullYear(d.getUTCFullYear()-years);return isoDate(d)};
const asArray=(x:any):any[]=>Array.isArray(x)?x:[];
const n=(x:any, fallback=0)=>Number.isFinite(Number(x))?Number(x):fallback;
const cleanCode=(x:any)=>String(x||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);

async function dashboard(e:Env){
 const [teams,matches,rankings,issues,latest,runs,jobs]=await Promise.all([
  e.DB.prepare('SELECT COUNT(*) n FROM teams').first<{n:number}>(),e.DB.prepare('SELECT COUNT(*) n FROM matches').first<{n:number}>(),e.DB.prepare('SELECT COUNT(*) n FROM rankings').first<{n:number}>(),e.DB.prepare('SELECT COUNT(*) n FROM data_quality_issues WHERE resolved=0').first<{n:number}>(),e.DB.prepare('SELECT MAX(collected_at) v FROM rankings').first<{v:string}>(),e.DB.prepare('SELECT * FROM model_runs ORDER BY id DESC LIMIT 5').all(),e.DB.prepare('SELECT * FROM collection_jobs ORDER BY id DESC LIMIT 5').all()
 ]);
 return {teams:teams?.n||0,matches:matches?.n||0,rankings:rankings?.n||0,issues:issues?.n||0,latest:latest?.v||null,runs:runs.results,jobs:jobs.results,provider:providerInfo(e)};
}
async function network(e:Env,url:URL){
 const from=url.searchParams.get('from')||yearsAgo(Number(e.DATA_WINDOW_YEARS||4)),to=url.searchParams.get('to')||isoDate(new Date()),type=url.searchParams.get('type')||'match';
 const rows=await e.DB.prepare(`SELECT m.*,h.fifa_code hcode,h.name_ko hname,h.confederation hconf,a.fifa_code acode,a.name_ko aname,a.confederation aconf FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE m.match_date BETWEEN ? AND ?`).bind(from,to).all<any>();
 const nodes=new Map<string,any>(), links=new Map<string,any>();
 for(const r of rows.results){ nodes.set(r.hcode,{id:r.hcode,label:r.hname,group:r.hconf});nodes.set(r.acode,{id:r.acode,label:r.aname,group:r.aconf});
  let source=r.hcode,target=r.acode;if(type==='win'){if(r.home_score===r.away_score)continue;if(r.home_score<r.away_score){source=r.acode;target=r.hcode}}
  const key=type==='match'?[source,target].sort().join('|'):`${source}|${target}`;const v=links.get(key)||{source,target,value:0};v.value++;links.set(key,v);
 }
 return {nodes:[...nodes.values()],links:[...links.values()],meta:{from,to,type,matches:rows.results.length}};
}
async function rankings(e:Env){const q=await e.DB.prepare(`SELECT r.release_date,r.rank,r.points,r.previous_rank,t.fifa_code,t.name_ko,t.name_en,t.confederation FROM rankings r JOIN teams t ON t.id=r.team_id ORDER BY r.release_date DESC,r.rank ASC LIMIT 1000`).all();return q.results;}
async function quality(e:Env){
 const dup=await e.DB.prepare(`SELECT match_date,home_team_id,away_team_id,COUNT(*) n FROM matches GROUP BY match_date,home_team_id,away_team_id HAVING n>1`).all();
 const invalid=await e.DB.prepare(`SELECT id FROM matches WHERE home_score<0 OR away_score<0 OR home_team_id=away_team_id`).all();
 return {score:Math.max(0,100-dup.results.length*5-invalid.results.length*10),duplicates:dup.results,invalid:invalid.results};
}

function providerInfo(e:Env){
 const provider=(e.DATA_PROVIDER||'footballdata').toLowerCase();
 if(provider==='footballdata'){
  const base='https://footballdata.io/api/v1';
  return {
   provider,
   rankingUrl:e.FIFA_RANKING_URL||`${base}/fifa-rankings/current?ranking_type=men&limit=100`,
   periodsUrl:e.FOOTBALLDATA_PERIODS_URL||`${base}/fifa-rankings/periods?ranking_type=men&limit=100`,
   matchTemplate:e.MATCH_API_URL||`${base}/fixtures/results?from={from}&to={to}&limit=100&page={page}`,
   countryUrl:e.COUNTRY_API_URL||`${base}/countries?limit=100`,
   hasApiKey:Boolean(e.FOOTBALLDATA_API_KEY),
   backfillDaysPerRun:Number(e.MATCH_WINDOW_DAYS||31),
   rankingBackfillPerRun:Number(e.RANKING_BACKFILL_PER_RUN||2)
  };
 }
 const level=e.SPORTRADAR_ACCESS_LEVEL||'trial',lang=e.SPORTRADAR_LANGUAGE||'en';
 return {
  provider,
  rankingUrl:e.FIFA_RANKING_URL||`https://api.sportradar.com/soccer-extended/${level}/v4/${lang}/fifa_rankings.json`,
  periodsUrl:'',
  matchTemplate:e.MATCH_API_URL||`https://api.sportradar.com/soccer-extended/${level}/v4/${lang}/schedules/{date}/summaries.json`,
  countryUrl:'',
  hasApiKey:Boolean(e.SPORTRADAR_API_KEY),
  backfillDaysPerRun:Number(e.BACKFILL_DAYS_PER_RUN||7),
  rankingBackfillPerRun:0
 };
}
function providerHeaders(e:Env):Record<string,string>{
 const p=(e.DATA_PROVIDER||'footballdata').toLowerCase();
 if(p==='sportradar') return {'accept':'application/json','x-api-key':e.SPORTRADAR_API_KEY||''};
 if(p==='footballdata') return {'accept':'application/json','authorization':`Bearer ${e.FOOTBALLDATA_API_KEY||''}`};
 return {'accept':'application/json'};
}
async function fetchJson(url:string,e:Env){
 const res=await fetch(url,{headers:{...providerHeaders(e),'user-agent':'FIFA-Network-Lab/2.0'}});
 if(!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
 return await res.json() as AnyObj;
}
async function upsertTeam(e:Env, code:string, name:string, conf='UNK'){
 code=cleanCode(code); if(!code||!name) return null;
 await e.DB.prepare(`INSERT INTO teams(fifa_code,name_ko,name_en,confederation) VALUES(?,?,?,?) ON CONFLICT(fifa_code) DO UPDATE SET name_en=excluded.name_en,updated_at=CURRENT_TIMESTAMP`).bind(code,name,name,conf).run();
 return await e.DB.prepare('SELECT id FROM teams WHERE fifa_code=?').bind(code).first<{id:number}>();
}
async function ingestSportradarRankings(data:AnyObj,e:Env,sourceUrl:string){
 let inserted=0, warnings=0;
 const boards=asArray(data.rankings).length?asArray(data.rankings):[data];
 for(const board of boards){
  for(const row of asArray(board.competitor_rankings||board.competitors||data.competitor_rankings)){
   const c=row.competitor||{}; if((c.gender&&c.gender!=='male')||(board.gender&&board.gender!=='men')) continue;
   const code=cleanCode(c.abbreviation||c.country_code); const name=c.name||c.country||code;
   if(!code){warnings++;continue}
   const team=await upsertTeam(e,code,name,'UNK'); if(!team){warnings++;continue}
   const release=String(row.last_updated||board.last_updated||data.generated_at||new Date().toISOString()).slice(0,10);
   const previousRank=row.movement!==undefined?n(row.rank)-n(row.movement):null;
   await e.DB.prepare(`INSERT INTO rankings(team_id,release_date,rank,points,previous_rank,source_url) VALUES(?,?,?,?,?,?) ON CONFLICT(team_id,release_date) DO UPDATE SET rank=excluded.rank,points=excluded.points,previous_rank=excluded.previous_rank,source_url=excluded.source_url,collected_at=CURRENT_TIMESTAMP`).bind(team.id,release,n(row.rank),n(row.points),previousRank,sourceUrl).run(); inserted++;
  }
 }
 return {inserted,warnings};
}
function eventCompetitors(ev:AnyObj){
 const list=asArray(ev.competitors); const home=list.find((x:any)=>x.qualifier==='home')||list[0]; const away=list.find((x:any)=>x.qualifier==='away')||list[1]; return {home,away};
}
async function rankedCodeSet(e:Env){const q=await e.DB.prepare('SELECT fifa_code FROM teams').all<{fifa_code:string}>();return new Set(q.results.map(x=>cleanCode(x.fifa_code)));}
async function ingestSportradarMatches(data:AnyObj,e:Env,sourceUrl:string){
 let inserted=0,warnings=0,skipped=0; const known=await rankedCodeSet(e);
 const summaries=asArray(data.summaries||data.sport_events||data.results);
 for(const item of summaries){
  const ev=item.sport_event||item; const st=item.sport_event_status||item.status||{}; const {home,away}=eventCompetitors(ev);
  if(!home||!away){warnings++;continue}
  const hc=cleanCode(home.abbreviation||home.country_code), ac=cleanCode(away.abbreviation||away.country_code);
  // 국가대표 연구용: FIFA 랭킹 팀 코드와 양쪽 모두 일치하는 경기만 저장
  if(!known.has(hc)||!known.has(ac)){skipped++;continue}
  const hs=n(st.home_score??st.period_scores?.at?.(-1)?.home_score,NaN), as=n(st.away_score??st.period_scores?.at?.(-1)?.away_score,NaN);
  if(!Number.isFinite(hs)||!Number.isFinite(as)){skipped++;continue}
  const ht=await upsertTeam(e,hc,home.name||hc,'UNK'), at=await upsertTeam(e,ac,away.name||ac,'UNK'); if(!ht||!at){warnings++;continue}
  const ctx=ev.sport_event_context||{}; const competition=ctx.competition?.name||'International'; const stage=ctx.round?.name||ctx.stage?.name||null;
  await e.DB.prepare(`INSERT INTO matches(external_id,match_date,home_team_id,away_team_id,home_score,away_score,competition,stage,neutral,source_url) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(external_id) DO UPDATE SET home_score=excluded.home_score,away_score=excluded.away_score,competition=excluded.competition,stage=excluded.stage,collected_at=CURRENT_TIMESTAMP`).bind(String(ev.id||`${ev.start_time}-${hc}-${ac}`),String(ev.start_time||ev.date||'').slice(0,10),ht.id,at.id,hs,as,competition,stage,0,sourceUrl).run(); inserted++;
 }
 return {inserted,warnings,skipped};
}
const normName=(x:any)=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9가-힣]/g,'');
function rowsFrom(data:AnyObj){
 const d=data?.data;
 if(Array.isArray(d)) return d;
 if(Array.isArray(d?.matches)) return d.matches;
 if(Array.isArray(d?.rankings)) return d.rankings;
 if(Array.isArray(data?.matches)) return data.matches;
 if(Array.isArray(data?.rankings)) return data.rankings;
 return [];
}
async function ingestFootballdataRankings(data:AnyObj,e:Env,sourceUrl:string){
 let inserted=0,warnings=0;
 for(const row of rowsFrom(data)){
  const country=row.country||{}; const ranking=row.ranking||{}; const points=row.points||{}; const period=row.period||{};
  const code=cleanCode(country.iso3||row.iso3||row.country_code||row.team_code||row.code);
  const name=country.name||row.country_name||row.team_name||row.name||code;
  if(!code||!name){warnings++;continue}
  const team=await upsertTeam(e,code,name,row.confederation?.code||row.confederation||'UNK');if(!team){warnings++;continue}
  const release=String(period.ranking_date||period.period_id||row.release_date||row.updated_at||new Date().toISOString()).slice(0,10);
  await e.DB.prepare(`INSERT INTO rankings(team_id,release_date,rank,points,previous_rank,source_url) VALUES(?,?,?,?,?,?) ON CONFLICT(team_id,release_date) DO UPDATE SET rank=excluded.rank,points=excluded.points,previous_rank=excluded.previous_rank,source_url=excluded.source_url,collected_at=CURRENT_TIMESTAMP`).bind(team.id,release,n(ranking.world_rank??row.rank??row.position),n(points.total??row.points),ranking.previous_rank??row.previous_rank??null,sourceUrl).run();inserted++;
 }
 return {inserted,warnings};
}
async function teamNameMap(e:Env){
 const q=await e.DB.prepare('SELECT id,fifa_code,name_en,name_ko FROM teams').all<any>();
 const map=new Map<string,any>();
 for(const t of q.results){for(const name of [t.name_en,t.name_ko,t.fifa_code]){const k=normName(name);if(k)map.set(k,t)}}
 return map;
}
async function ingestFootballdataMatches(data:AnyObj,e:Env,sourceUrl:string){
 let inserted=0,warnings=0,skipped=0; const names=await teamNameMap(e);
 for(const row of rowsFrom(data)){
  const home=row.home_team||row.home||{},away=row.away_team||row.away||{};
  const ht=names.get(normName(home.team_name||home.name)); const at=names.get(normName(away.team_name||away.name));
  if(!ht||!at){skipped++;continue}
  const score=row.score||{};const hs=n(score.home??row.home_score,NaN),as=n(score.away??row.away_score,NaN);
  if(!Number.isFinite(hs)||!Number.isFinite(as)){skipped++;continue}
  const league=row.league||{};
  await e.DB.prepare(`INSERT INTO matches(external_id,match_date,home_team_id,away_team_id,home_score,away_score,competition,stage,neutral,source_url) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(external_id) DO UPDATE SET home_score=excluded.home_score,away_score=excluded.away_score,competition=excluded.competition,stage=excluded.stage,collected_at=CURRENT_TIMESTAMP`).bind(String(row.match_id||row.id||`${row.match_date}-${ht.fifa_code}-${at.fifa_code}`),String(row.match_date||row.date||row.start_time||'').slice(0,10),ht.id,at.id,hs,as,league.competition_name||league.name||row.league_name||'International',row.stage||row.round||null,row.neutral?1:0,sourceUrl).run();inserted++;
 }
 return {inserted,warnings,skipped};
}
async function fetchAllPages(baseUrl:string,e:Env,maxPages=50){
 const out:any[]=[]; let page=1; let meta:any={};
 while(page<=maxPages){
  const url=baseUrl.replace('{page}',String(page)); const data=await fetchJson(url,e); const rows=rowsFrom(data); out.push(...rows); meta=data.meta||meta;
  const totalPages=Number(data.meta?.pagination?.total_pages||data.meta?.total_pages||0);
  if(rows.length===0 || (totalPages&&page>=totalPages) || (!totalPages&&rows.length<100)) break;
  page++;
 }
 return {data:out,meta};
}
async function collectFootballdataRankingHistory(e:Env,info:any){
 const periodsPayload=await fetchAllPages(info.periodsUrl.includes('{page}')?info.periodsUrl:`${info.periodsUrl}&page={page}`,e,10);
 const periods=periodsPayload.data.map((x:any)=>String(x.ranking_date||x.period_id||x.date||'').slice(0,10)).filter(Boolean).sort();
 const floor=yearsAgo(Number(e.DATA_WINDOW_YEARS||4)); const eligible=periods.filter((d:string)=>d>=floor);
 let idx=Number(await stateGet(e,'ranking_period_index')||0); let inserted=0,warnings=0; const messages:string[]=[];
 for(let i=0;i<Math.max(1,Number(info.rankingBackfillPerRun||2))&&idx<eligible.length;i++,idx++){
  const date=eligible[idx]; const url=`https://footballdata.io/api/v1/fifa-rankings?ranking_type=men&date=${date}&limit=100&page={page}`;
  const payload=await fetchAllPages(url,e,5); const r=await ingestFootballdataRankings(payload,e,url.replace('{page}','*')); inserted+=r.inserted;warnings+=r.warnings;messages.push(`ranking ${date}: +${r.inserted}`);
 }
 await stateSet(e,'ranking_period_index',String(idx>=eligible.length?0:idx));
 return {inserted,warnings,messages};
}
async function stateGet(e:Env,key:string){const r=await e.DB.prepare('SELECT value FROM collection_state WHERE key=?').bind(key).first<{value:string}>();return r?.value||null}
async function stateSet(e:Env,key:string,value:string){await e.DB.prepare(`INSERT INTO collection_state(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(key,value).run()}
async function collect(e:Env,opts:{date?:string;rankingOnly?:boolean;matchesOnly?:boolean}={}){
 const id=(await e.DB.prepare("INSERT INTO collection_jobs(job_type,status,message) VALUES('scheduled','running','Provider adapter started') RETURNING id").first<{id:number}>())!.id;
 let inserted=0,warnings=0,skipped=0;const messages:string[]=[]; const info=providerInfo(e) as any;
 try{
  if(!info.hasApiKey) throw new Error(`${info.provider} API key is not configured`);
  if(!opts.matchesOnly){
   if(info.provider==='footballdata'){
    const current=await fetchAllPages(info.rankingUrl.includes('{page}')?info.rankingUrl:`${info.rankingUrl}&page={page}`,e,5);
    const r=await ingestFootballdataRankings(current,e,info.rankingUrl);inserted+=r.inserted;warnings+=r.warnings;messages.push(`current rankings ${r.inserted}`);
    const h=await collectFootballdataRankingHistory(e,info);inserted+=h.inserted;warnings+=h.warnings;messages.push(...h.messages);
   }else{
    const data=await fetchJson(info.rankingUrl,e);const r=await ingestSportradarRankings(data,e,info.rankingUrl);inserted+=r.inserted;warnings+=r.warnings;messages.push(`rankings ${r.inserted}`);
   }
  }
  if(!opts.rankingOnly){
   const floor=yearsAgo(Number(e.DATA_WINDOW_YEARS||4));
   if(info.provider==='footballdata'){
    let from=opts.date||await stateGet(e,'match_backfill_cursor')||floor;
    const fromDate=new Date(`${from}T00:00:00Z`); const span=opts.date?1:Math.max(1,Math.min(31,Number(info.backfillDaysPerRun||31)));
    const toDate=new Date(fromDate);toDate.setUTCDate(toDate.getUTCDate()+span-1); const today=isoDate(new Date()); let to=isoDate(toDate);if(to>today)to=today;
    const base=info.matchTemplate.replace('{from}',from).replace('{to}',to);
    const payload=await fetchAllPages(base,e,50); const r=await ingestFootballdataMatches(payload,e,base.replace('{page}','*'));inserted+=r.inserted;warnings+=r.warnings;skipped+=r.skipped;messages.push(`${from}~${to}: +${r.inserted}/skip${r.skipped}`);
    if(!opts.date){const d=new Date(`${to}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);await stateSet(e,'match_backfill_cursor',isoDate(d)>today?floor:isoDate(d));}
   }else{
    const days=Math.max(1,Math.min(31,Number(e.BACKFILL_DAYS_PER_RUN||7))); let cursor=opts.date||await stateGet(e,'match_backfill_cursor')||floor;
    for(let i=0;i<(opts.date?1:days);i++){if(cursor>isoDate(new Date()))break;const url=info.matchTemplate.replace('{date}',cursor);const data=await fetchJson(url,e);const r=await ingestSportradarMatches(data,e,url);inserted+=r.inserted;warnings+=r.warnings;skipped+=r.skipped;messages.push(`${cursor}: +${r.inserted}/skip${r.skipped}`);const d=new Date(`${cursor}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);cursor=isoDate(d)}
    if(!opts.date)await stateSet(e,'match_backfill_cursor',cursor);
   }
  }
  await e.DB.prepare("UPDATE collection_jobs SET status=?,finished_at=CURRENT_TIMESTAMP,inserted_count=?,warning_count=?,message=? WHERE id=?").bind('success',inserted,warnings,messages.join('; ').slice(0,4000),id).run();
  return {ok:true,id,provider:info.provider,inserted,warnings,skipped,messages,nextCursor:await stateGet(e,'match_backfill_cursor')};
 }catch(err){await e.DB.prepare("UPDATE collection_jobs SET status='failed',finished_at=CURRENT_TIMESTAMP,message=? WHERE id=?").bind(String(err),id).run();throw err}
}
async function csvImport(r:Request,e:Env){
 if(!auth(r,e))return bad('Unauthorized',401);const body=await r.json() as any;if(!Array.isArray(body.rows)||!['teams','rankings','matches'].includes(body.kind))return bad('kind and rows required');
 let nrows=0;for(const x of body.rows){
  if(body.kind==='teams'){await e.DB.prepare(`INSERT INTO teams(fifa_code,name_ko,name_en,confederation,latitude,longitude) VALUES(?,?,?,?,?,?) ON CONFLICT(fifa_code) DO UPDATE SET name_ko=excluded.name_ko,name_en=excluded.name_en,confederation=excluded.confederation,latitude=excluded.latitude,longitude=excluded.longitude,updated_at=CURRENT_TIMESTAMP`).bind(x.fifa_code,x.name_ko||x.name_en,x.name_en,x.confederation,x.latitude||null,x.longitude||null).run();nrows++}
 }
 return {ok:true,inserted:nrows};
}
async function modelRun(r:Request,e:Env){
 if(!auth(r,e))return bad('Unauthorized',401);const b=await r.json() as any;const formula=b.formula||'network ~ edges + mutual + gwesp(0.5, fixed=TRUE)';
 const row=await e.DB.prepare(`INSERT INTO model_runs(model_name,network_type,formula,status) VALUES(?,?,?,'queued') RETURNING id`).bind(b.name||'ERGM Model',b.networkType||'win',formula).first<{id:number}>();
 let dispatched=false;if(e.GITHUB_OWNER&&e.GITHUB_REPO&&e.GITHUB_TOKEN){const res=await fetch(`https://api.github.com/repos/${e.GITHUB_OWNER}/${e.GITHUB_REPO}/dispatches`,{method:'POST',headers:{authorization:`Bearer ${e.GITHUB_TOKEN}`,'accept':'application/vnd.github+json','user-agent':'FIFA-Network-Lab'},body:JSON.stringify({event_type:'run-ergm',client_payload:{run_id:row!.id}})});dispatched=res.ok}
 return {ok:true,runId:row!.id,dispatched,note:dispatched?'GitHub Actions started':'Queued; configure GitHub secrets or run workflow manually'};
}
async function explain(r:Request,e:Env){const b=await r.json() as any;const prompt=`You are a cautious social network analysis assistant. Explain this ERGM result in Korean, clearly separating association from causation. Data: ${JSON.stringify(b).slice(0,10000)}`;try{const out:any=await e.AI.run('@cf/meta/llama-3.1-8b-instruct',{prompt,max_tokens:500});return {ok:true,text:out.response||out.result||String(out)}}catch{return {ok:true,text:'AI 바인딩이 설정되지 않았습니다. 계수의 부호, 유의확률, 수렴 여부와 GOF를 함께 확인하십시오.',fallback:true}}}

export default {async fetch(r:Request,e:Env):Promise<Response>{const u=new URL(r.url);try{
 if(u.pathname==='/api/health')return json({ok:true,app:e.APP_NAME,time:new Date().toISOString(),provider:providerInfo(e)});
 if(u.pathname==='/api/provider')return json(providerInfo(e));
 if(u.pathname==='/api/dashboard')return json(await dashboard(e));if(u.pathname==='/api/network')return json(await network(e,u));if(u.pathname==='/api/rankings')return json(await rankings(e));if(u.pathname==='/api/quality')return json(await quality(e));
 if(u.pathname==='/api/collect'&&r.method==='POST'){if(!auth(r,e))return bad('Unauthorized',401);const b=await r.json().catch(()=>({})) as any;return json(await collect(e,{date:b.date,rankingOnly:b.rankingOnly,matchesOnly:b.matchesOnly}));}
 if(u.pathname==='/api/import'&&r.method==='POST')return json(await csvImport(r,e));if(u.pathname==='/api/models'&&r.method==='POST')return json(await modelRun(r,e));if(u.pathname==='/api/explain'&&r.method==='POST')return json(await explain(r,e));
 if(u.pathname==='/api/export'){const [t,m,ra]=await Promise.all([e.DB.prepare('SELECT * FROM teams').all(),e.DB.prepare('SELECT * FROM matches').all(),e.DB.prepare('SELECT * FROM rankings').all()]);return json({metadata:{exportedAt:new Date().toISOString(),version:'2.0.0',provider:providerInfo(e)},teams:t.results,matches:m.results,rankings:ra.results});}
 if(u.pathname.startsWith('/api/'))return bad('Not found',404);return e.ASSETS.fetch(r);
 }catch(err){return bad(err instanceof Error?err.message:String(err),500)}},async scheduled(_c:ScheduledController,e:Env,ctx:ExecutionContext){ctx.waitUntil(collect(e))}};
