import {FIFA_MEMBERS} from './fifa-master';
interface Env {
  DB:D1Database; ASSETS:Fetcher; AI:Ai;
  APP_NAME?:string; DATA_WINDOW_YEARS?:string; BATCH_STATEMENTS?:string;
  MATCH_CSV_URL?:string; WORLD_BANK_COUNTRY_URL?:string; WORLD_BANK_GDP_URL?:string;
  WORLD_BANK_POP_URL?:string; FREE_RANKING_CSV_URL?:string; ADMIN_TOKEN?:string;
  LIVE_FIFA_RANKING_URL?:string;
  GITHUB_TOKEN?:string; GITHUB_OWNER?:string; GITHUB_REPO?:string; GITHUB_WORKFLOW_FILE?:string; GITHUB_DISPATCH_MODE?:string; ANALYSIS_API_TOKEN?:string; PUBLIC_BASE_URL?:string;
}
type Obj=Record<string,any>;
type Task={kind:'countries'|'gdp'|'population'|'matches'|'rankings'|'live_ranking'; month?:string; label:string};
const VERSION='17.0.0';
const j=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store'}});
const iso=(d=new Date())=>d.toISOString().slice(0,10);
const auth=(r:Request,e:Env)=>!e.ADMIN_TOKEN||r.headers.get('authorization')===`Bearer ${e.ADMIN_TOKEN}`;
const norm=(s:any)=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').trim();
const code=(s:any)=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
const cfg=(e:Env)=>({
  matchUrl:e.MATCH_CSV_URL||'https://raw.githubusercontent.com/martj42/international_results/master/results.csv',
  countriesUrl:e.WORLD_BANK_COUNTRY_URL||'https://api.worldbank.org/v2/country?format=json&per_page=400',
  gdpUrl:e.WORLD_BANK_GDP_URL||'https://api.worldbank.org/v2/country/all/indicator/NY.GDP.PCAP.CD?format=json&per_page=20000&date=2022:2026',
  popUrl:e.WORLD_BANK_POP_URL||'https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=20000&date=2022:2026',
  rankingUrl:e.FREE_RANKING_CSV_URL||'https://raw.githubusercontent.com/Dato-Futbol/fifa-ranking/refs/heads/master/ranking_fifa_historical.csv',
  // v18: FIFA 공식 사이트가 랭킹 테이블을 렌더링할 때 내부적으로 호출하는 비공개(hidden) JSON API.
  // dateId 파라미터를 생략하면 가장 최근(현재) 공식 발표본을 반환합니다.
  // 참고: https://medium.com/@rico69/scraping-fifa-mens-ranking-with-scrapy-and-hidden-api-7799570b7737
  apiRankingUrl:e.LIVE_FIFA_RANKING_URL||'https://www.fifa.com/api/ranking-overview?locale=en'
});
function parseCSV(text:string){const rows:string[][]=[];let row:string[]=[],cell='',q=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(q){if(c==='"'&&n==='"'){cell+='"';i++}else if(c==='"')q=false;else cell+=c}else if(c==='"')q=true;else if(c===','){row.push(cell);cell=''}else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell=''}else cell+=c}if(cell||row.length){row.push(cell);rows.push(row)}if(!rows.length)return[];const h=rows.shift()!.map(x=>x.trim());return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(h.map((k,i)=>[k,(r[i]??'').trim()])))}
async function fetchText(url:string){const r=await fetch(url,{headers:{accept:'text/csv,application/json;q=0.9,*/*;q=0.8','user-agent':`FIFA-Network-Lab/${VERSION}`}});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status} ${url}: ${t.slice(0,180)}`);return t}
async function fetchJSON(url:string){return JSON.parse(await fetchText(url))}
function months(years:number){const now=new Date(),start=new Date(Date.UTC(now.getUTCFullYear()-years,now.getUTCMonth(),1)),out:string[]=[];for(const d=new Date(start);d<=now;d.setUTCMonth(d.getUTCMonth()+1))out.push(d.toISOString().slice(0,7));return out}
function plan(e:Env){const ms=months(Number(e.DATA_WINDOW_YEARS||4));const tasks:Task[]=[{kind:'countries',label:'국가 메타데이터'},{kind:'gdp',label:'1인당 GDP'},{kind:'population',label:'인구'}];for(const m of ms)tasks.push({kind:'matches',month:m,label:`경기 ${m}`});if(cfg(e).rankingUrl)for(const m of ms)tasks.push({kind:'rankings',month:m,label:`랭킹 ${m}`});if(cfg(e).apiRankingUrl)tasks.push({kind:'live_ranking',label:'최신 FIFA 랭킹(실시간 API)'});return tasks}
async function state(e:Env,key:string,def=''){return (await e.DB.prepare('SELECT value FROM collection_state WHERE key=?').bind(key).first<any>())?.value??def}
async function setState(e:Env,key:string,value:string){await e.DB.prepare(`INSERT INTO collection_state(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(key,value).run()}
function chunk<T>(a:T[],n:number){const out:T[][]=[];for(let i=0;i<a.length;i+=n)out.push(a.slice(i,i+n));return out}
async function batches(e:Env,stmts:D1PreparedStatement[]){const size=Math.max(10,Math.min(100,Number(e.BATCH_STATEMENTS||75)));let calls=0;for(const c of chunk(stmts,size)){await e.DB.batch(c);calls++}return calls}
async function snap(e:Env,name:string,url:string,status:number,count=0,note=''){await e.DB.prepare('INSERT INTO source_snapshots(source_name,source_url,status,row_count,note) VALUES(?,?,?,?,?)').bind(name,url,status,count,note).run()}
async function fifaMaps(e:Env){
  const q=await e.DB.prepare(`SELECT t.id,t.fifa_code,t.name_en,t.name_ko,t.confederation,a.alias FROM teams t LEFT JOIN fifa_aliases a ON a.fifa_code=t.fifa_code WHERE t.is_fifa_member=1 AND t.active=1`).all<any>();
  const byCode=new Map<string,any>(),byAlias=new Map<string,any>();
  for(const x of q.results){byCode.set(code(x.fifa_code),x);byAlias.set(norm(x.name_en),x);byAlias.set(norm(x.name_ko),x);if(x.alias)byAlias.set(norm(x.alias),x)}
  return{byCode,byAlias}
}
async function recordUnmapped(e:Env,names:string[],source:string){
  const clean=[...new Set(names.filter(Boolean).map(String))];
  if(!clean.length)return 0;
  return batches(e,clean.map(n=>e.DB.prepare(`INSERT INTO unmapped_team_names(normalized_name,original_name,source,occurrence_count,last_seen) VALUES(?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(normalized_name) DO UPDATE SET occurrence_count=occurrence_count+1,original_name=excluded.original_name,source=excluded.source,last_seen=CURRENT_TIMESTAMP`).bind(norm(n),n,source)))
}
async function normalizeExistingData(e:Env){
  const canonical=await fifaMaps(e);
  const old=await e.DB.prepare(`SELECT id,fifa_code,name_en,name_ko,is_fifa_member,active FROM teams ORDER BY id`).all<any>();
  let mapped=0,unmapped=0,merged=0,rankingsMoved=0;
  const stmts:D1PreparedStatement[]=[];
  for(const x of old.results){
    const target=canonical.byCode.get(code(x.fifa_code))||canonical.byAlias.get(norm(x.name_en))||canonical.byAlias.get(norm(x.name_ko));
    if(!target){unmapped++;stmts.push(e.DB.prepare(`UPDATE teams SET is_fifa_member=0,active=0 WHERE id=?`).bind(x.id));continue}
    mapped++;
    if(x.id===target.id){stmts.push(e.DB.prepare(`UPDATE teams SET is_fifa_member=1,active=1,confederation=? WHERE id=?`).bind(target.confederation,x.id));continue}
    merged++;
    stmts.push(e.DB.prepare(`UPDATE matches SET home_team_id=? WHERE home_team_id=?`).bind(target.id,x.id));
    stmts.push(e.DB.prepare(`UPDATE matches SET away_team_id=? WHERE away_team_id=?`).bind(target.id,x.id));
    stmts.push(e.DB.prepare(`INSERT INTO rankings(team_id,release_date,rank,points,previous_rank,source_url,source_hash,collected_at) SELECT ?,release_date,rank,points,previous_rank,source_url,source_hash,collected_at FROM rankings WHERE team_id=? ON CONFLICT(team_id,release_date) DO UPDATE SET rank=excluded.rank,points=excluded.points,previous_rank=excluded.previous_rank,source_url=excluded.source_url`).bind(target.id,x.id));
    stmts.push(e.DB.prepare(`DELETE FROM rankings WHERE team_id=?`).bind(x.id));
    stmts.push(e.DB.prepare(`UPDATE teams SET is_fifa_member=0,active=0 WHERE id=?`).bind(x.id));
  }
  const dbCalls=await batches(e,stmts);
  await e.DB.prepare(`DELETE FROM matches WHERE home_team_id=away_team_id`).run();
  await setState(e,'fifa_normalized_at',new Date().toISOString());
  const counts=await e.DB.prepare(`SELECT (SELECT COUNT(*) FROM teams WHERE is_fifa_member=1 AND active=1) members,(SELECT COUNT(*) FROM teams WHERE active=0) excluded,(SELECT COUNT(*) FROM unmapped_team_names) unmapped_names`).first<any>();
  return{ok:true,masterCount:FIFA_MEMBERS.length,mapped,merged,unmapped,rankingsMoved,dbCalls,counts}
}
async function taskCountries(e:Env){
  const u=cfg(e).countriesUrl,d=await fetchJSON(u),rows=(Array.isArray(d?.[1])?d[1]:[]).filter((x:any)=>x?.id&&x.region?.id!=='NA'),maps=await fifaMaps(e),stmts:D1PreparedStatement[]=[];let matched=0;
  for(const x of rows){const t=maps.byAlias.get(norm(x.name));if(!t)continue;matched++;stmts.push(e.DB.prepare(`UPDATE teams SET latitude=?,longitude=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(Number(x.latitude)||null,Number(x.longitude)||null,t.id))}
  const calls=await batches(e,stmts);await snap(e,'world-bank-countries',u,200,matched,`fifa_members_only=1;db_calls=${calls}`);return{inserted:matched,skipped:rows.length-matched,dbCalls:calls,externalCalls:1}
}
async function taskIndicator(e:Env,kind:'gdp'|'population'){
  const u=kind==='gdp'?cfg(e).gdpUrl:cfg(e).popUrl,col=kind==='gdp'?'gdp_per_capita':'population',d=await fetchJSON(u),rows=Array.isArray(d?.[1])?d[1]:[],maps=await fifaMaps(e),seen=new Set<number>(),stmts:D1PreparedStatement[]=[];
  for(const x of rows){if(x.value==null)continue;const t=maps.byAlias.get(norm(x.country?.value))||maps.byCode.get(code(x.countryiso3code));if(!t||seen.has(t.id))continue;seen.add(t.id);stmts.push(e.DB.prepare(`UPDATE teams SET ${col}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(Number(x.value),t.id))}
  const calls=await batches(e,stmts);await snap(e,`world-bank-${col}`,u,200,stmts.length,`fifa_members_only=1;db_calls=${calls}`);return{inserted:stmts.length,dbCalls:calls,externalCalls:1}
}
async function taskMatches(e:Env,month:string){
  const u=cfg(e).matchUrl,rows=parseCSV(await fetchText(u)).filter(r=>String(r.date||'').slice(0,7)===month),maps=await fifaMaps(e),stmts:D1PreparedStatement[]=[];let skip=0;const unmapped:string[]=[];
  for(const r of rows){const h=maps.byAlias.get(norm(r.home_team)),a=maps.byAlias.get(norm(r.away_team)),hs=Number(r.home_score),as=Number(r.away_score);if(!h||!a||!Number.isFinite(hs)||!Number.isFinite(as)){skip++;if(!h)unmapped.push(r.home_team);if(!a)unmapped.push(r.away_team);continue}const id=`martj42:${r.date}:${h.fifa_code}:${a.fifa_code}`;stmts.push(e.DB.prepare(`INSERT INTO matches(external_id,match_date,home_team_id,away_team_id,home_score,away_score,competition,neutral,source_url) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(external_id) DO UPDATE SET home_score=excluded.home_score,away_score=excluded.away_score,competition=excluded.competition,neutral=excluded.neutral,collected_at=CURRENT_TIMESTAMP`).bind(id,r.date,h.id,a.id,hs,as,r.tournament||'International',String(r.neutral).toLowerCase()==='true'?1:0,u))}
  const bc=await batches(e,stmts),uc=await recordUnmapped(e,unmapped,'international-results');await snap(e,'international-results',u,200,stmts.length,`month=${month};skipped=${skip};fifa_members_only=1;db_calls=${bc+uc}`);return{inserted:stmts.length,skipped:skip,unmapped:[...new Set(unmapped)].length,dbCalls:bc+uc,externalCalls:1}
}
async function taskRankings(e:Env,month:string){
  const u=cfg(e).rankingUrl;if(!u)return{inserted:0,skipped:0,dbCalls:0,externalCalls:0,warning:'랭킹 URL 미설정'};const rows=parseCSV(await fetchText(u)).filter(r=>String(r.date||r.rank_date||r.release_date||'').slice(0,7)===month),maps=await fifaMaps(e),group=new Map<string,Obj[]>();for(const r of rows){const date=String(r.date||r.rank_date||r.release_date).slice(0,10);if(!group.has(date))group.set(date,[]);group.get(date)!.push(r)}const stmts:D1PreparedStatement[]=[];let skip=0;const unmapped:string[]=[];
  for(const [date,list] of group){const sorted=[...list].sort((a,b)=>Number(b.total_points||b.points)-Number(a.total_points||a.points));for(let i=0;i<sorted.length;i++){const r=sorted[i],name=r.team||r.country_full||r.country||r.name,cc=code(r.team_short||r.team_code||r.country_abrv||r.country_code||r.iso3||r.code),t=maps.byCode.get(cc)||maps.byAlias.get(norm(name)),points=Number(r.total_points||r.points),rank=Number(r.rank)||i+1;if(!t||!date||!Number.isFinite(points)){skip++;if(!t)unmapped.push(name);continue}stmts.push(e.DB.prepare(`INSERT INTO rankings(team_id,release_date,rank,points,previous_rank,source_url) VALUES(?,?,?,?,?,?) ON CONFLICT(team_id,release_date) DO UPDATE SET rank=excluded.rank,points=excluded.points,previous_rank=excluded.previous_rank,source_url=excluded.source_url,collected_at=CURRENT_TIMESTAMP`).bind(t.id,date,rank,points,Number(r.previous_rank)||null,u))}}
  const bc=await batches(e,stmts),uc=await recordUnmapped(e,unmapped,'ranking-csv');await snap(e,'ranking-csv',u,200,stmts.length,`month=${month};skipped=${skip};fifa_members_only=1;db_calls=${bc+uc}`);return{inserted:stmts.length,skipped:skip,unmapped:[...new Set(unmapped)].length,dbCalls:bc+uc,externalCalls:1}
}
// v18: FIFA 공식 사이트의 비공개 JSON API(예: /api/ranking-overview)에서 반환하는 원시 데이터는
// FIFA가 사전 고지 없이 필드명을 바꿀 수 있습니다. 특정 스키마에 고정하는 대신, 응답 트리 전체를 순회해
// "rank류 필드"와 "국가명/코드류 필드"를 동시에 가진 배열 중 가장 큰 것을 랭킹 테이블로 추정합니다.
function extractRankingRows(json:any):Obj[]{
  const RANK_KEY=/rank/i, NAME_KEY=/name|team|country|association/i, POINT_KEY=/point/i;
  const candidates:Obj[][]=[];
  const seen=new Set<any>();
  (function walk(node:any){
    if(!node||typeof node!=='object'||seen.has(node))return;seen.add(node);
    if(Array.isArray(node)){
      if(node.length>=10&&typeof node[0]==='object'&&node[0]!==null){
        const keys=Object.keys(node[0]);
        const flatKeys=keys.concat(Object.keys((node[0] as any).rankingItem||{})).concat(Object.keys((node[0] as any).team||{}));
        const hasRank=flatKeys.some(k=>RANK_KEY.test(k));
        const hasName=flatKeys.some(k=>NAME_KEY.test(k));
        if(hasRank&&hasName)candidates.push(node as Obj[]);
      }
      for(const v of node)walk(v);
    } else {
      for(const v of Object.values(node))walk(v);
    }
  })(json);
  candidates.sort((a,b)=>b.length-a.length);
  return candidates[0]||[];
}
function pick(obj:Obj,pattern:RegExp):any{
  if(!obj||typeof obj!=='object')return undefined;
  for(const [k,v] of Object.entries(obj)){
    if(pattern.test(k)&&(typeof v==='string'||typeof v==='number'))return v;
  }
  // 한 단계 중첩(rankingItem/team 등)까지만 탐색
  for(const v of Object.values(obj)){
    if(v&&typeof v==='object'&&!Array.isArray(v)){
      for(const [k2,v2] of Object.entries(v)){
        if(pattern.test(k2)&&(typeof v2==='string'||typeof v2==='number'))return v2;
      }
    }
  }
  return undefined;
}
function normalizeLiveRow(raw:Obj,fallbackDate:string){
  const rank=Number(pick(raw,/^rank$|^position$/i));
  const points=Number(pick(raw,/totalpoints|^points$/i));
  const previousPoints=Number(pick(raw,/previouspoints/i));
  const previousRank=Number(pick(raw,/previousrank/i));
  const name=pick(raw,/countryname|teamname|^name$|association/i);
  const abbr=pick(raw,/abbreviation|countrycode|tricode|^code$/i);
  const dateRaw=pick(raw,/^date$|ranking.?date|publishdate/i);
  const date=dateRaw?String(dateRaw).slice(0,10):fallbackDate;
  return{date,team:name,team_short:abbr,rank:Number.isFinite(rank)?rank:undefined,total_points:Number.isFinite(points)?points:previousPoints,previous_rank:Number.isFinite(previousRank)?previousRank:undefined};
}
async function taskLiveRanking(e:Env){
  const u=cfg(e).apiRankingUrl;
  if(!u)return{inserted:0,skipped:0,dbCalls:0,externalCalls:0,warning:'실시간 랭킹 API URL 미설정'};
  const today=iso();
  let json:any;
  try{json=await fetchJSON(u)}
  catch(x){await snap(e,'fifa-live-ranking-api',u,0,0,`fetch_failed:${String(x).slice(0,200)}`);return{inserted:0,skipped:0,dbCalls:0,externalCalls:1,warning:`실시간 랭킹 API 호출 실패: ${String(x).slice(0,160)}`}}
  const rawRows=extractRankingRows(json);
  if(!rawRows.length){await snap(e,'fifa-live-ranking-api',u,200,0,'no_ranking_array_found_check_schema');return{inserted:0,skipped:0,dbCalls:0,externalCalls:1,warning:'API 응답에서 랭킹 배열을 찾지 못했습니다. FIFA가 JSON 구조를 변경했을 수 있으니 스키마를 확인하십시오.'}}
  const rows=rawRows.map(r=>normalizeLiveRow(r,today));
  const maps=await fifaMaps(e),stmts:D1PreparedStatement[]=[];let skip=0;const unmapped:string[]=[];
  const releaseDate=rows.find(r=>r.date)?.date||today;
  for(const r of rows){
    const cc=code(r.team_short),t=maps.byCode.get(cc)||maps.byAlias.get(norm(r.team)),points=Number(r.total_points);
    if(!t||!Number.isFinite(points)){skip++;if(!t)unmapped.push(String(r.team||r.team_short||''));continue}
    stmts.push(e.DB.prepare(`INSERT INTO rankings(team_id,release_date,rank,points,previous_rank,source_url) VALUES(?,?,?,?,?,?) ON CONFLICT(team_id,release_date) DO UPDATE SET rank=excluded.rank,points=excluded.points,previous_rank=excluded.previous_rank,source_url=excluded.source_url,collected_at=CURRENT_TIMESTAMP`).bind(t.id,r.date||releaseDate,Number(r.rank)||0,points,Number(r.previous_rank)||null,u));
  }
  const bc=await batches(e,stmts),uc=await recordUnmapped(e,unmapped,'fifa-live-ranking-api');
  await snap(e,'fifa-live-ranking-api',u,200,stmts.length,`release_date=${releaseDate};skipped=${skip};fifa_members_only=1;db_calls=${bc+uc}`);
  return{inserted:stmts.length,skipped:skip,unmapped:[...new Set(unmapped)].length,dbCalls:bc+uc,externalCalls:1,releaseDate}
}
async function importRows(r:Request,e:Env){const b=await r.json() as any,rows=Array.isArray(b.rows)?b.rows:[],maps=await fifaMaps(e),stmts:D1PreparedStatement[]=[];let skipped=0;if(b.kind==='rankings'){for(const x of rows){const t=maps.byCode.get(code(x.fifa_code||x.code))||maps.byAlias.get(norm(x.name||x.country));if(!t){skipped++;continue}stmts.push(e.DB.prepare(`INSERT INTO rankings(team_id,release_date,rank,points,previous_rank,source_url) VALUES(?,?,?,?,?,?) ON CONFLICT(team_id,release_date) DO UPDATE SET rank=excluded.rank,points=excluded.points,previous_rank=excluded.previous_rank`).bind(t.id,x.release_date||x.date,Number(x.rank),Number(x.points),Number(x.previous_rank)||null,'manual-upload'))}}await batches(e,stmts);return{ok:true,inserted:stmts.length,skipped}}

async function progress(e:Env){const tasks=plan(e),cursor=Math.max(0,Number(await state(e,'v6_cursor','0'))||0),done=Math.min(cursor,tasks.length),next=tasks[done]||null;return{version:VERSION,total:tasks.length,completed:done,remaining:Math.max(0,tasks.length-done),percent:tasks.length?Math.round(done/tasks.length*100):100,next,finished:done>=tasks.length,windowMonths:months(Number(e.DATA_WINDOW_YEARS||4)).length,limitStrategy:'one task per invocation; batched D1 statements'}}
async function collectOne(e:Env,reset=false){if(reset)await setState(e,'v6_cursor','0');const tasks=plan(e),cursor=Math.max(0,Number(await state(e,'v6_cursor','0'))||0);if(cursor>=tasks.length)return{ok:true,finished:true,progress:await progress(e),message:'최근 4년 배치 수집이 완료되었습니다.'};const task=tasks[cursor],jid=(await e.DB.prepare(`INSERT INTO collection_jobs(job_type,status,message) VALUES('v6_batch','running',?) RETURNING id`).bind(task.label).first<any>())?.id;try{let result:any;if(task.kind==='countries')result=await taskCountries(e);else if(task.kind==='gdp'||task.kind==='population')result=await taskIndicator(e,task.kind);else if(task.kind==='matches')result=await taskMatches(e,task.month!);else if(task.kind==='live_ranking')result=await taskLiveRanking(e);else result=await taskRankings(e,task.month!);await setState(e,'v6_cursor',String(cursor+1));await e.DB.prepare(`UPDATE collection_jobs SET status='success',finished_at=CURRENT_TIMESTAMP,inserted_count=?,warning_count=?,message=? WHERE id=?`).bind(result.inserted||0,result.warning?1:0,JSON.stringify({task,...result}),jid).run();return{ok:true,task,index:cursor+1,...result,progress:await progress(e)}}catch(x){await e.DB.prepare(`UPDATE collection_jobs SET status='failed',finished_at=CURRENT_TIMESTAMP,message=? WHERE id=?`).bind(String(x),jid).run();throw x}}
async function dashboard(e:Env){
  const normalizedAt=await state(e,'fifa_normalized_at','');
  if(!normalizedAt)await normalizeExistingData(e);
  const one=async(s:string)=>(await e.DB.prepare(s).first<any>())||{};
  const [t,raw,m,r,i,runs,jobs,p,unmapped]=await Promise.all([
    one('SELECT COUNT(*) n FROM teams WHERE is_fifa_member=1 AND active=1'),
    one('SELECT COUNT(*) n FROM teams'),
    one('SELECT COUNT(*) n FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE h.is_fifa_member=1 AND h.active=1 AND a.is_fifa_member=1 AND a.active=1'),
    one('SELECT COUNT(*) n FROM rankings r JOIN teams t ON t.id=r.team_id WHERE t.is_fifa_member=1 AND t.active=1'),
    one('SELECT COUNT(*) n FROM data_quality_issues WHERE resolved=0'),
    e.DB.prepare('SELECT * FROM model_runs ORDER BY id DESC LIMIT 5').all(),
    e.DB.prepare('SELECT * FROM collection_jobs ORDER BY id DESC LIMIT 5').all(),progress(e),
    one('SELECT COUNT(*) n FROM unmapped_team_names')
  ]);
  return{teams:Number(t.n||0),rawTeams:Number(raw.n||0),excludedTeams:Math.max(0,Number(raw.n||0)-Number(t.n||0)),unmappedNames:Number(unmapped.n||0),matches:Number(m.n||0),rankings:Number(r.n||0),issues:Number(i.n||0),runs:runs.results,jobs:jobs.results,provider:cfg(e),progress:p,normalization:{masterCount:FIFA_MEMBERS.length,normalizedAt:(await state(e,'fifa_normalized_at',''))||null}}
}
async function network(e:Env,u:URL){
  const from=u.searchParams.get('from')||months(Number(e.DATA_WINDOW_YEARS||4))[0]+'-01',to=u.searchParams.get('to')||iso(),type=u.searchParams.get('type')||'match';
  const [members,q]=await Promise.all([
    e.DB.prepare(`SELECT fifa_code,name_en,confederation FROM teams WHERE is_fifa_member=1 AND active=1 ORDER BY fifa_code`).all<any>(),
    e.DB.prepare(`SELECT m.*,h.fifa_code hcode,h.name_en hname,h.confederation hconf,a.fifa_code acode,a.name_en aname,a.confederation aconf FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE m.match_date BETWEEN ? AND ? AND h.is_fifa_member=1 AND h.active=1 AND a.is_fifa_member=1 AND a.active=1`).bind(from,to).all<any>()
  ]);
  const ns=new Map<string,any>(),ls=new Map<string,any>();
  // FIFA 211개 회원국을 먼저 등록하여 분석기간 중 경기가 없는 국가도 고립 노드로 보존한다.
  for(const t of members.results)ns.set(t.fifa_code,{id:t.fifa_code,label:t.name_en,group:t.confederation,isolate:true});
  for(const r of q.results){
    ns.set(r.hcode,{id:r.hcode,label:r.hname,group:r.hconf,isolate:false});
    ns.set(r.acode,{id:r.acode,label:r.aname,group:r.aconf,isolate:false});
    let s=r.hcode,t=r.acode;
    if(type==='win'){if(r.home_score===r.away_score)continue;if(r.home_score<r.away_score)[s,t]=[t,s]}
    const k=type==='match'?[s,t].sort().join('|'):`${s}|${t}`,x=ls.get(k)||{source:s,target:t,value:0};x.value++;ls.set(k,x)
  }
  const incident=new Set<string>();for(const l of ls.values()){incident.add(l.source);incident.add(l.target)}
  for(const n of ns.values())n.isolate=!incident.has(n.id);
  return{nodes:[...ns.values()],links:[...ls.values()],meta:{from,to,type,matches:q.results.length,memberCount:members.results.length,isolateCount:[...ns.values()].filter((x:any)=>x.isolate).length}}
}
async function quality(e:Env){
  const [members,rawTeams,memberMatches,invalid,excluded,duplicateSummary,latestRanking,matchedTeams,dateRange] = await Promise.all([
    e.DB.prepare('SELECT COUNT(*) n FROM teams WHERE is_fifa_member=1 AND active=1').first<any>(),
    e.DB.prepare('SELECT COUNT(*) n FROM teams').first<any>(),
    e.DB.prepare(`SELECT COUNT(*) n FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE h.is_fifa_member=1 AND h.active=1 AND a.is_fifa_member=1 AND a.active=1`).first<any>(),
    e.DB.prepare(`SELECT COUNT(*) n FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE h.is_fifa_member=1 AND h.active=1 AND a.is_fifa_member=1 AND a.active=1 AND (m.home_score<0 OR m.away_score<0 OR m.home_team_id=m.away_team_id OR m.match_date IS NULL OR length(m.match_date)<10)`).first<any>(),
    e.DB.prepare(`SELECT COUNT(*) n FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE h.is_fifa_member=0 OR a.is_fifa_member=0 OR h.active=0 OR a.active=0`).first<any>(),
    e.DB.prepare(`SELECT COUNT(*) groups_count,COALESCE(SUM(n-1),0) extra_rows FROM (SELECT COUNT(*) n FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE h.is_fifa_member=1 AND h.active=1 AND a.is_fifa_member=1 AND a.active=1 GROUP BY m.match_date,m.home_team_id,m.away_team_id,m.home_score,m.away_score,COALESCE(m.competition,''),m.neutral HAVING COUNT(*)>1)`).first<any>(),
    e.DB.prepare(`WITH coverage AS (SELECT r.release_date,COUNT(DISTINCT r.team_id) covered FROM rankings r JOIN teams t ON t.id=r.team_id WHERE t.is_fifa_member=1 AND t.active=1 GROUP BY r.release_date), chosen AS (SELECT release_date,covered FROM coverage ORDER BY CASE WHEN covered>=190 THEN 1 ELSE 0 END DESC,CASE WHEN covered>=190 THEN release_date END DESC,covered DESC,release_date DESC LIMIT 1) SELECT release_date,covered FROM chosen`).first<any>(),
    e.DB.prepare(`SELECT COUNT(DISTINCT team_id) n FROM (SELECT m.home_team_id team_id FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE h.is_fifa_member=1 AND h.active=1 AND a.is_fifa_member=1 AND a.active=1 UNION SELECT m.away_team_id FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE h.is_fifa_member=1 AND h.active=1 AND a.is_fifa_member=1 AND a.active=1)`).first<any>(),
    e.DB.prepare(`SELECT MIN(m.match_date) min_date,MAX(m.match_date) max_date FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE h.is_fifa_member=1 AND h.active=1 AND a.is_fifa_member=1 AND a.active=1`).first<any>()
  ]);
  const memberCount=Number(members?.n||0),matchCount=Number(memberMatches?.n||0),invalidCount=Number(invalid?.n||0);
  const latestCoverage=Number(latestRanking?.covered||0),matchedCount=Number(matchedTeams?.n||0);
  const pct=(n:number,d:number)=>d>0?Math.max(0,Math.min(100,n/d*100)):0;
  const normalizationPct=pct(memberCount,211),validityPct=matchCount?pct(matchCount-invalidCount,matchCount):0;
  const rankingPct=pct(latestCoverage,211),matchCoveragePct=pct(matchedCount,211),consistencyPct=100;
  let recencyPct=0;
  if(dateRange?.max_date){const days=Math.max(0,(Date.now()-new Date(`${dateRange.max_date}T00:00:00Z`).getTime())/86400000);recencyPct=days<=90?100:days<=180?80:days<=365?60:40}
  const dimensions=[
    {key:'normalization',label:'FIFA 회원국 정규화',weight:20,percent:normalizationPct,detail:`${memberCount}/211개 회원국`},
    {key:'validity',label:'경기 유효성',weight:25,percent:validityPct,detail:`유효 ${Math.max(0,matchCount-invalidCount).toLocaleString()} / ${matchCount.toLocaleString()}건`},
    {key:'rankingCoverage',label:'최신 랭킹 완전성',weight:20,percent:rankingPct,detail:`${latestCoverage}/211개국 · ${latestRanking?.release_date||'발표일 없음'}`},
    {key:'matchCoverage',label:'경기 네트워크 포괄성',weight:15,percent:matchCoveragePct,detail:`최근 분석기간 경기 보유 ${matchedCount}/211개국`},
    {key:'consistency',label:'중복·일관성 관리',weight:10,percent:consistencyPct,detail:`중복 후보 ${Number(duplicateSummary?.extra_rows||0).toLocaleString()}건은 집계·이진화 처리`},
    {key:'recency',label:'자료 최신성',weight:10,percent:recencyPct,detail:`최근 경기 ${dateRange?.max_date||'없음'}`}
  ].map(x=>({...x,score:Number((x.weight*x.percent/100).toFixed(1)),status:x.percent>=95?'excellent':x.percent>=80?'good':x.percent>=60?'warning':'poor'}));
  const score=Number(dimensions.reduce((a,x)=>a+x.score,0).toFixed(1));
  const grade=score>=95?'Excellent':score>=85?'Good':score>=70?'Fair':'Needs review';
  return{score,grade,methodology:'가중 품질지수: 정규화 20, 유효성 25, 최신 랭킹 완전성 20, 경기 포괄성 15, 중복·일관성 10, 최신성 10',dimensions,counts:{fifaMembers:memberCount,rawTeams:Number(rawTeams?.n||0),memberMatches:matchCount,invalid:invalidCount,excludedNonMemberMatches:Number(excluded?.n||0),duplicateGroups:Number(duplicateSummary?.groups_count||0),duplicateCandidatesHandled:Number(duplicateSummary?.extra_rows||0),latestRankingTeams:latestCoverage,matchedTeams:matchedCount},dateRange:{from:dateRange?.min_date||null,to:dateRange?.max_date||null},notes:['중복 후보는 원자료 재수집 및 국가명 통합 과정에서 발생할 수 있으며 품질 감점 대신 분석 단계에서 관계 집계 대상으로 관리합니다.','비회원 경기는 자동 제외된 정상 처리 건수이며 오류로 보지 않습니다.']}
}

async function modelValidation(e:Env,networkType='win'){
  const [tc,mc,rc,invalid,dated] = await Promise.all([
    e.DB.prepare('SELECT COUNT(*) n FROM teams WHERE is_fifa_member=1 AND active=1').first<any>(),
    e.DB.prepare('SELECT COUNT(*) n FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE h.is_fifa_member=1 AND h.active=1 AND a.is_fifa_member=1 AND a.active=1').first<any>(),
    e.DB.prepare('SELECT COUNT(*) n FROM rankings r JOIN teams t ON t.id=r.team_id WHERE t.is_fifa_member=1 AND t.active=1').first<any>(),
    e.DB.prepare('SELECT COUNT(*) n FROM matches WHERE home_team_id=away_team_id OR home_score<0 OR away_score<0').first<any>(),
    e.DB.prepare("SELECT MIN(match_date) min_date,MAX(match_date) max_date FROM matches").first<any>()
  ]);
  const teams=Number(tc?.n||0),matches=Number(mc?.n||0),rankings=Number(rc?.n||0),invalidMatches=Number(invalid?.n||0);
  let usableEdges=matches;
  if(networkType==='win'){
    const x=await e.DB.prepare('SELECT COUNT(*) n FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE m.home_score<>m.away_score AND m.home_team_id<>m.away_team_id AND h.is_fifa_member=1 AND h.active=1 AND a.is_fifa_member=1 AND a.active=1').first<any>();
    usableEdges=Number(x?.n||0);
  }
  const warnings:string[]=[];
  const errors:string[]=[];
  if(teams<2)errors.push('국가 데이터가 2개 미만입니다.');
  if(matches<1)errors.push('경기 데이터가 없습니다. 데이터 수집을 먼저 실행하십시오.');
  if(usableEdges<1)errors.push(networkType==='win'?'승패가 결정된 경기가 없어 승리 네트워크를 만들 수 없습니다.':'사용 가능한 경기 관계가 없습니다.');
  if(teams<30)warnings.push('국가 수가 30개 미만이라 ERGM 결과가 불안정할 수 있습니다.');
  if(usableEdges<100)warnings.push('사용 가능한 엣지가 100개 미만입니다. 논문 분석 전 추가 수집을 권장합니다.');
  if(rankings===0)warnings.push('랭킹 데이터가 없어 ranking_points 효과는 0으로 대체됩니다.');
  if(invalidMatches>0)warnings.push(`무효 경기 ${invalidMatches}건이 분석에서 제외될 수 있습니다.`);
  return {ok:errors.length===0,networkType,counts:{teams,matches,rankings,usableEdges,invalidMatches},dateRange:{from:dated?.min_date||null,to:dated?.max_date||null},errors,warnings,recommendation:errors.length?'데이터 수집·품질검사를 완료한 뒤 다시 실행하십시오.':warnings.length?'기본모형(edges)부터 실행한 뒤 효과를 단계적으로 추가하십시오.':'분석 실행 조건을 충족합니다.'};
}
const analysisAuth=(r:Request,e:Env)=>Boolean(e.ANALYSIS_API_TOKEN)&&r.headers.get('authorization')===`Bearer ${e.ANALYSIS_API_TOKEN}`;
const githubHeaders=(e:Env)=>({authorization:`Bearer ${e.GITHUB_TOKEN||''}`,accept:'application/vnd.github+json','content-type':'application/json','user-agent':'fifa-network-lab','x-github-api-version':'2022-11-28'});
async function githubDiagnostics(e:Env){
  const owner=(e.GITHUB_OWNER||'').trim(),repo=(e.GITHUB_REPO||'').trim(),workflow=(e.GITHUB_WORKFLOW_FILE||'analyze.yml').trim();
  const configured=Boolean(e.GITHUB_TOKEN&&owner&&repo);
  const out:any={version:VERSION,configured,owner,repo,workflow,dispatchMode:e.GITHUB_DISPATCH_MODE||'auto',tokenPresent:Boolean(e.GITHUB_TOKEN),checks:[]};
  if(!configured){out.ok=false;out.recommendation='GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO를 모두 설정하십시오.';return out}
  const checks=[
    ['authenticated-user','https://api.github.com/user'],
    ['repository',`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`],
    ['workflow',`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}`]
  ];
  for(const [name,url] of checks){try{const r=await fetch(url,{headers:githubHeaders(e)});const text=await r.text();let body:any;try{body=JSON.parse(text)}catch{body=text.slice(0,300)}out.checks.push({name,url,status:r.status,ok:r.ok,login:body?.login,fullName:body?.full_name,defaultBranch:body?.default_branch,workflowName:body?.name,message:body?.message})}catch(x){out.checks.push({name,url,ok:false,error:String(x)})}}
  out.ok=out.checks.every((x:any)=>x.ok);
  const repoCheck=out.checks.find((x:any)=>x.name==='repository'),wfCheck=out.checks.find((x:any)=>x.name==='workflow');
  if(repoCheck?.status===404)out.recommendation=`토큰이 ${owner}/${repo} 저장소에 접근하지 못합니다. Fine-grained PAT의 Resource owner와 Repository access, Contents 및 Actions 쓰기 권한을 확인하십시오.`;
  else if(wfCheck?.status===404)out.recommendation='.github/workflows/analyze.yml이 기본 브랜치에 있는지 확인하십시오.';
  else if(out.ok)out.recommendation='GitHub 저장소와 워크플로 접근이 정상입니다. 모형 실행을 다시 시도하십시오.';
  return out
}
async function triggerGithub(e:Env,runId:number){
  if(!e.GITHUB_TOKEN||!e.GITHUB_OWNER||!e.GITHUB_REPO)throw new Error('GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO 설정이 필요합니다.');
  const owner=e.GITHUB_OWNER.trim(),repo=e.GITHUB_REPO.trim(),configured=(e.GITHUB_DISPATCH_MODE||'auto').trim();
  const workflow=(e.GITHUB_WORKFLOW_FILE||'analyze.yml').trim();
  const modes=configured==='auto'?['repository_dispatch','workflow_dispatch']:[configured];
  const failures:string[]=[];
  for(const mode of modes){
    let url:string,body:any;
    if(mode==='workflow_dispatch'){
      url=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
      body={ref:'main',inputs:{run_id:String(runId)}};
    }else{
      url=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/dispatches`;
      body={event_type:'run-ergm',client_payload:{run_id:String(runId),base_url:e.PUBLIC_BASE_URL||'',analysis_mode:'both'}};
    }
    const response=await fetch(url,{method:'POST',headers:githubHeaders(e),body:JSON.stringify(body)});
    const detail=await response.text();
    if(response.ok)return{ok:true,status:response.status,target:`${owner}/${repo}`,mode,url};
    failures.push(`${mode}: HTTP ${response.status} ${detail.slice(0,300)}`);
    if(configured!=='auto')break;
  }
  throw new Error(`GitHub dispatch 실패 · target=${owner}/${repo} · ${failures.join(' | ')}`);
}


async function advancedAnalytics(e:Env,u:URL){
  const from=u.searchParams.get('from')||months(Number(e.DATA_WINDOW_YEARS||4))[0]+'-01',to=u.searchParams.get('to')||iso(),type=u.searchParams.get('type')||'win';
  const data=await network(e,new URL(`/api/network?from=${from}&to=${to}&type=${type}`,'https://local'));
  const nodes=data.nodes||[],links=data.links||[],ids=nodes.map((n:any)=>n.id),index=new Map(ids.map((id:string,i:number)=>[id,i]));
  const out=Array(ids.length).fill(0),inc=Array(ids.length).fill(0),adj=Array.from({length:ids.length},()=>new Set<number>());
  for(const l of links){const a=index.get(l.source),b=index.get(l.target);if(a===undefined||b===undefined)continue;out[a]+=Number(l.value||1);inc[b]+=Number(l.value||1);adj[a].add(b);adj[b].add(a)}
  let pr=Array(ids.length).fill(ids.length?1/ids.length:0);const damping=.85;
  for(let k=0;k<30;k++){const next=Array(ids.length).fill(ids.length?(1-damping)/ids.length:0);for(let i=0;i<ids.length;i++){const targets=[...adj[i]];if(!targets.length)continue;for(const j of targets)next[j]+=damping*pr[i]/targets.length}pr=next}
  const component=Array(ids.length).fill(-1);let cid=0;for(let i=0;i<ids.length;i++){if(component[i]>=0)continue;const q=[i];component[i]=cid;while(q.length){const x=q.shift()!;for(const y of adj[x])if(component[y]<0){component[y]=cid;q.push(y)}}cid++}
  const rows=nodes.map((n:any,i:number)=>({code:n.id,name:n.label,confederation:n.group,outDegree:out[i],inDegree:inc[i],totalDegree:out[i]+inc[i],pageRank:Number(pr[i].toFixed(6)),community:component[i]+1})).sort((a:any,b:any)=>b.pageRank-a.pageRank);
  const conf:any={};for(const r of rows){conf[r.confederation]??={nodes:0,totalDegree:0};conf[r.confederation].nodes++;conf[r.confederation].totalDegree+=r.totalDegree}
  return{meta:{from,to,type,nodeCount:nodes.length,edgeCount:links.length,communities:cid},top:rows.slice(0,25),all:rows,confederations:Object.entries(conf).map(([name,v]:any)=>({name,...v,averageDegree:Number((v.totalDegree/v.nodes).toFixed(2))}))}
}
async function modelComparison(e:Env){
  const q=await e.DB.prepare(`SELECT id,model_name,network_type,formula,status,aic,bic,converged,created_at,finished_at,result_json,diagnostics_json FROM model_runs ORDER BY id DESC LIMIT 100`).all<any>();
  const rows=q.results.map((x:any)=>{let result:any={},diag:any={};try{result=JSON.parse(x.result_json||'{}')}catch{}try{diag=JSON.parse(x.diagnostics_json||'{}')}catch{}return{id:x.id,name:x.model_name,networkType:x.network_type,formula:x.formula,status:x.status,aic:x.aic,bic:x.bic,converged:Boolean(x.converged),createdAt:x.created_at,finishedAt:x.finished_at,fallbackUsed:Boolean(result.fallback_used),usedFormula:result.used_formula||x.formula,error:diag.error||null}});
  const completed=rows.filter((x:any)=>x.status==='completed'&&Number.isFinite(Number(x.aic))).sort((a:any,b:any)=>Number(a.aic)-Number(b.aic));
  return{count:rows.length,best:completed[0]||null,completed,rows}
}
async function reproducibilityPackage(e:Env){
  const [health,comparison,fifa,p]=await Promise.all([systemHealth(e),modelComparison(e),e.DB.prepare(`SELECT COUNT(*) members FROM fifa_members WHERE active=1`).first<any>(),progress(e)]);
  return{manifest:{title:'FIFA Network Lab Reproducibility Package',version:VERSION,generatedAt:new Date().toISOString(),dataWindowYears:Number(e.DATA_WINDOW_YEARS||4),fifaMembers:Number(fifa?.members||0),software:{cloudflareWorkers:true,d1:true,githubActions:true,rStatnet:true}},health,collection:p,modelComparison:comparison,sourceUrls:cfg(e),recommendedCitation:'FIFA Network Lab v12, reproducibility package generated by the platform.',files:['/api/export','r-analysis/run_ergm.R','.github/workflows/analyze.yml','migrations/']}
}
function deterministicInterpretation(model:any){
  const status=model?.status||'unknown',aic=model?.aic,bic=model?.bic,conv=Boolean(model?.converged);let result:any={headline:'분석 결과 해설',status,summary:'모형 결과가 아직 완료되지 않았습니다.',cautions:[]};
  if(status==='completed'){result.summary=`모형은 ${conv?'수렴한 것으로 기록':'수렴 여부를 추가 확인해야 하는 상태'}이며 AIC ${aic??'-'}, BIC ${bic??'-'}입니다.`;result.cautions.push('계수의 방향·유의확률·MCMC 및 GOF를 함께 확인하십시오.');if(model?.formula?.includes('gwesp'))result.cautions.push('GWESP 포함 모형은 퇴화 가능성을 점검하고 단순모형과 비교하십시오.')}else result.cautions.push('GitHub Actions 완료 후 다시 조회하십시오.');return result
}



function escXml(value:any){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&apos;')}
async function datasetCounts(e:Env){return await e.DB.prepare(`SELECT
 (SELECT COUNT(*) FROM teams WHERE is_fifa_member=1 AND active=1) teams,
 (SELECT COUNT(*) FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE h.is_fifa_member=1 AND h.active=1 AND a.is_fifa_member=1 AND a.active=1) matches,
 (SELECT COUNT(*) FROM rankings r JOIN teams t ON t.id=r.team_id WHERE t.is_fifa_member=1 AND t.active=1) rankings,
 (SELECT MIN(match_date) FROM matches) min_date,
 (SELECT MAX(match_date) FROM matches) max_date`).first<any>()}
async function sha256(text:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function freezeDataset(e:Env,name='Research Dataset',projectId:number|null=null){
 const counts=await datasetCounts(e),sources=cfg(e),payload={version:VERSION,counts,sources,generatedAt:new Date().toISOString(),windowYears:Number(e.DATA_WINDOW_YEARS||4)};
 const checksum=await sha256(JSON.stringify(payload));
 const x=await e.DB.prepare(`INSERT INTO dataset_snapshots(project_id,snapshot_name,app_version,data_start,data_end,team_count,match_count,ranking_count,source_json,checksum_sha256,status) VALUES(?,?,?,?,?,?,?,?,?,?,'frozen') RETURNING id,created_at`).bind(projectId,name,VERSION,counts?.min_date||null,counts?.max_date||null,Number(counts?.teams||0),Number(counts?.matches||0),Number(counts?.rankings||0),JSON.stringify(sources),checksum).first<any>();
 return{ok:true,id:x?.id,createdAt:x?.created_at,name,checksum,counts,sources,version:VERSION}
}
async function temporalNetwork(e:Env,u:URL){
 const type=u.searchParams.get('type')||'win';
 const fromYear=Number(u.searchParams.get('fromYear')||new Date().getUTCFullYear()-Number(e.DATA_WINDOW_YEARS||4));
 const toYear=Number(u.searchParams.get('toYear')||new Date().getUTCFullYear());
 const rows=[] as any[];
 for(let y=fromYear;y<=toYear;y++){
  const n=await network(e,new URL(`/api/network?from=${y}-01-01&to=${y}-12-31&type=${type}`,'https://local'));
  const nodeCount=n.nodes.length,edgeCount=n.links.length,maxEdges=type==='match'?nodeCount*(nodeCount-1)/2:nodeCount*(nodeCount-1);
  rows.push({year:y,nodeCount,edgeCount,matchCount:n.meta.matches,density:maxEdges?Number((edgeCount/maxEdges).toFixed(6)):0,averageDegree:nodeCount?Number(((type==='match'?2:1)*edgeCount/nodeCount).toFixed(3)):0});
 }
 return{type,fromYear,toYear,series:rows,note:'연도별 반복단면 네트워크로 TERGM/STERGM 사전 준비에 활용하십시오.'}
}
async function graphExport(e:Env,u:URL,format:'graphml'|'gexf'){
 const data=await network(e,u),directed=(u.searchParams.get('type')||'win')!=='match';
 if(format==='graphml'){
  const nodes=data.nodes.map((n:any)=>`<node id="${escXml(n.id)}"><data key="label">${escXml(n.label)}</data><data key="confederation">${escXml(n.group)}</data></node>`).join('');
  const edges=data.links.map((x:any,i:number)=>`<edge id="e${i}" source="${escXml(x.source)}" target="${escXml(x.target)}"><data key="weight">${Number(x.value||1)}</data></edge>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><graphml xmlns="http://graphml.graphdrawing.org/xmlns"><key id="label" for="node" attr.name="label" attr.type="string"/><key id="confederation" for="node" attr.name="confederation" attr.type="string"/><key id="weight" for="edge" attr.name="weight" attr.type="double"/><graph id="fifa" edgedefault="${directed?'directed':'undirected'}">${nodes}${edges}</graph></graphml>`,{headers:{'content-type':'application/graphml+xml;charset=utf-8','content-disposition':'attachment; filename="fifa-network.graphml"'}})
 }
 const nodes=data.nodes.map((n:any)=>`<node id="${escXml(n.id)}" label="${escXml(n.label)}"><attvalues><attvalue for="confederation" value="${escXml(n.group)}"/></attvalues></node>`).join('');
 const edges=data.links.map((x:any,i:number)=>`<edge id="${i}" source="${escXml(x.source)}" target="${escXml(x.target)}" weight="${Number(x.value||1)}"/>`).join('');
 return new Response(`<?xml version="1.0" encoding="UTF-8"?><gexf xmlns="http://gexf.net/1.3" version="1.3"><graph mode="static" defaultedgetype="${directed?'directed':'undirected'}"><attributes class="node"><attribute id="confederation" title="confederation" type="string"/></attributes><nodes>${nodes}</nodes><edges>${edges}</edges></graph></gexf>`,{headers:{'content-type':'application/gexf+xml;charset=utf-8','content-disposition':'attachment; filename="fifa-network.gexf"'}})
}
function citationText(format:string){
 const year=new Date().getUTCFullYear(),url='https://fifa-network-lab.junewoopark16.workers.dev';
 if(format==='ris')return `TY  - COMP\nTI  - FIFA Network Lab: Reproducible ERGM Research Platform\nPY  - ${year}\nUR  - ${url}\nET  - ${VERSION}\nER  -`;
 if(format==='apa')return `FIFA Network Lab. (${year}). FIFA Network Lab: Reproducible ERGM Research Platform (Version ${VERSION}) [Computer software]. ${url}`;
 return `@software{fifa_network_lab_${year},\n  title={FIFA Network Lab: Reproducible ERGM Research Platform},\n  year={${year}},\n  version={${VERSION}},\n  url={${url}},\n  note={Cloudflare Workers, D1, GitHub Actions, and R/statnet}\n}`
}
async function listProjects(e:Env){const q=await e.DB.prepare(`SELECT p.*,(SELECT COUNT(*) FROM dataset_snapshots s WHERE s.project_id=p.id) snapshot_count,(SELECT COUNT(*) FROM model_runs m WHERE m.project_id=p.id) model_count FROM research_projects p ORDER BY p.updated_at DESC,p.id DESC`).all<any>();return q.results}
async function createProject(r:Request,e:Env){const b=await r.json().catch(()=>({})) as any;const x=await e.DB.prepare(`INSERT INTO research_projects(project_name,research_question,network_type,analysis_start,analysis_end,status,notes) VALUES(?,?,?,?,?,'active',?) RETURNING *`).bind(b.name||'새 연구 프로젝트',b.researchQuestion||'',b.networkType||'win',b.analysisStart||null,b.analysisEnd||null,b.notes||'').first<any>();return x}
async function reproducibilityReport(e:Env){
 const [base,counts,projects,snaps]=await Promise.all([reproducibilityPackage(e),datasetCounts(e),listProjects(e),e.DB.prepare('SELECT * FROM dataset_snapshots ORDER BY id DESC LIMIT 20').all<any>()]);
 return{...base,report:{generatedAt:new Date().toISOString(),appVersion:VERSION,dataCounts:counts,projects,latestSnapshots:snaps.results,environment:{runtime:'Cloudflare Workers',database:'Cloudflare D1',analysisRunner:'GitHub Actions',statistics:'R/statnet ergm'},auditChecklist:['FIFA 211개 회원국 정규화','데이터 출처 URL 기록','분석기간 고정','dataset checksum 생성','R seed 및 sessionInfo 보존','MCMC/GOF 검토','요청식과 실제 성공식 구분']}}
}

async function systemHealth(e:Env){
  const started=Date.now();
  const configuredSources=Object.values(cfg(e)).filter((url:any)=>typeof url==='string'&&url.startsWith('http')).length;
  const githubConfigured=Boolean(e.GITHUB_TOKEN&&e.GITHUB_OWNER&&e.GITHUB_REPO);
  try{
    const db=await e.DB.prepare('SELECT 1 ok').first<any>();
    const counts=await e.DB.prepare('SELECT (SELECT COUNT(*) FROM teams WHERE is_fifa_member=1 AND active=1) teams,(SELECT COUNT(*) FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE h.is_fifa_member=1 AND h.active=1 AND a.is_fifa_member=1 AND a.active=1) matches,(SELECT COUNT(*) FROM rankings r JOIN teams t ON t.id=r.team_id WHERE t.is_fifa_member=1 AND t.active=1) rankings').first<any>();
    return {ok:Boolean(db?.ok),status:'normal',app:e.APP_NAME||'FIFA Network Lab',version:VERSION,time:new Date().toISOString(),latencyMs:Date.now()-started,db:true,configuredSources,githubConfigured,counts:{teams:Number(counts?.teams||0),matches:Number(counts?.matches||0),rankings:Number(counts?.rankings||0)}};
  }catch(x){
    return {ok:false,status:'error',app:e.APP_NAME||'FIFA Network Lab',version:VERSION,time:new Date().toISOString(),latencyMs:Date.now()-started,db:false,configuredSources,githubConfigured,error:x instanceof Error?x.message:String(x)};
  }
}
export default {
 async fetch(r:Request,e:Env){try{const u=new URL(r.url),p=u.pathname;if(p==='/api/health'){const h=await systemHealth(e);return j(h,h.ok?200:503)};if(p==='/api/provider')return j({provider:'free-open-sources-v11-fifa211',...cfg(e),progress:await progress(e),apiKeyRequired:false});if(p==='/api/provider/test'){const c=cfg(e),tests=[];for(const [name,url] of Object.entries(c)){if(typeof url!=='string'||!url.startsWith('http'))continue;try{const res=await fetch(url,{headers:{Range:'bytes=0-128'}});tests.push({name,url,ok:res.ok,status:res.status})}catch(x){tests.push({name,url,ok:false,error:String(x)})}}return j({ok:tests.every((x:any)=>x.ok),results:tests})}if(p==='/api/dashboard')return j(await dashboard(e));if(p==='/api/temporal-network')return j(await temporalNetwork(e,u));if(p==='/api/export/graphml')return await graphExport(e,u,'graphml');if(p==='/api/export/gexf')return await graphExport(e,u,'gexf');if(p==='/api/citation'){const f=u.searchParams.get('format')||'bibtex';return new Response(citationText(f),{headers:{'content-type':'text/plain;charset=utf-8','content-disposition':`attachment; filename="fifa-network-lab.${f==='ris'?'ris':f==='apa'?'txt':'bib'}"`}})}if(p==='/api/projects'&&r.method==='GET')return j(await listProjects(e));if(p==='/api/projects'&&r.method==='POST'){if(!auth(r,e))return j({error:'unauthorized'},401);return j(await createProject(r,e),201)}if(p==='/api/dataset-freeze'&&r.method==='POST'){if(!auth(r,e))return j({error:'unauthorized'},401);const b=await r.json().catch(()=>({})) as any;return j(await freezeDataset(e,b.name||'Research Dataset',b.projectId?Number(b.projectId):null),201)}if(p==='/api/reproducibility-report')return j(await reproducibilityReport(e));if(p==='/api/analytics')return j(await advancedAnalytics(e,u));if(p==='/api/model-comparison')return j(await modelComparison(e));if(p==='/api/reproducibility')return j(await reproducibilityPackage(e));if(p==='/api/interpret'){const id=Number(u.searchParams.get('id')||0);const x=id?await e.DB.prepare('SELECT * FROM model_runs WHERE id=?').bind(id).first<any>():await e.DB.prepare('SELECT * FROM model_runs ORDER BY id DESC LIMIT 1').first<any>();return j(deterministicInterpretation(x||{}))};if(p==='/api/progress')return j(await progress(e));if(p==='/api/network')return j(await network(e,u));if(p==='/api/rankings'){const q=await e.DB.prepare(`WITH coverage AS (SELECT r.release_date,COUNT(DISTINCT r.team_id) covered FROM rankings r JOIN teams t ON t.id=r.team_id WHERE t.is_fifa_member=1 AND t.active=1 GROUP BY r.release_date), chosen AS (SELECT release_date,covered FROM coverage ORDER BY CASE WHEN covered>=190 THEN 1 ELSE 0 END DESC,CASE WHEN covered>=190 THEN release_date END DESC,covered DESC,release_date DESC LIMIT 1) SELECT r.release_date,r.rank,r.points,r.previous_rank,t.fifa_code,t.name_ko,t.name_en,t.confederation,c.covered snapshot_coverage FROM rankings r JOIN teams t ON t.id=r.team_id JOIN chosen c ON c.release_date=r.release_date WHERE t.is_fifa_member=1 AND t.active=1 ORDER BY r.rank,t.fifa_code LIMIT 211`).all();return j(q.results)}if(p==='/api/quality')return j(await quality(e));if(p==='/api/github/diagnostics')return j(await githubDiagnostics(e));if(p==='/api/model-validation'){return j(await modelValidation(e,u.searchParams.get('type')||'win'))};if(p==='/api/fifa-members'){const q=await e.DB.prepare('SELECT fifa_code,official_name,confederation,active FROM fifa_members ORDER BY confederation,official_name').all();return j({count:q.results.length,members:q.results})};if(p==='/api/fifa-status'){const x=await e.DB.prepare(`SELECT (SELECT COUNT(*) FROM fifa_members WHERE active=1) master,(SELECT COUNT(*) FROM teams WHERE is_fifa_member=1 AND active=1) activeMembers,(SELECT COUNT(*) FROM teams) rawTeams,(SELECT COUNT(*) FROM unmapped_team_names) unmapped`).first<any>();return j({...x,normalizedAt:await state(e,'fifa_normalized_at','')||null,ok:Number(x?.activeMembers||0)===211})};if(p==='/api/fifa-normalize'&&r.method==='POST'){if(!auth(r,e))return j({error:'unauthorized'},401);return j(await normalizeExistingData(e))};if(p==='/api/unmapped-teams'){const q=await e.DB.prepare('SELECT * FROM unmapped_team_names ORDER BY occurrence_count DESC,last_seen DESC LIMIT 500').all();return j(q.results)};if(p==='/api/collect'&&r.method==='POST'){if(!auth(r,e))return j({error:'unauthorized'},401);const b=await r.json().catch(()=>({})) as any;return j(await collectOne(e,Boolean(b.reset)))}if(p==='/api/collect-live-ranking'&&r.method==='POST'){if(!auth(r,e))return j({error:'unauthorized'},401);return j(await taskLiveRanking(e))}if(p==='/api/import'&&r.method==='POST'){if(!auth(r,e))return j({error:'unauthorized'},401);return j(await importRows(r,e))}if(p==='/api/export'){const [t,m,rr]=await Promise.all([e.DB.prepare('SELECT * FROM teams WHERE is_fifa_member=1 AND active=1').all(),e.DB.prepare('SELECT m.* FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE h.is_fifa_member=1 AND h.active=1 AND a.is_fifa_member=1 AND a.active=1').all(),e.DB.prepare('SELECT r.* FROM rankings r JOIN teams t ON t.id=r.team_id WHERE t.is_fifa_member=1 AND t.active=1').all()]);return j({metadata:{generated_at:new Date().toISOString(),version:VERSION,sources:cfg(e),progress:await progress(e)},teams:t.results,matches:m.results,rankings:rr.results})}if(p==='/api/models'&&r.method==='GET'){const id=Number(u.searchParams.get('id')||0);if(id){const x=await e.DB.prepare('SELECT * FROM model_runs WHERE id=?').bind(id).first<any>();return x?j(x):j({error:'model run not found'},404)}const q=await e.DB.prepare('SELECT * FROM model_runs ORDER BY id DESC LIMIT 50').all();return j(q.results)}
if(p==='/api/models'&&r.method==='POST'){if(!auth(r,e))return j({error:'unauthorized'},401);const b=await r.json() as any,networkType=b.networkType||'win',validation=await modelValidation(e,networkType);if(!validation.ok)return j({ok:false,status:'validation_failed',error:'ERGM 실행 전 데이터 검증에 실패했습니다.',validation},422);const x=await e.DB.prepare(`INSERT INTO model_runs(model_name,network_type,formula,status,diagnostics_json) VALUES(?,?,?,'queued',?) RETURNING id`).bind(b.name||'ERGM',networkType,b.formula||'network ~ edges',JSON.stringify({preflight:validation})).first<any>();if(!x?.id)return j({error:'모형 요청 저장 실패'},500);try{const dispatch=await triggerGithub(e,x.id);await e.DB.prepare(`UPDATE model_runs SET status='dispatched' WHERE id=?`).bind(x.id).run();return j({ok:true,runId:x.id,status:'dispatched',note:'사전검증을 통과하여 GitHub Actions R 분석을 요청했습니다.',dispatch,validation})}catch(err){await e.DB.prepare(`UPDATE model_runs SET status='dispatch_failed',diagnostics_json=? WHERE id=?`).bind(JSON.stringify({preflight:validation,error:String(err)}),x.id).run();return j({ok:false,runId:x.id,status:'dispatch_failed',error:err instanceof Error?err.message:String(err),validation},502)}}
if(p==='/api/model-input'&&r.method==='GET'){if(!analysisAuth(r,e))return j({error:'unauthorized'},401);const runId=Number(u.searchParams.get('run_id'));const run=await e.DB.prepare('SELECT * FROM model_runs WHERE id=?').bind(runId).first<any>();if(!run)return j({error:'model run not found'},404);await e.DB.prepare(`UPDATE model_runs SET status='running',started_at=CURRENT_TIMESTAMP WHERE id=?`).bind(runId).run();const [teams,matches,rankings]=await Promise.all([e.DB.prepare('SELECT * FROM teams WHERE is_fifa_member=1 AND active=1 ORDER BY id').all(),e.DB.prepare('SELECT m.* FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE h.is_fifa_member=1 AND h.active=1 AND a.is_fifa_member=1 AND a.active=1 ORDER BY m.match_date,m.id').all(),e.DB.prepare('SELECT r.* FROM rankings r JOIN (SELECT team_id,MAX(release_date) d FROM rankings GROUP BY team_id) z ON z.team_id=r.team_id AND z.d=r.release_date JOIN teams t ON t.id=r.team_id WHERE t.is_fifa_member=1 AND t.active=1').all()]);return j({run,teams:teams.results,matches:matches.results,rankings:rankings.results,validation:await modelValidation(e,run.network_type),metadata:{version:VERSION,generated_at:new Date().toISOString()}})}
if(p==='/api/model-results'&&r.method==='POST'){if(!analysisAuth(r,e))return j({error:'unauthorized'},401);const b=await r.json() as any,runId=Number(b.run_id);if(!runId)return j({error:'run_id required'},400);await e.DB.prepare(`UPDATE model_runs SET status=?,finished_at=CURRENT_TIMESTAMP,aic=?,bic=?,converged=?,result_json=?,diagnostics_json=? WHERE id=?`).bind(b.status||'completed',b.aic??null,b.bic??null,b.converged?1:0,JSON.stringify(b.result||{}),JSON.stringify(b.diagnostics||{}),runId).run();return j({ok:true,runId})}
if(p==='/api/temporal-results'&&r.method==='GET'){const id=Number(u.searchParams.get('run_id')||0);if(id){const x=await e.DB.prepare('SELECT * FROM temporal_model_results WHERE model_run_id=?').bind(id).first<any>();return x?j(x):j({error:'temporal result not found'},404)}const q=await e.DB.prepare('SELECT * FROM temporal_model_results ORDER BY id DESC LIMIT 50').all();return j(q.results)}
if(p==='/api/temporal-results'&&r.method==='POST'){if(!analysisAuth(r,e))return j({error:'unauthorized'},401);const b=await r.json() as any,runId=Number(b.run_id);if(!runId)return j({error:'run_id required'},400);const result=b.result||{},years=Array.isArray(result.years)?result.years.map(Number).filter(Number.isFinite):[];await e.DB.prepare(`INSERT INTO temporal_model_results(model_run_id,status,model_class,panel_count,start_year,end_year,aic,bic,converged,result_json,diagnostics_json,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(model_run_id) DO UPDATE SET status=excluded.status,model_class=excluded.model_class,panel_count=excluded.panel_count,start_year=excluded.start_year,end_year=excluded.end_year,aic=excluded.aic,bic=excluded.bic,converged=excluded.converged,result_json=excluded.result_json,diagnostics_json=excluded.diagnostics_json,finished_at=CURRENT_TIMESTAMP`).bind(runId,b.status||'completed',result.model_class||'TERGM-CMLE',Number(result.panel_count||0)||null,years.length?Math.min(...years):null,years.length?Math.max(...years):null,b.aic??null,b.bic??null,b.converged?1:0,JSON.stringify(result),JSON.stringify(b.diagnostics||{})).run();return j({ok:true,runId,status:b.status||'completed'})}
return e.ASSETS.fetch(r)}catch(x){return j({ok:false,error:x instanceof Error?x.message:String(x)},500)}},
 async scheduled(_c:ScheduledController,e:Env){const done=await state(e,'fifa_normalized_at','');if(!done)await normalizeExistingData(e);else await collectOne(e)}
};
