interface Env { DB: D1Database; ASSETS: Fetcher; AI: Ai; APP_NAME: string; DATA_WINDOW_YEARS: string; FIFA_RANKING_URL: string; MATCH_API_URL: string; GITHUB_OWNER: string; GITHUB_REPO: string; GITHUB_TOKEN?: string; ADMIN_TOKEN?: string; }
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store'}});
const bad=(m:string,s=400)=>json({ok:false,error:m},s);
const auth=(r:Request,e:Env)=>!e.ADMIN_TOKEN||r.headers.get('authorization')===`Bearer ${e.ADMIN_TOKEN}`;
async function dashboard(e:Env){
 const [teams,matches,rankings,issues,latest,runs]=await Promise.all([
  e.DB.prepare('SELECT COUNT(*) n FROM teams').first<{n:number}>(),e.DB.prepare('SELECT COUNT(*) n FROM matches').first<{n:number}>(),e.DB.prepare('SELECT COUNT(*) n FROM rankings').first<{n:number}>(),e.DB.prepare('SELECT COUNT(*) n FROM data_quality_issues WHERE resolved=0').first<{n:number}>(),e.DB.prepare('SELECT MAX(collected_at) v FROM rankings').first<{v:string}>(),e.DB.prepare('SELECT * FROM model_runs ORDER BY id DESC LIMIT 5').all()
 ]);
 return {teams:teams?.n||0,matches:matches?.n||0,rankings:rankings?.n||0,issues:issues?.n||0,latest:latest?.v||null,runs:runs.results};
}
async function network(e:Env,url:URL){
 const from=url.searchParams.get('from')||'2022-07-28',to=url.searchParams.get('to')||'2026-07-28',type=url.searchParams.get('type')||'match';
 const rows=await e.DB.prepare(`SELECT m.*,h.fifa_code hcode,h.name_ko hname,h.confederation hconf,a.fifa_code acode,a.name_ko aname,a.confederation aconf FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id WHERE m.match_date BETWEEN ? AND ?`).bind(from,to).all<any>();
 const nodes=new Map<string,any>(), links=new Map<string,any>();
 for(const r of rows.results){ nodes.set(r.hcode,{id:r.hcode,label:r.hname,group:r.hconf});nodes.set(r.acode,{id:r.acode,label:r.aname,group:r.aconf});
  let source=r.hcode,target=r.acode;if(type==='win'){if(r.home_score===r.away_score)continue;if(r.home_score<r.away_score){source=r.acode;target=r.hcode}}
  const key=type==='match'?[source,target].sort().join('|'):`${source}|${target}`;const v=links.get(key)||{source,target,value:0};v.value++;links.set(key,v);
 }
 return {nodes:[...nodes.values()],links:[...links.values()],meta:{from,to,type,matches:rows.results.length}};
}
async function rankings(e:Env){const q=await e.DB.prepare(`SELECT r.release_date,r.rank,r.points,r.previous_rank,t.fifa_code,t.name_ko,t.confederation FROM rankings r JOIN teams t ON t.id=r.team_id ORDER BY r.release_date DESC,r.rank ASC LIMIT 500`).all();return q.results;}
async function quality(e:Env){
 const dup=await e.DB.prepare(`SELECT match_date,home_team_id,away_team_id,COUNT(*) n FROM matches GROUP BY match_date,home_team_id,away_team_id HAVING n>1`).all();
 const invalid=await e.DB.prepare(`SELECT id FROM matches WHERE home_score<0 OR away_score<0 OR home_team_id=away_team_id`).all();
 return {score:Math.max(0,100-dup.results.length*5-invalid.results.length*10),duplicates:dup.results,invalid:invalid.results};
}
async function collect(e:Env){
 const id=(await e.DB.prepare("INSERT INTO collection_jobs(job_type,status,message) VALUES('scheduled','running','Adapter collection started') RETURNING id").first<{id:number}>())!.id;
 let inserted=0,warnings=0;const messages:string[]=[];
 try{
  for(const [kind,endpoint] of [['ranking',e.FIFA_RANKING_URL],['matches',e.MATCH_API_URL]] as const){
   if(!endpoint){warnings++;messages.push(`${kind}: endpoint not configured`);continue}
   const res=await fetch(endpoint,{headers:{'user-agent':'FIFA-Network-Lab/1.0'}});if(!res.ok)throw new Error(`${kind} HTTP ${res.status}`);
   const data:any=await res.json();messages.push(`${kind}: fetched ${Array.isArray(data)?data.length:'JSON'}`);
   // Provider-specific mapping is intentionally isolated. Raw automatic fetch is verified before activation.
  }
  await e.DB.prepare("UPDATE collection_jobs SET status=?,finished_at=CURRENT_TIMESTAMP,inserted_count=?,warning_count=?,message=? WHERE id=?").bind('success',inserted,warnings,messages.join('; '),id).run();
  return {ok:true,id,inserted,warnings,messages};
 }catch(err){await e.DB.prepare("UPDATE collection_jobs SET status='failed',finished_at=CURRENT_TIMESTAMP,message=? WHERE id=?").bind(String(err),id).run();throw err}
}
async function csvImport(r:Request,e:Env){
 if(!auth(r,e))return bad('Unauthorized',401);const body=await r.json() as any;if(!Array.isArray(body.rows)||!['teams','rankings','matches'].includes(body.kind))return bad('kind and rows required');
 let n=0;for(const x of body.rows){
  if(body.kind==='teams'){await e.DB.prepare(`INSERT INTO teams(fifa_code,name_ko,name_en,confederation,latitude,longitude) VALUES(?,?,?,?,?,?) ON CONFLICT(fifa_code) DO UPDATE SET name_ko=excluded.name_ko,name_en=excluded.name_en,confederation=excluded.confederation,latitude=excluded.latitude,longitude=excluded.longitude,updated_at=CURRENT_TIMESTAMP`).bind(x.fifa_code,x.name_ko||x.name_en,x.name_en,x.confederation,x.latitude||null,x.longitude||null).run();n++}
 }
 return {ok:true,inserted:n};
}
async function modelRun(r:Request,e:Env){
 if(!auth(r,e))return bad('Unauthorized',401);const b=await r.json() as any;const formula=b.formula||'network ~ edges + mutual + gwesp(0.5, fixed=TRUE)';
 const row=await e.DB.prepare(`INSERT INTO model_runs(model_name,network_type,formula,status) VALUES(?,?,?,'queued') RETURNING id`).bind(b.name||'ERGM Model',b.networkType||'win',formula).first<{id:number}>();
 let dispatched=false;if(e.GITHUB_OWNER&&e.GITHUB_REPO&&e.GITHUB_TOKEN){const res=await fetch(`https://api.github.com/repos/${e.GITHUB_OWNER}/${e.GITHUB_REPO}/dispatches`,{method:'POST',headers:{authorization:`Bearer ${e.GITHUB_TOKEN}`,'accept':'application/vnd.github+json','user-agent':'FIFA-Network-Lab'},body:JSON.stringify({event_type:'run-ergm',client_payload:{run_id:row!.id}})});dispatched=res.ok}
 return {ok:true,runId:row!.id,dispatched,note:dispatched?'GitHub Actions started':'Queued; configure GitHub secrets or run workflow manually'};
}
async function explain(r:Request,e:Env){const b=await r.json() as any;const prompt=`You are a cautious social network analysis assistant. Explain this ERGM result in Korean, clearly separating association from causation. Data: ${JSON.stringify(b).slice(0,10000)}`;try{const out:any=await e.AI.run('@cf/meta/llama-3.1-8b-instruct',{prompt,max_tokens:500});return {ok:true,text:out.response||out.result||String(out)}}catch{return {ok:true,text:'AI 바인딩이 설정되지 않았습니다. 계수의 부호, 유의확률, 수렴 여부와 GOF를 함께 확인하십시오.',fallback:true}}}
export default {async fetch(r:Request,e:Env):Promise<Response>{const u=new URL(r.url);try{
 if(u.pathname==='/api/health')return json({ok:true,app:e.APP_NAME,time:new Date().toISOString()});
 if(u.pathname==='/api/dashboard')return json(await dashboard(e));if(u.pathname==='/api/network')return json(await network(e,u));if(u.pathname==='/api/rankings')return json(await rankings(e));if(u.pathname==='/api/quality')return json(await quality(e));
 if(u.pathname==='/api/collect'&&r.method==='POST'){if(!auth(r,e))return bad('Unauthorized',401);return json(await collect(e));}
 if(u.pathname==='/api/import'&&r.method==='POST')return json(await csvImport(r,e));if(u.pathname==='/api/models'&&r.method==='POST')return json(await modelRun(r,e));if(u.pathname==='/api/explain'&&r.method==='POST')return json(await explain(r,e));
 if(u.pathname==='/api/export'){const [t,m,ra]=await Promise.all([e.DB.prepare('SELECT * FROM teams').all(),e.DB.prepare('SELECT * FROM matches').all(),e.DB.prepare('SELECT * FROM rankings').all()]);return json({metadata:{exportedAt:new Date().toISOString(),version:'1.0.0'},teams:t.results,matches:m.results,rankings:ra.results});}
 if(u.pathname.startsWith('/api/'))return bad('Not found',404);return e.ASSETS.fetch(r);
 }catch(err){return bad(err instanceof Error?err.message:String(err),500)}},async scheduled(_c:ScheduledController,e:Env,ctx:ExecutionContext){ctx.waitUntil(collect(e))}};
