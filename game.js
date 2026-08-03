(() => {
"use strict";
const ui=id=>document.getElementById(id),canvas=ui("game");
const ctx=canvas?.getContext("2d",{alpha:false})||canvas?.getContext("2d");
if(!canvas||!ctx)throw new Error("Canvas 2D를 초기화할 수 없습니다.");
const WORLD=KOMSCO.WORLD,PATH=KOMSCO.PathEngine,SYS=KOMSCO.GameSystems;
const CHARS=SYS.characters,SEEDS=SYS.seeds,CHAR_BASE="./public/assets/characters/";
const DAY="./public/assets/world/world_day.png",NIGHT="./public/assets/world/world_exact_map.png";
const DPR=Math.min(devicePixelRatio||1, innerWidth<900?1.35:1.75);
let W=0,H=0,bgRect={x:0,y:0,w:1,h:1},bgDay,bgNight,last=performance.now(),selected=null,started=false,autoPath=[],currentEdge=null,lastUiUpdate=0,lastPetTick=0,lastDisturbanceTick=0,lastThreatTick=0,lastCarSpawnTick=0,lastLuckyHourCheck=0,lastGoldenCropTick=0,resizeSettleTimer=null;
const images={},keys={};
// Analog movement input from the floating pointer-driven virtual joystick (touch drag on mobile,
// mouse drag on PC). x/y range roughly -1..1; magnitude reflects how far the drag is from center.
const joystickVec={x:0,y:0};
// Smoothing state for natural acceleration/deceleration and turning, applied to manual movement
// (autoPath movement is left as-is since it already eases into/out of each waypoint on its own).
let smoothDX=0,smoothDY=0,moveAccel=0;
let state=SYS.newState();

const isDay=()=>{const h=new Date().getHours();return h>=5&&h<19};
const activeBg=()=>isDay()?bgDay:bgNight;
function applyUiScale(){
 // Auto-shrinks HUD/AUTO-button/interact chrome to fit small mobile screens instead of overflowing them.
 // Reference size = a comfortable small-phone landscape viewport; never scales UP past 1 on large screens.
 const REF_W=760,REF_H=380,MIN_SCALE=.62;
 const isPortrait=matchMedia("(orientation:portrait)").matches;
 // #gameShell is CSS-rotated 90deg in portrait, so the effective on-screen landscape viewport
 // is innerHeight x innerWidth (swapped), not innerWidth x innerHeight.
 const vw=isPortrait?innerHeight:innerWidth, vh=isPortrait?innerWidth:innerHeight;
 const scale=Math.max(MIN_SCALE,Math.min(1,vw/REF_W,vh/REF_H));
 document.documentElement.style.setProperty("--ui-scale",scale.toFixed(3));
}
function resize(){
 // Most reliable cross-browser viewport measurement -- dvh/dvw support is inconsistent across
 // Android WebView variants (Samsung Internet/Edge lag behind Chrome here), so we compute our
 // own from innerWidth/innerHeight and drive the portrait auto-rotate sizing from these instead.
 document.documentElement.style.setProperty("--vh",(innerHeight*0.01)+"px");
 document.documentElement.style.setProperty("--vw",(innerWidth*0.01)+"px");
 applyUiScale();
 const shell=ui("gameShell");
 const isPortrait=matchMedia("(orientation:portrait)").matches;
 if(isPortrait){
   // #gameShell is CSS-rotated 90deg to render landscape-side-up without a physical rotation;
   // its rotated bounding box reports physical (portrait) dimensions, so swap them back here.
   W=Math.max(320,Math.round(innerHeight||1280));
   H=Math.max(180,Math.round(innerWidth||720));
 }else{
   const r=shell.getBoundingClientRect();
   W=Math.max(320,Math.round(r.width||innerWidth||1280));
   H=Math.max(180,Math.round(r.height||innerHeight||720));
 }
 canvas.width=Math.max(1,Math.round(W*DPR));
 canvas.height=Math.max(1,Math.round(H*DPR));canvas.style.width=W+"px";canvas.style.height=H+"px";ctx.setTransform(DPR,0,0,DPR,0,0);updateBgRect();rebuildRouteCache();
 // Expose the game's logical (post-rotation) dimensions for CSS that needs to size itself
 // correctly regardless of physical device orientation -- raw vw/vh units and orientation-based
 // media queries both reference the PHYSICAL viewport, which is wrong once #gameShell is
 // CSS-rotated 90deg for the portrait auto-landscape trick.
 const root=document.documentElement;
 root.style.setProperty("--game-w",W+"px");
 root.style.setProperty("--game-h",H+"px");
 root.classList.toggle("compact-w",W<900);
 root.classList.toggle("compact-h",H<420);
}
function updateBgRect(){bgRect={x:0,y:0,w:W,h:H};}
const w2s=(x,y)=>({x:bgRect.x+x/100*bgRect.w,y:bgRect.y+y/100*bgRect.h});
// Converts a world-space direction (tx,ty; doesn't need to be unit length) into a world-space
// step whose ON-SCREEN PIXEL length is speed*dt, regardless of direction. See note above.
function worldStep(tx,ty,speed,dt){
 const kx=(bgRect.w||1)/100,ky=(bgRect.h||1)/100;
 const pixelLen=Math.hypot(tx*kx,ty*ky)||1;
 const scale=kx*speed*dt/pixelLen;
 return{x:tx*scale,y:ty*scale};
}
function loadImage(src){
 return new Promise(resolve=>{
   const im=new Image();
   im.decoding="async";
   im.onload=()=>resolve(im);
   im.onerror=()=>resolve(null);
   im.src=src;
 });
}
function edgeProjection(edge,x,y){
 const [a,b]=edge,A=WORLD.nodes[a],B=WORLD.nodes[b];
 const vx=B[0]-A[0],vy=B[1]-A[1],den=vx*vx+vy*vy;
 const t=den?Math.max(0,Math.min(1,((x-A[0])*vx+(y-A[1])*vy)/den)):0;
 return{x:A[0]+t*vx,y:A[1]+t*vy,t,vx,vy,length:Math.sqrt(den)};
}
function edgeKey(edge){return edge?`${edge[0]}|${edge[1]}`:""}
function connectedEdges(nodeId){return WORLD.edges.filter(([a,b])=>a===nodeId||b===nodeId)}
function edgeInfo(edge,x=state.player.x,y=state.player.y){
 const q=edgeProjection(edge,x,y),len=Math.hypot(q.vx,q.vy)||1;
 return{...q,tx:q.vx/len,ty:q.vy/len};
}
function nearestEdge(){return PATH.nearestRoad(WORLD,state.player.x,state.player.y).edge}
function chooseEdgeAtNode(nodeId,inputX,inputY,previousEdge){
 const node=WORLD.nodes[nodeId];let best=null,bestScore=-Infinity;
 for(const edge of connectedEdges(nodeId)){
   const other=edge[0]===nodeId?edge[1]:edge[0],target=WORLD.nodes[other];
   const vx=target[0]-node[0],vy=target[1]-node[1],len=Math.hypot(vx,vy)||1;
   const penalty=previousEdge&&edgeKey(edge)===edgeKey(previousEdge)?.08:0;
   const score=inputX*(vx/len)+inputY*(vy/len)-penalty;
   if(score>bestScore){bestScore=score;best=edge}
 }
 return bestScore>.08?best:null;
}
function moveOnRoute(dx,dy,dt,speedMul=1){
 const magnitude=Math.hypot(dx,dy);if(magnitude<.05)return;
 dx/=magnitude;dy/=magnitude;
 if(!currentEdge)currentEdge=nearestEdge();
 if(!currentEdge)return;

 // Junction detection uses an ABSOLUTE world-distance radius, not a percentage of the current
 // edge's length. A percentage-based zone gives a much narrower (and easier to overshoot past)
 // window on shorter road segments than on longer ones -- which is exactly why some locations
 // could feel randomly harder to walk into than others depending on which road leads there.
 // A fixed radius feels the same everywhere on the map.
 const CAPTURE_RADIUS=2.2,SNAP_RADIUS=.08;
 function tryBranch(){
   const [a,b]=currentEdge,A=WORLD.nodes[a],B=WORLD.nodes[b];
   const distA=Math.hypot(state.player.x-A[0],state.player.y-A[1]);
   const distB=Math.hypot(state.player.x-B[0],state.player.y-B[1]);
   if(distA<=CAPTURE_RADIUS||distB<=CAPTURE_RADIUS){
     const nodeId=distA<=distB?a:b;
     const next=chooseEdgeAtNode(nodeId,dx,dy,currentEdge);
     if(next&&edgeKey(next)!==edgeKey(currentEdge))currentEdge=next;
   }
 }
 tryBranch();

 const info=edgeInfo(currentEdge);
 const sign=(dx*info.tx+dy*info.ty)>=0?1:-1;
 const speed=state.player.speed*CHARS[state.character].speed*speedMul;
 const step=worldStep(info.tx*sign,info.ty*sign,speed,dt);
 const projected=edgeProjection(currentEdge,info.x+step.x,info.y+step.y);
 const moved=Math.hypot(projected.x-state.player.x,projected.y-state.player.y);
 state.stats.distanceTraveled+=moved;
 state.player.x=projected.x;state.player.y=projected.y;
 const desired=info.tx*sign<0?-1:1;
 state.player.dirLerp=(state.player.dirLerp??state.player.dir??1)+(desired-(state.player.dirLerp??state.player.dir??1))*Math.min(1,dt*9);
 state.player.dir=state.player.dirLerp<0?-1:1;

 tryBranch(); // re-check after moving too, so a fresh arrival within the radius this frame still gets a chance to branch

 const [a,b]=currentEdge,A=WORLD.nodes[a],B=WORLD.nodes[b];
 const distA=Math.hypot(state.player.x-A[0],state.player.y-A[1]);
 const distB=Math.hypot(state.player.x-B[0],state.player.y-B[1]);
 if(distA<=SNAP_RADIUS){state.player.x=A[0];state.player.y=A[1]}
 else if(distB<=SNAP_RADIUS){state.player.x=B[0];state.player.y=B[1]}
}
function draw(){
 const fallback=ctx.createLinearGradient(0,0,0,H);
 fallback.addColorStop(0,"#071c33");fallback.addColorStop(1,"#020711");
 ctx.fillStyle=fallback;ctx.fillRect(0,0,W,H);
 const im=activeBg();
 if(im){updateBgRect();ctx.drawImage(im,bgRect.x,bgRect.y,bgRect.w,bgRect.h)}
 drawGuides();drawHotspots();drawCrops();drawFarmDecor();drawCars();drawPlayer();
 drawWeatherOverlay();
}
let routeScreenCache=[];
function rebuildRouteCache(){
 routeScreenCache=PATH.validEdges(WORLD).map(([a,b])=>({
   a,b,A:w2s(...WORLD.nodes[a]),B:w2s(...WORLD.nodes[b])
 }));
}
function drawGuides(){
  // Guide lines removed per request — the background art already shows the roads clearly.
}
// Hysteresis for hotspot proximity: entering requires crossing h.r, but once "inside" the
// same hotspot, exiting requires stepping back out past h.r*1.18. Without this, a player
// standing almost exactly on the boundary (very common right when arriving via AUTO or
// walking manually into a hotspot) would flip in/out of range from a single pixel of
// jitter, which is what caused the glow/color/interactionHint to visibly flicker.
let nearHotspotIdx=-1;
function isNearHotspot(h,idx){
  const dist=Math.hypot(state.player.x-h.x,state.player.y-h.y);
  return dist < (idx===nearHotspotIdx ? h.r*1.18 : h.r);
}
function drawHotspots(){
  const t=performance.now()/1000;
  WORLD.hotspots.forEach((h,idx)=>{
    const p=w2s(h.x,h.y);
    const near=isNearHotspot(h,idx);
    const pulse=Math.sin(t*3)*1.5;
    const threat=state.institutionThreats[h.node];
    const threatActive=threat&&gameNow()<threat.expiresAt;
    ctx.save();
    ctx.fillStyle=threatActive?"rgba(255,60,60,.22)":near?"rgba(255,230,96,.20)":"rgba(255,255,255,.035)";
    ctx.strokeStyle=threatActive?"#ff4444":near?"#ffe878":h.color;
    ctx.shadowColor=ctx.strokeStyle;
    ctx.shadowBlur=threatActive?26:near?22:13;
    ctx.lineWidth=threatActive?5:near?4:2.5;
    ctx.beginPath();
    ctx.ellipse(p.x,p.y,25+pulse,10+pulse*.25,0,0,Math.PI*2);
    ctx.fill();ctx.stroke();ctx.restore();
    if(threatActive){
      const tt=SYS.threatTypes[threat.type];
      if(tt){
        ctx.save();
        ctx.font="22px serif";ctx.textAlign="center";ctx.textBaseline="middle";
        ctx.shadowColor="rgba(255,60,60,.9)";ctx.shadowBlur=12;
        ctx.fillText(tt.icon,p.x,p.y-24-Math.abs(pulse));
        ctx.restore();
      }
    }
  });
}
function drawCrops(){
  const plots=WORLD.farmPlots||[];
  state.farm.forEach((f,i)=>{
    if(!f.seed||!plots[i])return;
    const pos=plots[i];
    const p=w2s(pos[0],pos[1]);
    const {growth}=plotGrowth(i);
    const size=(24+growth*10)*0.97*0.7; // 기존 3% 축소에 이어 추가로 30% 축소
    const stageEmoji=growth>=1?(SEEDS[f.seed]?.emoji||"🌱"):growth<0.34?"🌱":growth<0.7?"🌿":(SEEDS[f.seed]?.emoji||"🌱");
    // 새싹 단계부터 눈에 잘 띄도록, 모든 성장 단계에서 부드러운 원형 배경(halo)을 밭 중심(땅
    // 높이)에 먼저 깔아줌
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x,p.y,size*0.62,0,Math.PI*2);
    ctx.fillStyle=growth>=1?"rgba(255,214,102,.28)":"rgba(255,255,255,.22)";
    ctx.fill();
    ctx.restore();
    // 성장 진행률 표시: 새싹 바로 아래(땅 높이 기준)에 아주 작은 막대바로 표시
    if(growth<1){
      const barW=size*1.1,barH=2.6,barX=p.x-barW/2,barY=p.y+4;
      ctx.save();
      ctx.fillStyle="rgba(0,0,0,.45)";
      ctx.fillRect(barX,barY,barW,barH);
      ctx.fillStyle="rgba(120,255,160,.95)";
      ctx.fillRect(barX,barY,barW*growth,barH);
      ctx.restore();
    }
    ctx.save();
    ctx.font=`${size}px serif`;
    ctx.textAlign="center";
    // 자라는 중(growth<1)일 때는 줄기 '밑동'이 밭 중심(땅 높이)에 오도록 바닥 기준으로 정렬해
    // 위로 자라나는 모습이 되고, 다 자란 뒤(growth>=1)에는 열매가 중심에 앉은 모습이 되도록
    // 가운데 기준으로 정렬 (사용자가 다 자란 상태 위치는 그대로 좋다고 확인함)
    ctx.textBaseline=growth>=1?"middle":"bottom";
    ctx.shadowColor=growth>=1?"rgba(255,224,102,.95)":"rgba(58,255,126,.9)";
    ctx.shadowBlur=growth>=1?14:10;
    ctx.fillText(stageEmoji,p.x,p.y);
    ctx.restore();
    if(growth>=1){
      ctx.save();
      ctx.font="12px serif";
      ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.fillText("✨",p.x+size*0.55,p.y-size*0.55);
      ctx.restore();
    }
  });
  if(state.goldenCrop&&gameNow()<state.goldenCrop.expiresAt&&plots[state.goldenCrop.plotIdx]){
    const pos=plots[state.goldenCrop.plotIdx];
    const p=w2s(pos[0],pos[1]);
    const pulse=1+Math.sin(performance.now()/200)*0.15; // 눈에 띄도록 살짝 맥동하는 효과
    ctx.save();
    ctx.font=`${Math.round(26*pulse)}px serif`;
    ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.shadowColor="rgba(255,209,102,1)";
    ctx.shadowBlur=20;
    ctx.fillText("✨🌟✨",p.x,p.y);
    ctx.restore();
  }
}

let petWander=null,lastPetFrameTime=0;
function updatePetWander(bounds){
 const now=Date.now();
 const dt=lastPetFrameTime?Math.min(0.08,(now-lastPetFrameTime)/1000):0;
 lastPetFrameTime=now;
 if(!petWander){
   const cx=(bounds.minX+bounds.maxX)/2,cy=(bounds.minY+bounds.maxY)/2;
   petWander={x:cx,y:cy,fromX:cx,fromY:cy,tx:cx,ty:cy,curveX:cx,curveY:cy,t:1,duration:1,pausedUntil:now+1000,facingLeft:false,walking:false};
 }
 const p=petWander;
 if(p.t>=1){
   if(now<p.pausedUntil){p.walking=false;return p}
   // 쉬는 시간이 끝나면 새로운 목표 지점과, 완전한 직선이 아니라 살짝 휘어지는 경로(2차
   // 베지어 곡선)를 정해서 다시 걷기 시작 -- 매번 속도도 조금씩 다르게 해서 기계적으로
   // 반복되는 느낌을 줄임
   p.fromX=p.x;p.fromY=p.y;
   p.tx=bounds.minX+Math.random()*(bounds.maxX-bounds.minX);
   p.ty=bounds.minY+Math.random()*(bounds.maxY-bounds.minY);
   const midX=(p.fromX+p.tx)/2,midY=(p.fromY+p.ty)/2;
   const dx=p.tx-p.fromX,dy=p.ty-p.fromY,len=Math.hypot(dx,dy)||1;
   const curveAmt=(Math.random()-0.5)*len*0.35;
   p.curveX=midX+(-dy/len)*curveAmt;
   p.curveY=midY+(dx/len)*curveAmt;
   p.duration=Math.max(0.6,len/(2.6+Math.random()*1.3));
   p.t=0;
 }
 p.t=Math.min(1,p.t+dt/p.duration);
 const eased=p.t<0.5?2*p.t*p.t:1-Math.pow(-2*p.t+2,2)/2; // ease-in-out: 출발/도착 시 자연스러운 가감속
 const omt=1-eased;
 const newX=omt*omt*p.fromX+2*omt*eased*p.curveX+eased*eased*p.tx;
 const newY=omt*omt*p.fromY+2*omt*eased*p.curveY+eased*eased*p.ty;
 p.facingLeft=(newX-p.x)<-0.001;
 p.x=newX;p.y=newY;
 p.walking=true;
 if(p.t>=1)p.pausedUntil=now+700+Math.random()*1600;
 return p;
}
function drawFarmDecor(){
 const plots=WORLD.farmPlots||[];
 if(!plots.length)return;
 const xs=plots.map(p=>p[0]),ys=plots.map(p=>p[1]);
 const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 const cx=(minX+maxX)/2;
 // 허수아비 영웅: 밭 위쪽 가장자리에서 좀 더 위로 올려서 배치 (표준 유니코드에 허수아비
 // 이모지가 없어 농부 이모지로 대체 표현)
 if(state.upgrades.scarecrow){
   const p=w2s(cx,minY-4.8);
   ctx.save();ctx.font="26px serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.shadowColor="rgba(255,214,102,.8)";ctx.shadowBlur=10;ctx.fillText("🧑‍🌾",p.x,p.y);ctx.restore();
 }
 // 수확도우미 댕댕이: 밭 안에서 목표 지점을 향해 자연스럽게 걷다가 도착하면 잠깐 쉬고,
 // 다시 새 목표를 골라 걷는 방식 (이전의 sine파 미끄러짐보다 훨씬 동물답게 움직임)
 if(state.upgrades.pet){
   const marginX=(maxX-minX)*0.12,marginY=(maxY-minY)*0.12;
   const bounds={minX:minX+marginX,maxX:maxX-marginX,minY:minY+marginY,maxY:maxY-marginY};
   const pet=updatePetWander(bounds);
   const bob=pet.walking?Math.abs(Math.sin(Date.now()/140))*1.1:0;
   const p=w2s(pet.x,pet.y-bob*0.05);
   ctx.save();ctx.font="22px serif";ctx.textAlign="center";ctx.textBaseline="middle";
   if(pet.facingLeft){ctx.translate(p.x,p.y);ctx.scale(-1,1);ctx.fillText("🐕",0,0)}
   else ctx.fillText("🐕",p.x,p.y);
   ctx.restore();
 }
 // 방해요소: 성장 중인 작물 위에 주기적으로 까마귀가 나타남 (허수아비 보유 시 즉시 쫓겨남)
 const dist=state.farmDisturbance;
 if(dist&&dist.cellIdx>=0&&Date.now()<dist.expiresAt&&plots[dist.cellIdx]){
   const pos=plots[dist.cellIdx];
   const bob=Math.sin(Date.now()/200)*3;
   const p=w2s(pos[0],pos[1]-4);
   ctx.save();ctx.font="20px serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("🐦‍⬛",p.x,p.y+bob);ctx.restore();
 }
}
function farmDisturbanceTick(){
 const dist=state.farmDisturbance;
 const now=gameNow();
 // 활성 방해요소가 만료되면 정산: 허수아비가 없으면 해당 밭의 성장을 살짝 지연시킴
 if(dist&&dist.cellIdx>=0&&now>=dist.expiresAt){
   const f=state.farm[dist.cellIdx];
   if(f&&f.seed&&!state.upgrades.scarecrow){
     const elapsed=now-f.plantedAt;
     const remaining=f.growMs-elapsed;
     if(remaining>0){
       // plantedAt을 미래 시각으로 밀어버리지 않도록(그러면 다음 체크에서 '손상된 데이터'로
       // 오인되어 성장이 0%로 리셋될 수 있음) 지연량을 '지금까지 지난 시간' 이내로 제한
       // (성장 초반에 방해요소가 발생하면 지연량이 지난 시간보다 커질 수 있었던 문제)
       const delay=Math.min(Math.round(f.growMs*0.12),elapsed);
       if(delay>0){f.plantedAt+=delay;toast("🐦‍⬛ 까마귀가 작물을 건드려 성장이 조금 지연됐어요!")}
     }
   }else if(f&&f.seed&&state.upgrades.scarecrow){
     toast("🧑‍🌾 허수아비가 까마귀를 쫓아냈어요!");
   }
   state.farmDisturbance={cellIdx:-1,expiresAt:0};save();
   return;
 }
 if(dist&&dist.cellIdx>=0)return; // 이미 진행 중
 if(Math.random()>0.35)return; // 매 틱마다 35% 확률로만 등장 시도
 const candidates=state.farm.map((f,i)=>f.seed&&(now-f.plantedAt)<f.growMs?i:-1).filter(i=>i>=0);
 if(!candidates.length)return;
 const idx=candidates[Math.floor(Math.random()*candidates.length)];
 state.farmDisturbance={cellIdx:idx,expiresAt:now+5000};
}

/* ===================== 실시간 날씨 기반 배경 환경 (맑음/흐림/비/눈) =====================
   Open-Meteo(무료, API 키 불필요)에서 현재 날씨를 가져와 캔버스 위에 오버레이로 표현합니다.
   위치 권한이 없거나 네트워크가 막혀도 항상 "맑음"으로 안전하게 대체됩니다. */
let weatherKind="clear",weatherParticles=[];
function weatherCodeToKind(code){
 if(code==null)return"clear";
 if(code>=95)return"rain"; // 뇌우도 비 연출로 통합
 if(code>=71&&code<=77)return"snow";
 if(code>=85&&code<=86)return"snow";
 if(code>=51&&code<=67)return"rain";
 if(code>=80&&code<=82)return"rain";
 if(code>=45&&code<=48)return"cloudy"; // 안개
 if(code>=1&&code<=3)return"cloudy";
 return"clear";
}
function initWeatherParticles(kind){
 weatherParticles=[];
 if(kind==="rain"){
   for(let i=0;i<70;i++)weatherParticles.push({x:Math.random()*W,y:Math.random()*H,len:14+Math.random()*10,speed:9+Math.random()*5});
 }else if(kind==="snow"){
   for(let i=0;i<50;i++)weatherParticles.push({x:Math.random()*W,y:Math.random()*H,r:1.5+Math.random()*2.2,speed:0.8+Math.random()*1.2,drift:Math.random()*2-1});
 }
}
function drawWeatherOverlay(){
 if(weatherKind==="clear")return;
 ctx.save();
 if(weatherKind==="cloudy"){
   ctx.fillStyle="rgba(60,70,85,.22)";ctx.fillRect(0,0,W,H);
 }else if(weatherKind==="rain"){
   ctx.fillStyle="rgba(30,40,60,.28)";ctx.fillRect(0,0,W,H);
   ctx.strokeStyle="rgba(200,225,255,.55)";ctx.lineWidth=1.4;
   weatherParticles.forEach(p=>{
     ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-4,p.y+p.len);ctx.stroke();
     p.y+=p.speed;p.x-=p.speed*0.35;
     if(p.y>H){p.y=-p.len;p.x=Math.random()*W}
     if(p.x<0)p.x=W;
   });
 }else if(weatherKind==="snow"){
   ctx.fillStyle="rgba(210,225,245,.10)";ctx.fillRect(0,0,W,H);
   ctx.fillStyle="rgba(255,255,255,.9)";
   weatherParticles.forEach(p=>{
     ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
     p.y+=p.speed;p.x+=p.drift*0.4;
     if(p.y>H){p.y=-4;p.x=Math.random()*W}
     if(p.x<0)p.x=W;if(p.x>W)p.x=0;
   });
 }
 ctx.restore();
}
function setWeather(kind){
 if(kind===weatherKind)return;
 weatherKind=kind;
 initWeatherParticles(kind);
 handleWeatherEvent(kind);
}
// 날씨 연동 이벤트: 비/눈이 오는 날 하루 1회 특별 보너스 지급 (실시간 날씨와 게임을 실제로 연결)
function handleWeatherEvent(kind){
 if(kind!=="rain"&&kind!=="snow")return;
 const today=todayStr();
 if(state.lastWeatherBonusDate===today)return; // 오늘 이미 날씨 보너스를 받음
 state.lastWeatherBonusDate=today;
 const bonus=kind==="rain"?150:250; // 눈이 더 희귀하니 보상도 더 크게
 state.gold+=bonus;
 save();
 flashGold();
 const label=kind==="rain"?"☔ 비":"❄️ 눈";
 toast(`${label}가 내리는 날 특별 보너스 +${bonus.toLocaleString()}G!`);
 pushNotification("날씨 이벤트",`오늘은 ${label}가 오는 날이라 ${bonus.toLocaleString()}G 보너스를 받았습니다.`);
}
async function fetchWeather(){
 try{
   const pos=await new Promise((resolve)=>{
     if(!navigator.geolocation){resolve(null);return}
     navigator.geolocation.getCurrentPosition(
       p=>resolve(p),
       ()=>resolve(null),
       {timeout:4000,maximumAge:600000}
     );
   });
   const lat=pos?pos.coords.latitude:37.5665,lon=pos?pos.coords.longitude:126.9780; // 위치 정보가 없으면 서울 기준
   const res=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code`);
   if(!res.ok)throw new Error("weather fetch failed");
   const data=await res.json();
   setWeather(weatherCodeToKind(data?.current?.weather_code));
 }catch{
   setWeather("clear"); // 오프라인/권한거부/차단 등 어떤 이유로든 실패하면 항상 안전하게 맑음으로
 }
}

function isMoving(){
  return Boolean(
    joystickVec.x||joystickVec.y||
    autoPath.length||
    keys.ArrowUp||keys.ArrowDown||keys.ArrowLeft||keys.ArrowRight||
    keys.w||keys.a||keys.s||keys.d
  );
}

function drawPlayer(){
  const im=images[state.character];
  if(!im)return;

  const p=w2s(state.player.x,state.player.y);
  const height=Math.max(82,Math.min(145,W*.085));
  const width=height*(im.naturalWidth||im.width)/(im.naturalHeight||im.height);
  const bob=isMoving()?Math.sin(performance.now()*.015)*3:0;
  const direction=Number.isFinite(state.player.dirLerp)
    ? state.player.dirLerp
    : (state.player.dir||1);

  ctx.save();
  ctx.translate(p.x,p.y);

  ctx.globalAlpha=.28;
  ctx.fillStyle="#000";
  ctx.beginPath();
  ctx.ellipse(0,5,width*.32,width*.11,0,0,Math.PI*2);
  ctx.fill();

  ctx.globalAlpha=1;
  ctx.shadowColor="#42d8ff";
  ctx.shadowBlur=15;
  ctx.scale(direction,1);
  ctx.drawImage(im,-width/2,-height+bob,width,height);
  ctx.restore();
}

function update(dt){
  if(!started)return;

  let dx=0,dy=0;

  if(autoPath.length){
    smoothDX=0;smoothDY=0;moveAccel=0;
    const target=autoPath[0];
    const isFinalHop=autoPath.length===1; // last waypoint = the hotspot itself, may sit off-road
    dx=target.x-state.player.x;
    dy=target.y-state.player.y;
    const dist=Math.hypot(dx,dy);

    if(dist<.38){
      state.player.x=target.x;
      state.player.y=target.y;
      autoPath.shift();

      if(autoPath.length){
        const next=autoPath[0];
        const currentNode=PATH.nearestNode(WORLD,state.player.x,state.player.y);
        const nextNode=PATH.nearestNode(WORLD,next.x,next.y);
        currentEdge=WORLD.edges.find(([a,b])=>
          (a===currentNode&&b===nextNode)||(a===nextNode&&b===currentNode)
        )||currentEdge;
      }else{
        currentEdge=null; // route finished; re-resolve nearest road fresh on next manual move
        setAutoActive(false);
      }

      dx=0;
      dy=0;
    }else if(isFinalHop){
      // free 2D movement straight to the hotspot — no road constraint, so no edge-projection shake
      const speed=state.player.speed*CHARS[state.character].speed;
      const nx=dx/dist,ny=dy/dist;
      const step=worldStep(nx,ny,speed,dt);
      state.player.x+=step.x;
      state.player.y+=step.y;
      const desired=nx<0?-1:1;
      state.player.dirLerp=(state.player.dirLerp??state.player.dir??1)+(desired-(state.player.dirLerp??state.player.dir??1))*Math.min(1,dt*9);
      state.player.dir=state.player.dirLerp<0?-1:1;
      dx=0;
      dy=0;
    }
  }else{
    const targetX=(keys.ArrowRight||keys.d?1:0)-(keys.ArrowLeft||keys.a?1:0)+joystickVec.x;
    const targetY=(keys.ArrowDown||keys.s?1:0)-(keys.ArrowUp||keys.w?1:0)+joystickVec.y;
    const moving=Math.hypot(targetX,targetY)>.05;
    // Ease the input direction (turnLerp) and the speed ramp (moveAccel) toward their targets
    // each frame instead of snapping instantly -- this is what makes starting, stopping, and
    // changing direction feel smooth and natural rather than rigid/robotic.
    const turnLerp=Math.min(1,dt*16);
    smoothDX+=(targetX-smoothDX)*turnLerp;
    smoothDY+=(targetY-smoothDY)*turnLerp;
    moveAccel+=((moving?1:0)-moveAccel)*Math.min(1,dt*(moving?9:12));
    dx=smoothDX;dy=smoothDY;
  }

  moveOnRoute(dx,dy,dt,autoPath.length?1:Math.max(.4,moveAccel));
  updateCars(dt);
  checkCarCollision();

  const near=getNear();
  const hint=ui("interactionHint");
  if(hint){
    hint.classList.toggle("show",Boolean(near));
    hint.textContent=near?`${near.label} · 상호작용`:"";
  }

  const now=performance.now();
  if(now-lastUiUpdate>120){
    updateUI(near);
    lastUiUpdate=now;
  }
  if(now-lastPetTick>3000){
    petAutoHarvestTick();
    lastPetTick=now;
  }
  if(now-lastDisturbanceTick>4000){
    farmDisturbanceTick();
    institutionThreatExpiryCheck();
    lastDisturbanceTick=now;
  }
  if(now-lastThreatTick>15000){
    institutionThreatTick();
    lastThreatTick=now;
  }
  if(now-lastCarSpawnTick>8000){
    carSpawnTick();
    lastCarSpawnTick=now;
  }
  if(now-lastLuckyHourCheck>20000){
    updateLuckyHourBanner();
    lastLuckyHourCheck=now;
  }
  if(now-lastGoldenCropTick>10000){
    goldenCropTick();
    lastGoldenCropTick=now;
  }
}

function getNear(){
  let best=null,bestIdx=-1,d=Infinity;
  WORLD.hotspots.forEach((h,idx)=>{
    const n=Math.hypot(state.player.x-h.x,state.player.y-h.y);
    if(isNearHotspot(h,idx)&&n<d){best=h;bestIdx=idx;d=n}
  });
  nearHotspotIdx=bestIdx;
  return best;
}
function setAutoActive(on){ui("autoBtn")?.classList.toggle("active",on)}
function startAuto(h){
 const nearest=PATH.nearestRoad(WORLD,state.player.x,state.player.y);
 if(!nearest.edge){toast("현재 위치에서 도로를 찾을 수 없습니다.");return}
 const [a,b]=nearest.edge,A=WORLD.nodes[a],B=WORLD.nodes[b];
 const pathA=PATH.shortestPath(WORLD,a,h.node),pathB=PATH.shortestPath(WORLD,b,h.node);
 const costA=Math.hypot(state.player.x-A[0],state.player.y-A[1])+pathA.length;
 const costB=Math.hypot(state.player.x-B[0],state.player.y-B[1])+pathB.length;
 const selected=costA<=costB?pathA:pathB,endpoint=costA<=costB?A:B;
 if(!selected.length){toast(`${h.label}로 이동할 수 있는 도로가 없습니다.`);return}
 autoPath=[{x:endpoint[0],y:endpoint[1]},...selected.slice(1).map(p=>({x:p.x,y:p.y}))];
 const last=autoPath[autoPath.length-1];
 if(!last||Math.hypot(last.x-h.x,last.y-h.y)>.05)autoPath.push({x:h.x,y:h.y});
 currentEdge=nearest.edge;
 setAutoActive(true);
 toast(`${h.label} 경로 안내를 시작합니다.`);
}
function interact(){const h=getNear();if(!h){toast("상호작용 원 안으로 이동하세요.");return}if(h.type==="work")doWork(h);if(h.type==="shop")openShop();if(h.type==="farm")openFarm();if(h.type==="minigame")openMinigame(h)}
async function doWork(h){
 const threat=state.institutionThreats[h.node];
 if(threat&&gameNow()<threat.expiresAt){openThreatResponse(h,threat);return}
 const staticPool=SYS.missionPool[h.node];
 if(staticPool&&staticPool.length){
   const aiMissions=await fetchAiMissions(h.node);
   const pool=aiMissions.length?[...staticPool,...aiMissions]:staticPool;
   openMission(h,pool);
   return;
 }
 const reward=Math.round(h.reward*CHARS[state.character].reward);state.gold+=reward;recalcLevel();state.quests[0]=true;save();toast(`${h.label} 업무 완료 · +${reward.toLocaleString()}G`)
}
// AI(Cloudflare Workers AI)로 생성된 미션을 정적 미션 풀에 섞어서 콘텐츠를 늘림.
// 관리자가 아직 그 기관에 미션을 생성해두지 않았으면 빈 배열을 반환해 조용히 정적 풀만 사용.
async function fetchAiMissions(node){
 try{
   const controller=new AbortController();
   const timeout=setTimeout(()=>controller.abort(),1500); // 응답이 느려도 미션 창이 늦게 열리지 않도록 짧게 제한
   const res=await fetch(`./api/missions?node=${encodeURIComponent(node)}`,{signal:controller.signal});
   clearTimeout(timeout);
   const data=await res.json();
   return data.ok?data.missions:[];
 }catch{return[]}
}
function openThreatResponse(h,threat){
 const tt=SYS.threatTypes[threat.type];
 const secondsLeft=Math.max(0,Math.round((threat.expiresAt-gameNow())/1000));
 openModal(`<h2>${tt.icon} ${tt.name} 발생!</h2><p>${tt.desc}</p><p style="opacity:.75;font-size:13px;">${h.label} · 남은 시간 약 ${secondsLeft}초</p>
   <button type="button" id="patrolBtn" class="ai-advisor-btn">🚨 순찰하기 (위협 제거)</button>`);
 document.getElementById("patrolBtn").addEventListener("click",()=>resolveThreat(h));
}
function resolveThreat(h){
 const bonus=200+Math.round(Math.random()*300);
 state.gold+=bonus;
 delete state.institutionThreats[h.node];
 save();
 toast(`✅ 순찰 성공! ${h.label} 위협을 제거했습니다 · +${bonus.toLocaleString()}G`);
 pushNotification("순찰 성공",`${h.label}의 위협을 무사히 제거하고 보너스 ${bonus.toLocaleString()}G를 받았습니다.`);
 closeModal();
}
function institutionThreatTick(){
 const map={HQ:"thief",MINT:"hacker",LAB:"hacker",H2_ID:"phishing",H2_PAPER:"thief"};
 const nodes=Object.keys(map);
 const anyActive=nodes.some(n=>{const t=state.institutionThreats[n];return t&&gameNow()<t.expiresAt});
 if(anyActive)return; // 한 번에 하나의 위협만 발생 (너무 정신없지 않도록 단순화)
 if(Math.random()>0.3)return; // 15초 틱마다 30% 확률로만 새 위협 발생
 const node=nodes[Math.floor(Math.random()*nodes.length)];
 const type=map[node];
 state.institutionThreats[node]={type,expiresAt:gameNow()+45000}; // 45초 안에 순찰해야 함
 const tt=SYS.threatTypes[type];
 const h=WORLD.hotspots.find(x=>x.node===node);
 pushNotification(`${tt.icon} ${tt.name} 침입 경고`,`${h?h.label:node}에 ${tt.desc}`);
 save();
}
// 만료된(방치된) 위협에 골드 피해를 적용 -- institutionThreatTick과 별개로, 렌더링 루프 근처에서
// 매 틱 확인
function institutionThreatExpiryCheck(){
 for(const node of Object.keys(state.institutionThreats)){
   const threat=state.institutionThreats[node];
   if(threat&&gameNow()>=threat.expiresAt){
     const tt=SYS.threatTypes[threat.type];
     const h=WORLD.hotspots.find(x=>x.node===node);
     const loss=Math.round(state.gold*0.05);
     state.gold=Math.max(0,state.gold-loss);
     delete state.institutionThreats[node];
     save();
     toast(`❌ ${h?h.label:node}의 ${tt?tt.name:""} 위협을 놓쳐 ${loss.toLocaleString()}G를 잃었습니다.`);
     pushNotification("순찰 실패",`${h?h.label:node}의 위협에 제때 대응하지 못해 ${loss.toLocaleString()}G의 피해를 입었습니다.`);
   }
 }
}
/* ===================== 도로 위 자동차 (가끔 등장, 충돌 시 게임 종료) ===================== */
let activeCars=[];
function carEdgeInfo(edge){
 const[a,b]=edge,A=WORLD.nodes[a],B=WORLD.nodes[b];
 const vx=B[0]-A[0],vy=B[1]-A[1],len=Math.hypot(vx,vy)||1;
 return{A,B,vx,vy,len};
}
function carConnectedEdges(nodeId){return WORLD.edges.filter(([a,b])=>a===nodeId||b===nodeId)}
function spawnCar(){
 const edges=WORLD.edges;
 const edge=edges[Math.floor(Math.random()*edges.length)];
 activeCars.push({edge,t:Math.random()<0.5?0:1,forward:Math.random()<0.5,speed:11+Math.random()*4,hopsLeft:4+Math.floor(Math.random()*4)});
}
function carSpawnTick(){
 if(activeCars.length<2&&Math.random()<0.3)spawnCar();
}
function updateCars(dt){
 for(let i=activeCars.length-1;i>=0;i--){
   const c=activeCars[i];
   const info=carEdgeInfo(c.edge);
   const step=worldStep(c.forward?info.vx:-info.vx,c.forward?info.vy:-info.vy,c.speed,dt);
   const stepLen=Math.hypot(step.x,step.y);
   c.t+=(c.forward?1:-1)*(stepLen/(info.len||1));
   if(c.t>=1||c.t<=0){
     c.hopsLeft--;
     if(c.hopsLeft<=0){activeCars.splice(i,1);state.stats.carsSurvived++;continue}
     const atNode=c.t>=1?c.edge[1]:c.edge[0];
     const options=carConnectedEdges(atNode).filter(e=>!(e[0]===c.edge[0]&&e[1]===c.edge[1])&&!(e[0]===c.edge[1]&&e[1]===c.edge[0]));
     const nextEdge=options.length?options[Math.floor(Math.random()*options.length)]:c.edge;
     c.edge=nextEdge;
     c.forward=nextEdge[0]===atNode;
     c.t=c.forward?0:1;
   }
 }
}
function carWorldPos(c){
 const info=carEdgeInfo(c.edge);
 return{x:info.A[0]+info.vx*c.t,y:info.A[1]+info.vy*c.t};
}
function drawCars(){
 activeCars.forEach(c=>{
   const pos=carWorldPos(c);
   const p=w2s(pos.x,pos.y);
   const info=carEdgeInfo(c.edge);
   const dirX=c.forward?info.vx:-info.vx;
   const facingLeft=dirX<0;
   ctx.save();
   ctx.font="24px serif";ctx.textAlign="center";ctx.textBaseline="middle";
   ctx.shadowColor="rgba(0,0,0,.6)";ctx.shadowBlur=6;
   if(facingLeft){ctx.translate(p.x,p.y);ctx.scale(-1,1);ctx.fillText("🚗",0,0)}
   else ctx.fillText("🚗",p.x,p.y);
   ctx.restore();
 });
}
let lastCollisionAt=0;
function checkCarCollision(){
 if(Date.now()-lastCollisionAt<3000)return; // 충돌 직후 3초간 무적 (같은 차에 연속으로 맞지 않도록)
 for(const c of activeCars){
   const pos=carWorldPos(c);
   if(Math.hypot(state.player.x-pos.x,state.player.y-pos.y)<2.2){
     handleCarHit();
     return;
   }
 }
}
function handleCarHit(){
 lastCollisionAt=Date.now();
 const penalty=Math.min(state.gold,Math.max(50,Math.round(state.gold*0.1)));
 state.gold-=penalty;
 save();
 playSfx("gameover");
 shakeScreen();
 toast(`🚗 자동차와 부딪혔습니다! -${penalty.toLocaleString()}G · 다음부턴 조심하세요!`);
 pushNotification("교통사고 주의",`도로에서 자동차와 부딪혀 ${penalty.toLocaleString()}G를 잃었습니다.`);
}
function shakeScreen(){
 const canvas=ui("game");
 if(!canvas)return;
 canvas.classList.remove("shake");
 void canvas.offsetWidth; // 애니메이션 재시작을 위해 강제로 리플로우
 canvas.classList.add("shake");
}
function shuffleArray(arr){
 const a=arr.slice();
 for(let i=a.length-1;i>0;i--){
   const j=Math.floor(Math.random()*(i+1));
   [a[i],a[j]]=[a[j],a[i]];
 }
 return a;
}
function openMission(h,pool){
 const rawIdx=state.missionIndex[h.node];
 const idx=(Number.isFinite(rawIdx)?rawIdx:0)%pool.length;
 const m=pool[idx];
 if(!m){ // defensive fallback -- should never happen now, but never crash the game over a bad mission index
   const reward=Math.round(h.reward*CHARS[state.character].reward);state.gold+=reward;recalcLevel();state.quests[0]=true;save();toast(`${h.label} 업무 완료 · +${reward.toLocaleString()}G`);return;
 }
 // 정답이 항상 데이터의 첫 번째 항목으로 고정되어 있어 매번 1번만 고르면 통과되는 문제가
 // 있었음 -- 표시할 때마다 옵션 순서를 랜덤으로 섞어서 정답 위치가 매번 바뀌도록 함
 const shuffled=shuffleArray(m.options);
 let html=`<h2>📋 ${h.label} · 구매 미션</h2><p>${escapeHtml(m.title)}</p><p style="opacity:.75;font-size:13px;">${escapeHtml(m.spec)}</p><div class="shop-grid">`;
 shuffled.forEach((o,i)=>{html+=`<article class="item mission-opt"><p class="mission-opt-text">${escapeHtml(o.text)}</p><p class="mission-opt-price">${Number(o.price).toLocaleString()}원</p><button type="button" data-opt="${i}">이 업체 선택</button></article>`});
 html+=`</div><button type="button" id="ai-advisor-btn" class="ai-advisor-btn">🤖 AI 조달 자문관에게 물어보기</button><div id="ai-hint" class="ai-hint-box" style="display:none;"></div>`;
 openModal(html);
 document.querySelectorAll("[data-opt]").forEach(b=>b.addEventListener("click",()=>resolveMission(h,pool,idx,shuffled,+b.dataset.opt)));
 document.getElementById("ai-advisor-btn").addEventListener("click",()=>showAiHint(m));
}
const MISSION_COMBO_BONUS_PER_STREAK=0.05,MISSION_COMBO_MAX=10; // 콤보 1당 +5%, 최대 10콤보(+50%)
function resolveMission(h,pool,idx,shuffledOptions,optIdx){
 const o=shuffledOptions[optIdx];
 if(o.correct){
   state.missionStreak=Math.min(MISSION_COMBO_MAX,state.missionStreak+1);
   const comboMult=1+state.missionStreak*MISSION_COMBO_BONUS_PER_STREAK;
   const reward=Math.round(h.reward*CHARS[state.character].reward*(1+state.prestigeLevel*SYS.prestigeBonusPerLevel)*comboMult*getLuckyHourMultiplier());
   state.gold+=reward;recalcLevel();state.quests[0]=true;
   state.missionIndex[h.node]=(idx+1)%pool.length;
   state.stats.missionsWon++;
   state.stats.lifetimeGoldEarned+=reward;
   save();
   playSfx("success");
   const comboText=state.missionStreak>=2?` 🔥${state.missionStreak}콤보!`:"";
   toast(`✅ 정답! ${h.label} 업무 완료 · +${reward.toLocaleString()}G${comboText}`);
   pushNotification("업무 완료",`${h.label}에서 미션을 성공적으로 완료했습니다. +${reward.toLocaleString()}G`);
   checkAchievements();
 }else{
   state.missionStreak=0; // 오답이면 콤보 초기화
   save();
   playSfx("fail");
   toast(`❌ ${o.reason}`);
 }
 closeModal();
}
// AI 조달 자문관: Cloudflare Workers AI로 실제 생성형 응답, 실패 시 규칙 기반 힌트로 폴백
async function showAiHint(m){
 const box=document.getElementById("ai-hint");
 if(!box)return;
 box.style.display="block";
 box.innerHTML=`<b>🤖 AI 조달 자문관</b><br>생각 중...`;
 const offlineTip=(m.rule!=null&&SYS.ruleList[m.rule])
   ?`이 발주는 공공구매 12대 원칙 중 "${SYS.ruleList[m.rule]}"과 관련이 있어요. 해당 인증·서류를 보유한 업체를 찾아보세요.`
   :"견적가가 예산상한을 넘지 않는지부터 확인하고, 인증서를 보유한 업체인지 살펴보세요.";
 try{
   const res=await fetch("./api/ai-advisor",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
     title:m.title,spec:m.spec,ruleName:m.rule!=null?SYS.ruleList[m.rule]:null,options:m.options
   })});
   const data=await res.json();
   box.innerHTML=`<b>🤖 AI 조달 자문관</b><br>${data.ok?escapeHtml(data.hint):escapeHtml(offlineTip)}`;
 }catch{
   box.innerHTML=`<b>🤖 AI 조달 자문관</b><br>${escapeHtml(offlineTip)}`;
 }
}
/* ===================== 광장 미니게임 (분수대: 동전 던지기 / 석탑: 기억력 카드 짝맞추기) =====================
   두 미니게임 모두 하루 최대 MINIGAME_DAILY_LIMIT회로 제한해 골드 파밍을 막고, 최고 기록은 날짜와
   무관하게 영구 보관한다(state.minigamePlays는 오늘 날짜 기준으로 매일 초기화, state.minigameBest는
   누적). 기존 상태에 필드가 없는 이전 세이브도 안전하게 동작하도록 지연 초기화(lazy-init) 방식을 쓴다. */
const MINIGAME_DAILY_LIMIT=5;
function minigamePlaysToday(key){
 if(!state.minigamePlays)state.minigamePlays={};
 const today=todayStr();
 let p=state.minigamePlays[key];
 if(!p||p.date!==today)p={date:today,count:0};
 state.minigamePlays[key]=p;
 return p;
}
function minigameBest(key){
 if(!state.minigameBest)state.minigameBest={};
 if(state.minigameBest[key]==null)state.minigameBest[key]=0;
 return state.minigameBest[key];
}
function minigameRewardMultiplier(){
 return CHARS[state.character].reward*(1+state.prestigeLevel*SYS.prestigeBonusPerLevel)*getLuckyHourMultiplier();
}
function grantMinigameGold(reward){
 const gold=Math.max(1,Math.round(reward*minigameRewardMultiplier()));
 state.gold+=gold;state.stats.lifetimeGoldEarned+=gold;recalcLevel();flashGold();
 return gold;
}
function openMinigame(h){
 if(h.game==="coinToss")openCoinTossGame(h);
 else if(h.game==="memoryMatch")openMemoryMatchGame(h);
}

/* ---- 분수대 광장: 동전 던지기 (타이밍 바) ---- */
function openCoinTossGame(h){
 const p=minigamePlaysToday("fountain");
 const remaining=Math.max(0,MINIGAME_DAILY_LIMIT-p.count);
 const best=minigameBest("fountain");
 if(remaining<=0){
   openModal(`<h2>⛲ ${h.label} · 동전 던지기</h2><p>오늘 플레이 횟수를 모두 사용했습니다. 내일 다시 도전해주세요!</p><p style="opacity:.6;font-size:12px;">최고 등급: ${best>0?best+"점":"-"}</p>`);
   return;
 }
 openModal(`<h2>⛲ ${h.label} · 동전 던지기</h2>
   <p style="opacity:.8;font-size:13px;">코인이 <b style="color:#ffd166;">황금 구간</b>을 지날 때 던지기 버튼을 눌러보세요!</p>
   <div class="coin-toss-track"><div class="coin-toss-target"></div><div class="coin-toss-marker" id="coinMarker">🪙</div></div>
   <button type="button" id="coinThrowBtn" class="ai-advisor-btn">던지기!</button>
   <p id="coinResultText" style="min-height:20px;text-align:center;font-weight:800;"></p>
   <p style="opacity:.6;font-size:12px;text-align:center;">오늘 남은 횟수: ${remaining}/${MINIGAME_DAILY_LIMIT} · 최고 등급: ${best>0?best+"점":"-"}</p>`);
 const marker=document.getElementById("coinMarker");
 const btn=document.getElementById("coinThrowBtn");
 if(!marker||!btn)return;
 const start=performance.now();
 const period=1100; // ms per full back-and-forth cycle
 let pos=0,raf=null;
 function frame(now){
   const phase=((now-start)%period)/period;
   pos=(Math.sin(phase*Math.PI*2-Math.PI/2)+1)/2; // 0..1, eases at both ends like a real swing
   marker.style.left=`calc(${(pos*100).toFixed(2)}% - 18px)`;
   raf=requestAnimationFrame(frame);
 }
 raf=requestAnimationFrame(frame);
 activeMinigameCleanup=()=>cancelAnimationFrame(raf);
 btn.addEventListener("click",()=>{
   cancelAnimationFrame(raf);
   activeMinigameCleanup=null;
   resolveCoinToss(h,pos,p);
 },{once:true});
}
function resolveCoinToss(h,pos,p){
 p.count++;
 const dist=Math.abs(pos-0.5);
 let tierLabel,tierScore;
 if(dist<=0.035){tierLabel="🌟 퍼펙트!";tierScore=220}
 else if(dist<=0.09){tierLabel="👏 그레이트!";tierScore=140}
 else if(dist<=0.17){tierLabel="🙂 굿";tierScore=70}
 else{tierLabel="아깝네요";tierScore=15}
 if(tierScore>minigameBest("fountain"))state.minigameBest.fountain=tierScore;
 const gold=grantMinigameGold(tierScore);
 save();
 playSfx(tierScore>=140?"jackpot":tierScore>=70?"success":"fail");
 const remaining=Math.max(0,MINIGAME_DAILY_LIMIT-p.count);
 openModal(`<h2>⛲ ${h.label} 결과</h2><p style="font-size:20px;font-weight:900;text-align:center;">${tierLabel}</p><div class="share-link-box" style="text-align:center;font-size:22px;">🎁 +${gold.toLocaleString()}G</div><p style="opacity:.6;font-size:12px;text-align:center;">오늘 남은 횟수: ${remaining}/${MINIGAME_DAILY_LIMIT}</p>${remaining>0?'<button type="button" id="coinAgainBtn" class="ai-advisor-btn">다시 던지기</button>':""}`);
 toast(`${h.label} · ${tierLabel} +${gold.toLocaleString()}G`);
 const againBtn=document.getElementById("coinAgainBtn");
 if(againBtn)againBtn.addEventListener("click",()=>openCoinTossGame(h));
}

/* ---- 석탑 광장: 기억력 카드 짝맞추기 ---- */
function openMemoryMatchGame(h){
 const p=minigamePlaysToday("monument");
 const remaining=Math.max(0,MINIGAME_DAILY_LIMIT-p.count);
 const best=minigameBest("monument");
 if(remaining<=0){
   openModal(`<h2>🗿 ${h.label} · 기억력 카드 짝맞추기</h2><p>오늘 플레이 횟수를 모두 사용했습니다. 내일 다시 도전해주세요!</p><p style="opacity:.6;font-size:12px;">최고 기록: ${best>0?best+"회":"-"}</p>`);
   return;
 }
 const SYMBOLS=["🪙","💵","📜","🏛️","🖋️","🎖️"];
 const cards=shuffleArray([...SYMBOLS,...SYMBOLS]);
 let flipped=[],matched=new Set(),moves=0,lockBoard=false,flipTimeout=null;
 activeMinigameCleanup=()=>clearTimeout(flipTimeout);
 const cardsHtml=cards.map((_,i)=>`<button type="button" class="memory-card" data-idx="${i}">❔</button>`).join("");
 openModal(`<h2>🗿 ${h.label} · 기억력 카드 짝맞추기</h2>
   <p style="opacity:.8;font-size:13px;">같은 카드 두 장을 짝지어 모두 맞춰보세요! 적은 횟수로 끝낼수록 보상이 커집니다.</p>
   <div class="memory-grid" id="memoryGrid">${cardsHtml}</div>
   <p id="memoryMovesText" style="text-align:center;font-weight:800;">시도: 0회</p>
   <p style="opacity:.6;font-size:12px;text-align:center;">오늘 남은 횟수: ${remaining}/${MINIGAME_DAILY_LIMIT} · 최고 기록: ${best>0?best+"회":"-"}</p>`);
 const grid=document.getElementById("memoryGrid");
 const movesText=document.getElementById("memoryMovesText");
 if(!grid)return;
 grid.querySelectorAll(".memory-card").forEach(cardBtn=>{
   cardBtn.addEventListener("click",()=>{
     const idx=+cardBtn.dataset.idx;
     if(lockBoard||matched.has(idx)||flipped.some(f=>f.idx===idx))return;
     cardBtn.textContent=cards[idx];
     cardBtn.classList.add("flipped");
     flipped.push({idx,btn:cardBtn});
     if(flipped.length<2)return;
     moves++;
     if(movesText)movesText.textContent=`시도: ${moves}회`;
     lockBoard=true;
     const[a,b]=flipped;
     if(cards[a.idx]===cards[b.idx]){
       matched.add(a.idx);matched.add(b.idx);
       a.btn.classList.add("matched");b.btn.classList.add("matched");
       flipped=[];lockBoard=false;
       playSfx("success");
       if(matched.size===cards.length)flipTimeout=setTimeout(()=>finishMemoryGame(h,moves,p),400);
     }else{
       playSfx("fail");
       flipTimeout=setTimeout(()=>{
         a.btn.classList.remove("flipped");a.btn.textContent="❔";
         b.btn.classList.remove("flipped");b.btn.textContent="❔";
         flipped=[];lockBoard=false;
       },700);
     }
   });
 });
}
function finishMemoryGame(h,moves,p){
 activeMinigameCleanup=null;
 p.count++;
 let tierLabel,tierScore;
 if(moves<=8){tierLabel="🌟 완벽해요!";tierScore=220}
 else if(moves<=12){tierLabel="👏 훌륭해요!";tierScore=140}
 else if(moves<=18){tierLabel="🙂 좋아요";tierScore=70}
 else{tierLabel="수고하셨어요";tierScore=30}
 const best=minigameBest("monument");
 if(!best||moves<best)state.minigameBest.monument=moves;
 const gold=grantMinigameGold(tierScore);
 save();
 playSfx(tierScore>=140?"jackpot":tierScore>=70?"success":"fail");
 const remaining=Math.max(0,MINIGAME_DAILY_LIMIT-p.count);
 openModal(`<h2>🗿 ${h.label} 결과</h2><p style="font-size:20px;font-weight:900;text-align:center;">${tierLabel}</p><p style="text-align:center;">${moves}회 만에 완료!</p><div class="share-link-box" style="text-align:center;font-size:22px;">🎁 +${gold.toLocaleString()}G</div><p style="opacity:.6;font-size:12px;text-align:center;">오늘 남은 횟수: ${remaining}/${MINIGAME_DAILY_LIMIT}</p>${remaining>0?'<button type="button" id="memoryAgainBtn" class="ai-advisor-btn">다시 도전</button>':""}`);
 toast(`${h.label} · ${tierLabel} +${gold.toLocaleString()}G`);
 const againBtn=document.getElementById("memoryAgainBtn");
 if(againBtn)againBtn.addEventListener("click",()=>openMemoryMatchGame(h));
}
function openShop(){const featured=getWeeklyFeaturedSeed();let html="<h2>🌱 씨앗상점</h2><p style=\"opacity:.75;font-size:12px;\">🌟 이번 주 특가 작물은 수확 보상이 20% 늘어납니다.</p><div class='shop-grid'>";for(const[id,s]of Object.entries(SEEDS)){const locked=state.level<s.unlock;const isFeatured=id===featured;html+=`<article class="item shop-item" ${isFeatured?'style="border-color:#ffd166;box-shadow:0 0 10px rgba(255,209,102,.5);"':""}><h3>${s.emoji} ${s.name}${isFeatured?" 🌟":""}</h3><p><b>${locked?`🔒 Lv.${s.unlock} 필요`:s.price.toLocaleString()+"G"}</b></p><button type="button" data-buy="${id}" ${locked?"disabled":""}>${locked?"잠김":"구매"}</button></article>`}html+="</div><h2>🛠️ 농장 도구</h2><div class='shop-grid'>";for(const[id,u]of Object.entries(SYS.upgrades)){const owned=state.upgrades[id];const locked=state.level<u.unlock;html+=`<article class="item shop-item"><h3>${u.icon} ${u.name}</h3><p>${u.desc}</p><p><b>${owned?"보유 중":locked?`🔒 Lv.${u.unlock} 필요`:u.cost.toLocaleString()+"G"}</b></p><button type="button" data-upgrade="${id}" ${owned||locked?"disabled":""}>${owned?"구매완료":locked?"잠김":"구매"}</button></article>`}html+="</div>";openModal(html);document.querySelectorAll("[data-buy]").forEach(b=>b.addEventListener("click",()=>buySeed(b.dataset.buy)));document.querySelectorAll("[data-upgrade]").forEach(b=>b.addEventListener("click",()=>buyUpgrade(b.dataset.upgrade)))}
function buyUpgrade(id){const u=SYS.upgrades[id];if(state.level<u.unlock){toast(`레벨 ${u.unlock} 이상부터 구매할 수 있습니다.`);return}if(state.upgrades[id]){toast("이미 보유한 도구입니다.");return}if(state.gold<u.cost){toast("골드가 부족합니다.");return}state.gold-=u.cost;state.upgrades[id]=true;save();toast(`${u.icon} ${u.name} 구매 완료!`);flashGold();playSfx("buy");openShop()}
function buySeed(id){const s=SEEDS[id];if(state.level<s.unlock){toast(`레벨 ${s.unlock} 이상부터 구매할 수 있습니다.`);return}if(state.gold<s.price){toast("골드가 부족합니다.");return}state.gold-=s.price;state.inventory[id]++;state.quests[1]=true;save();toast(`${s.emoji} ${s.name} 구매완료! (보유 ${state.inventory[id]}개, 잔액 ${state.gold.toLocaleString()}G)`);flashGold();playSfx("buy");openShop()}
function flashGold(){const el=ui("goldText");if(!el)return;el.classList.remove("flash");void el.offsetWidth;el.classList.add("flash")}
function plotGrowth(i){
 const f=state.farm[i];
 if(!f||!f.seed)return{growth:0,left:0,ready:false};
 if(!SEEDS[f.seed]){ // 존재하지 않는(예: 미래에 이름이 바뀌거나 삭제된) 씨앗 ID를 참조하면 매 프레임 크래시로 이어지므로, 해당 밭을 안전하게 비움
   state.farm[i]={seed:null,plantedAt:0,growMs:0};
   save();
   return{growth:0,left:0,ready:false};
 }
 const growMs=Number(f.growMs),plantedAt=Number(f.plantedAt),now=gameNow();
 // 방어적 검증: growMs/plantedAt이 어떤 이유로든 손상되면(NaN, 0 이하, 미래 시각 등)
 // "심자마자 수확 가능"처럼 안전하지 않은 쪽으로 판단하지 않고, 항상 미완료로 처리하며
 // 데이터를 지금 시각으로 리셋해 정상적인 성장 절차를 다시 밟도록 함
 if(!Number.isFinite(growMs)||growMs<=0||!Number.isFinite(plantedAt)||plantedAt<=0||plantedAt>now){
   f.plantedAt=now;
   if(!Number.isFinite(growMs)||growMs<=0)f.growMs=SEEDS[f.seed]?SEEDS[f.seed].grow:60000;
   save();
   return{growth:0,left:f.growMs,ready:false};
 }
 const elapsed=now-plantedAt;
 const growth=Math.min(1,elapsed/growMs);
 const left=Math.max(0,growMs-elapsed);
 return{growth,left,ready:left<=0};
}
function isGoldenPlot(i){return state.goldenCrop&&state.goldenCrop.plotIdx===i&&gameNow()<state.goldenCrop.expiresAt}
function openFarm(){let html="<h2>🌿 주말농장</h2><p>각 밭을 선택해 씨앗을 심고 성장 후 수확하세요.</p><div class='farm-grid'>";state.farm.forEach((f,i)=>{if(!f.seed){if(isGoldenPlot(i))html+=`<article class="item" style="border-color:#ffd166;box-shadow:0 0 10px rgba(255,209,102,.6);"><h3>✨ 밭 ${i+1}</h3><p style="font-size:12px;color:#ffd166;">황금작물 등장!</p><button data-plot="${i}">✨ 수확!</button></article>`;else html+=`<article class=item><h3>밭 ${i+1}</h3><button data-plot="${i}">씨앗 심기</button></article>`}else{const{growth,left,ready}=plotGrowth(i);const stageEmoji=growth>=1?(SEEDS[f.seed]?.emoji||"🌱"):growth<0.34?"🌱":growth<0.7?"🌿":(SEEDS[f.seed]?.emoji||"🌱");html+=`<article class=item><h3>${stageEmoji} 밭 ${i+1}</h3><div class="farm-progress"><div class="farm-progress-bar" style="width:${Math.round(growth*100)}%"></div></div><p>${ready?"수확 가능":Math.ceil(left/1000).toLocaleString()+"초"}</p><button data-plot="${i}">${ready?"수확":"확인"}</button></article>`}});html+="</div>";openModal(html);document.querySelectorAll("[data-plot]").forEach(b=>b.addEventListener("click",()=>usePlot(+b.dataset.plot)))}
function usePlot(i){
 const f=state.farm[i];
 if(!f.seed){
   if(isGoldenPlot(i)){claimGoldenCrop(i);return}
   let html="<h2>심을 씨앗 선택</h2><div class='shop-grid'>";Object.entries(SEEDS).forEach(([id,s])=>{const owned=state.inventory[id]||0;html+=`<article class="item"><h3>${s.emoji} ${s.name}</h3><p style="opacity:.75;font-size:12px;margin:2px 0;">보유 ${owned}개</p><button type="button" data-plant="${id}" ${owned<=0?"disabled":""}>${owned<=0?"미보유":"심기"}</button></article>`});html+="</div>";openModal(html);document.querySelectorAll("[data-plant]:not(:disabled)").forEach(b=>b.addEventListener("click",()=>plant(i,b.dataset.plant)));return
 }
 if(!plotGrowth(i).ready){toast("아직 성장 중입니다.");return}harvestPlot(i);openFarm()
}
// 황금작물: 밭에 가끔(10초마다 20% 확률) 빈 밭 중 하나에 25초간 나타나는 시간제한 보너스.
// 제때 수확하면 큰 보상, 놓치면 그냥 사라짐 -- 긴장감과 재접속 유인을 위한 요소
function claimGoldenCrop(i){
 const reward=800+Math.round(Math.random()*1200);
 state.gold+=reward;
 state.goldenCrop=null;
 save();
 playSfx("jackpot");
 showJackpotEffect(reward);
 pushNotification("황금작물 수확!",`반짝이는 황금작물을 수확해 ${reward.toLocaleString()}G를 얻었습니다!`);
 openFarm();
}
function goldenCropTick(){
 if(state.goldenCrop&&gameNow()<state.goldenCrop.expiresAt)return; // 이미 진행 중
 if(state.goldenCrop){state.goldenCrop=null;save()} // 만료된 골든작물 정리
 if(Math.random()>0.2)return; // 매 틱(10초)마다 20% 확률로만 등장
 const emptyPlots=state.farm.map((f,i)=>!f.seed?i:-1).filter(i=>i>=0);
 if(!emptyPlots.length)return;
 const plotIdx=emptyPlots[Math.floor(Math.random()*emptyPlots.length)];
 state.goldenCrop={plotIdx,expiresAt:gameNow()+25000}; // 25초 안에 수확해야 함
 save();
 pushNotification("✨ 황금작물 등장!","주말농장에 반짝이는 황금작물이 나타났어요! 서둘러 수확하세요!");
}
function harvestPlot(i){
 const f=state.farm[i];
 if(!f.seed)return false;
 if(!plotGrowth(i).ready)return false;
 const seedId=f.seed;
 const s=SEEDS[seedId];
 let reward=Math.round(s.reward*(state.upgrades.scarecrow?1.1:1)*(1+state.prestigeLevel*SYS.prestigeBonusPerLevel)*(seedId===getWeeklyFeaturedSeed()?1+WEEKLY_EVENT_BONUS:1)*getLuckyHourMultiplier());
 const lucky=state.upgrades.clover&&Math.random()<0.15;
 if(lucky)reward*=2;
 state.gold+=reward;
 state.harvest++;
 state.quests[3]=true;
 state.farm[i]={seed:null,plantedAt:0,growMs:0};
 state.harvestCounts[seedId]=(state.harvestCounts[seedId]||0)+1;
 state.stats.lifetimeGoldEarned+=reward;
 save();
 playSfx("harvest");
 if(lucky){
   playSfx("jackpot");
   showJackpotEffect(reward);
 }else{
   toast(`${s.emoji} ${s.name} 수확 · +${reward.toLocaleString()}G`);
 }
 checkCodexProgress(seedId);
 checkAchievements();
 return reward;
}
// 확률형 보상(네잎클로버 2배) 연출 강화: 조용히 골드만 오르는 대신, 카드가 뒤집히는 듯한
// 짧은 축하 연출 + 전용 효과음으로 "손맛"을 살림
function showJackpotEffect(reward){
 const el=document.createElement("div");
 el.className="jackpot-flash";
 el.innerHTML=`<div class="jackpot-card">🍀<br>행운 2배!<br><b>+${reward.toLocaleString()}G</b></div>`;
 document.body.appendChild(el);
 setTimeout(()=>el.remove(),1400);
}
/* ===================== 도감 (씨앗별 수확 누적 뱃지) ===================== */
function codexTierIndex(count){
 let idx=-1;
 SYS.codexTiers.forEach((t,i)=>{if(count>=t.count)idx=i});
 return idx; // -1 = 아직 등급 없음, 0=동, 1=은, 2=금
}
function checkCodexProgress(seedId){
 const count=state.harvestCounts[seedId]||0;
 const tierIdx=codexTierIndex(count);
 if(tierIdx<0)return;
 const tier=SYS.codexTiers[tierIdx];
 const key=`${seedId}_${tierIdx}`;
 if(state.codexClaimed[key])return; // 이미 지급된 등급
 state.codexClaimed[key]=true;
 state.gold+=tier.bonus;
 save();
 playSfx("badge");
 const s=SEEDS[seedId];
 toast(`${tier.icon} 도감 달성! ${s.name} ${tier.name} · +${tier.bonus.toLocaleString()}G`);
 pushNotification("도감 달성",`${s.emoji} ${s.name} ${tier.name} 등급을 달성해 ${tier.bonus.toLocaleString()}G를 받았습니다.`);
 checkMasterFarmerTitle();
}
function checkMasterFarmerTitle(){
 if(state.masterFarmerTitle)return;
 const allGold=Object.keys(SEEDS).every(id=>(state.harvestCounts[id]||0)>=100);
 if(!allGold)return;
 state.masterFarmerTitle=true;
 state.gold+=5000;
 save();
 playSfx("levelup");
 openModal(`<h2>👑 마스터 농부 칭호 획득!</h2><p>12종 작물 전부 100회 이상 수확 — 도감을 완전히 마스터했습니다!</p><div class="share-link-box" style="text-align:center;font-size:20px;">🎁 +5,000G</div>`);
 pushNotification("칭호 획득","🏆 마스터 농부 칭호를 획득했습니다! 도감을 완전히 마스터했습니다.");
}
function openCodex(){
 const total=Object.keys(SEEDS).length*SYS.codexTiers.length;
 let claimedCount=Object.keys(state.codexClaimed).length;
 let html=`<h2>📖 도감</h2><p>씨앗별 누적 수확 횟수에 따라 동/은/금 뱃지를 모아보세요. (${claimedCount}/${total})</p>${state.masterFarmerTitle?'<p style="color:#ffd166;">👑 마스터 농부 칭호 보유 중</p>':""}<div class="shop-grid">`;
 for(const[id,s]of Object.entries(SEEDS)){
   const count=state.harvestCounts[id]||0;
   const badges=SYS.codexTiers.map((t,i)=>{
     const unlocked=count>=t.count;
     return `<span style="opacity:${unlocked?1:.25};" title="${t.name} (${t.count}회)">${t.icon}</span>`;
   }).join(" ");
   html+=`<article class="item"><h3>${s.emoji} ${s.name}</h3><p style="font-size:13px;">${badges}</p><p style="opacity:.75;font-size:12px;">누적 수확 ${count.toLocaleString()}회</p></article>`;
 }
 html+="</div>";
 openModal(html);
}
/* ===================== 설정 패널 (알림 권한 · 환생 · 도전과제 진입점) ===================== */
function openSettingsPanel(){
 const permState=(typeof Notification!=="undefined")?Notification.permission:"unsupported";
 const permLabel=permState==="granted"?"✅ 허용됨":permState==="denied"?"⛔ 거부됨 (브라우저 설정에서 변경 가능)":"🔔 알림 켜기";
 openModal(`<h2>⚙️ 설정</h2><div class="item"><p>낮·밤 자동 전환과 가로 화면 고정이 적용되어 있습니다.</p></div>
   <button type="button" id="notifPermBtn" class="ai-advisor-btn" ${permState==="granted"||permState==="denied"?"disabled":""}>${permLabel}</button>
   <p style="opacity:.65;font-size:12px;margin:6px 0 14px;">브라우저 알림을 켜면 화면을 안 보고 있어도(탭이 열려있는 동안) 작물이 다 자랐을 때·쪽지가 왔을 때 알려드려요.</p>
   <button type="button" id="achievementsBtn" class="ai-advisor-btn" style="background:linear-gradient(135deg,#2a7a4f,#155c36);">🏆 도전과제</button>
   <button type="button" id="prestigeBtn" class="ai-advisor-btn" style="background:linear-gradient(135deg,#7c3aed,#4338ca);margin-top:8px;">🔄 환생</button>`);
 const permBtn=document.getElementById("notifPermBtn");
 if(permBtn)permBtn.addEventListener("click",requestNotifPermission);
 document.getElementById("achievementsBtn").addEventListener("click",openAchievements);
 document.getElementById("prestigeBtn").addEventListener("click",openPrestigePanel);
}
async function requestNotifPermission(){
 if(typeof Notification==="undefined"){toast("이 브라우저는 알림을 지원하지 않습니다.");return}
 try{
   const result=await Notification.requestPermission();
   state.notifPermissionAsked=true;save();
   toast(result==="granted"?"🔔 알림이 켜졌습니다!":"알림이 거부되었습니다.");
   openSettingsPanel();
 }catch{toast("알림 권한 요청에 실패했습니다.")}
}
// 브라우저 알림(탭이 열려있는 동안은 화면을 보고 있지 않아도 전달됨). 서버가 직접 보내는
// 진짜 '앱을 완전히 꺼도 오는' 푸시는 VAPID 키·구독 저장·서버 스케줄러가 추가로 필요해
// 이번 범위에는 포함하지 않았습니다.
function showBrowserNotification(title,body){
 if(typeof Notification==="undefined"||Notification.permission!=="granted")return;
 try{new Notification(title,{body,icon:"./public/assets/ui/icon.png"})}catch{}
}
/* ===================== 환생(전직): 레벨 20 이상부터, 영구 보상 배율 획득 ===================== */
function openPrestigePanel(){
 const canPrestige=state.level>=SYS.prestigeUnlockLevel;
 const currentBonus=Math.round(state.prestigeLevel*SYS.prestigeBonusPerLevel*100);
 const nextBonus=Math.round((state.prestigeLevel+1)*SYS.prestigeBonusPerLevel*100);
 openModal(`<h2>🔄 환생</h2><p>골드·레벨·농장을 초기화하는 대신, 모든 수확 보상에 영구 배율을 얻습니다.</p>
   <div class="item"><p>현재 환생 횟수: <b>${state.prestigeLevel}회</b> (전체 수확 보상 +${currentBonus}%)</p><p>다음 환생 시: +${nextBonus}%</p></div>
   <p style="opacity:.7;font-size:12px;">보유 도구·도감 기록·로그인 정보는 유지됩니다. 골드·레벨·씨앗·밭은 초기화됩니다.</p>
   ${canPrestige?'<button type="button" id="doPrestigeBtn" class="ai-advisor-btn" style="background:linear-gradient(135deg,#7c3aed,#4338ca);">지금 환생하기</button>':`<p style="opacity:.6;">레벨 ${SYS.prestigeUnlockLevel} 이상부터 환생할 수 있습니다. (현재 Lv.${state.level})</p>`}`);
 if(canPrestige)document.getElementById("doPrestigeBtn").addEventListener("click",confirmPrestige);
}
function confirmPrestige(){
 openModal(`<h2>⚠️ 정말 환생하시겠어요?</h2><p>골드·레벨·농장·인벤토리가 전부 초기화됩니다. 이 작업은 되돌릴 수 없습니다.</p>
   <button type="button" id="prestigeYesBtn" class="ai-advisor-btn" style="background:linear-gradient(135deg,#7a2e2e,#4a1717);">네, 환생합니다</button>
   <button type="button" id="prestigeNoBtn" class="ai-advisor-btn" style="margin-top:8px;">취소</button>`);
 document.getElementById("prestigeYesBtn").addEventListener("click",doPrestige);
 document.getElementById("prestigeNoBtn").addEventListener("click",openPrestigePanel);
}
function doPrestige(){
 state.prestigeLevel++;
 state.gold=300;
 state.level=1;
 state.harvest=0;
 state.inventory=Object.fromEntries(Object.keys(SEEDS).map(id=>[id,0]));
 state.farm=Array.from({length:12},()=>({seed:null,plantedAt:0,growMs:0}));
 state.quests=[false,false,false,false];
 save();
 playSfx("levelup");
 openModal(`<h2>🔄 환생 완료!</h2><p>환생 ${state.prestigeLevel}회차를 시작합니다.</p><div class="share-link-box" style="text-align:center;font-size:20px;">전체 수확 보상 +${Math.round(state.prestigeLevel*SYS.prestigeBonusPerLevel*100)}%</div>`);
 checkAchievements();
}
/* ===================== 도전과제(업적) ===================== */
async function getFavoriteCount(){
 const acc=getAccount();
 if(!acc)return 0;
 try{
   const res=await fetch(`./api/favorites/list?userId=${encodeURIComponent(acc.id)}`);
   const data=await res.json();
   return data.ok?data.favorites.length:0;
 }catch{return 0}
}
async function checkAchievements(){
 const favCount=await getFavoriteCount();
 let newlyClaimed=[];
 for(const a of SYS.achievements){
   if(state.achievementsClaimed[a.id])continue;
   const passed=a.needsFavCount?a.check(state,favCount):a.check(state);
   if(passed){
     state.achievementsClaimed[a.id]=true;
     state.gold+=a.bonus;
     newlyClaimed.push(a);
   }
 }
 if(newlyClaimed.length){
   save();
   playSfx("badge");
   newlyClaimed.forEach(a=>pushNotification("도전과제 달성",`${a.icon} ${a.name} 달성! +${a.bonus.toLocaleString()}G`));
   toast(`🏆 도전과제 달성! ${newlyClaimed.map(a=>a.icon).join(" ")}`);
 }
}
function openAchievements(){
 const claimedCount=Object.keys(state.achievementsClaimed).length;
 let html=`<h2>🏆 도전과제 (${claimedCount}/${SYS.achievements.length})</h2><div class="shop-grid">`;
 SYS.achievements.forEach(a=>{
   const done=Boolean(state.achievementsClaimed[a.id]);
   html+=`<article class="item"><h3 style="opacity:${done?1:.4};">${a.icon} ${a.name}</h3><p style="font-size:12px;opacity:.75;">${a.desc}</p><p style="font-size:12px;color:${done?"#8fe0ff":"#889"};">${done?"✅ 달성 완료":"미달성"}</p></article>`;
 });
 html+="</div>";
 openModal(html);
 checkAchievements(); // 패널을 열 때마다 최신 진행 상황 재확인 (즐겨찾기 수 등 서버 값 반영)
}
function petAutoHarvestTick(){
 if(!state.upgrades.pet)return;
 let total=0,count=0;
 state.farm.forEach((f,i)=>{if(f.seed&&plotGrowth(i).ready){const r=harvestPlot(i);if(r){total+=r;count++}}});
 if(count)toast(`🐶 수확도우미가 ${count}개 작물을 자동 수확 · +${total.toLocaleString()}G`);
}
async function serverNow(){try{const r=await fetch("./api/time");if(r.ok)return(await r.json()).now}catch{}return Date.now()}
let timeOffset=0;
async function syncTimeOffset(){
 const before=Date.now();
 const serverTime=await serverNow();
 const after=Date.now();
 // 왕복 시간이 너무 크면(네트워크 지연) 이번 보정은 건너뜀 -- 부정확한 오프셋을 반영하지 않기 위함
 if(after-before>3000)return;
 timeOffset=serverTime-Date.now();
}
// 심을 때는 서버 시간을 기록하지만, 이후 진행률 체크는 전부 기기의 로컬 시계에 의존했기 때문에
// 오랜 플레이 중 기기 시계가 자동 보정(NTP 동기화, 시간대 변경 등)되면 실제 경과시간과 어긋나
// "플레이하다 보면 생기는" 즉시수확 현상이 나타날 수 있었음. gameNow()는 주기적으로 재보정되는
// 오프셋을 적용해, 로컬 시계가 흔들려도 성장 계산이 일관되게 유지되도록 함
function gameNow(){return Date.now()+timeOffset}
async function plant(i,id){state.inventory[id]--;let growMultiplier=1;if(state.upgrades.water)growMultiplier*=0.8;if(state.upgrades.fertilizer)growMultiplier*=0.9;const growMs=Math.round(SEEDS[id].grow*growMultiplier);state.farm[i]={seed:id,plantedAt:await serverNow(),growMs};state.quests[2]=true;closeModal();save();playSfx("plant");scheduleCropReadyNotification(id,growMs)}
// 브라우저 알림(탭이 열려있는 동안만 동작 -- 완전히 앱을 꺼도 오는 서버 푸시는 별도 인프라 필요)
function scheduleCropReadyNotification(seedId,growMs){
 setTimeout(()=>{
   const s=SEEDS[seedId];
   showBrowserNotification("🌾 수확할 시간이에요!",`${s.emoji} ${s.name}이(가) 다 자랐습니다. 게임으로 돌아와 수확해보세요!`);
 },growMs);
}
function updateUI(near){ui("goldText").textContent=state.gold.toLocaleString();ui("seedText").textContent=Object.values(state.inventory).reduce((a,b)=>a+(Number(b)||0),0).toLocaleString();ui("harvestText").textContent=state.harvest.toLocaleString();ui("levelText").textContent=state.level.toLocaleString();ui("heroName").textContent=CHARS[state.character].name;ui("portrait").src=CHAR_BASE+CHARS[state.character].img;ui("regionText").textContent=near?near.label:(state.player.x>66?"주말농장 지구":"네온 중앙지구");const labels=["회사 본부에서 업무 수행","씨앗상점에서 씨앗 구매","주말농장에 씨앗 심기","다 자란 작물 수확"];ui("questList").innerHTML=labels.map((x,i)=>`<li class="${state.quests[i]?"done":""}">${x} ${state.quests[i]?"1/1":"0/1"}</li>`).join("");ui("inventoryPreview").innerHTML=Object.entries(SEEDS).map(([id,s])=>`<span>${s.emoji}<small>${(state.inventory[id]||0).toLocaleString()}</small></span>`).join("")}
/* ===================== 효과음 (Web Audio API로 직접 생성, 별도 파일 불필요) ===================== */
let audioCtx=null;
function getAudioCtx(){
 if(!audioCtx){try{audioCtx=new(window.AudioContext||window.webkitAudioContext)()}catch{}}
 return audioCtx;
}
function playTone(freq,duration,type,startDelay,gainPeak){
 const ctx=getAudioCtx();
 if(!ctx)return;
 const t0=ctx.currentTime+(startDelay||0);
 const osc=ctx.createOscillator(),gain=ctx.createGain();
 osc.type=type||"sine";
 osc.frequency.setValueAtTime(freq,t0);
 gain.gain.setValueAtTime(0,t0);
 gain.gain.linearRampToValueAtTime(gainPeak||0.15,t0+0.02);
 gain.gain.exponentialRampToValueAtTime(0.001,t0+duration);
 osc.connect(gain);gain.connect(ctx.destination);
 osc.start(t0);osc.stop(t0+duration+0.05);
}
function playSfx(name){
 switch(name){
   case"harvest":playTone(660,.12,"sine",0);playTone(880,.15,"sine",.08);break;
   case"buy":playTone(520,.08,"square",0);break;
   case"plant":playTone(440,.08,"triangle",0);break;
   case"levelup":playTone(523,.12,"sine",0);playTone(659,.12,"sine",.12);playTone(784,.2,"sine",.24);break;
   case"success":playTone(700,.1,"sine",0);playTone(900,.15,"sine",.1);break;
   case"fail":playTone(220,.25,"sawtooth",0);break;
   case"notify":playTone(880,.08,"sine",0);break;
   case"gameover":playTone(200,.3,"sawtooth",0);playTone(150,.4,"sawtooth",.25);break;
   case"jackpot":playTone(523,.1,"sine",0);playTone(659,.1,"sine",.08);playTone(784,.1,"sine",.16);playTone(1047,.25,"sine",.24);break;
   case"badge":playTone(784,.1,"sine",0);playTone(1047,.2,"sine",.1);break;
 }
}
let activeMinigameCleanup=null;
function openModal(html){if(activeMinigameCleanup){activeMinigameCleanup();activeMinigameCleanup=null}ui("modalBody").innerHTML=html;ui("modal").classList.add("show")}function closeModal(){if(activeMinigameCleanup){activeMinigameCleanup();activeMinigameCleanup=null}ui("modal").classList.remove("show")}function toast(t){ui("toast").textContent=t;ui("toast").classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>ui("toast").classList.remove("show"),1700)}
function save(){localStorage.setItem("komscoExactMapFullscreenRouteV9",JSON.stringify(state))}
function load(){
 try{
   const v=JSON.parse(localStorage.getItem("komscoExactMapFullscreenRouteV9"));
   if(v){
     const fresh=SYS.newState();
     state=Object.assign(fresh,v);
     // Object.assign above is shallow -- an older save's smaller inventory/upgrades objects
     // would otherwise wholesale-replace the new defaults and drop newly-added keys
     // (e.g. old 3-seed saves losing the other 9 seed types added later). Merge these
     // nested objects key-by-key instead so old saves gain new fields rather than lose them.
     state.inventory=Object.assign({},fresh.inventory,v.inventory||{});
     state.upgrades=Object.assign({},fresh.upgrades,v.upgrades||{});
     state.missionIndex=Object.assign({},fresh.missionIndex,v.missionIndex||{});
     state.institutionThreats=Object.assign({},v.institutionThreats||{});
     state.harvestCounts=Object.assign({},fresh.harvestCounts,v.harvestCounts||{});
     state.codexClaimed=Object.assign({},v.codexClaimed||{});
     state.lastCheerSentDate=Object.assign({},v.lastCheerSentDate||{});
     state.stats=Object.assign({},fresh.stats,v.stats||{});
     state.achievementsClaimed=Object.assign({},v.achievementsClaimed||{});
     // 방어적 정리: 어떤 이유로든 개수가 NaN/undefined/음수가 되면 구매한 씨앗이 "사라진"
     // 것처럼 보일 수 있으므로, 항상 0 이상의 정수로 되돌림
     for(const id of Object.keys(fresh.inventory)){
       const n=Number(state.inventory[id]);
       state.inventory[id]=Number.isFinite(n)&&n>0?Math.floor(n):0;
     }
     for(const id of Object.keys(fresh.harvestCounts)){
       const n=Number(state.harvestCounts[id]);
       state.harvestCounts[id]=Number.isFinite(n)&&n>0?Math.floor(n):0;
     }
   }
 }catch(error){
   console.warn("저장 데이터 복구 실패",error);
   state=SYS.newState();
 }
 if(!state.player||!Number.isFinite(state.player.x)||!Number.isFinite(state.player.y)){
   state=SYS.newState();
 }
 if(!CHARS[state.character])state.character="hunmin"; // 손상된 저장 데이터로 유효하지 않은 캐릭터가 저장되어 있으면 전체 크래시로 이어질 수 있어 방어
 const q=PATH.nearestRoad(WORLD,state.player.x,state.player.y);
 state.player.x=q.x;
 state.player.y=q.y;
 state.player.dir=state.player.dir||1;
 state.player.dirLerp=state.player.dir;
 if(!state.player.speed||state.player.speed<17)state.player.speed=17; // migrate pre-v12 saves to the RUN-removal baseline speed
}
function buildCards(){const desc={hunmin:"업무와 농장 성장이 균형 잡힌 전략가",daim:"업무 골드 보상이 20% 증가하는 탐색관",sunsik:"이동 속도가 15% 빠른 호위무사"};ui("characterCards").innerHTML=Object.entries(CHARS).map(([id,c])=>`<article class="character-card" data-char="${id}"><img src="${CHAR_BASE+c.img}" alt="${c.name}"><div class=card-copy><h3>${c.name}</h3><b>${c.role}</b><p>${desc[id]}</p></div></article>`).join("");document.querySelectorAll("[data-char]").forEach(card=>card.addEventListener("click",()=>{selected=card.dataset.char;document.querySelectorAll("[data-char]").forEach(x=>x.classList.toggle("selected",x===card));ui("startBtn").disabled=false}))}
// ---- Unified pointer-driven virtual joystick -------------------------------------------------
// A single implementation covers both control schemes via the Pointer Events API (which unifies
// touch/mouse/pen):
//  - Smartphone: finger touch-and-drag directly on the game screen.
//  - PC: mouse click-and-drag (keyboard arrow keys / WASD keep working too, handled in update()).
// The joystick graphic appears at the exact point the drag started, then a thumb follows the
// drag within a clamped radius. It only arms when the press lands directly on the canvas -- any
// tap that hits a button/panel layered on top never gets hijacked into a movement drag.
//
// IMPORTANT -- stuck-input hardening:
// pointerdown only arms a new drag when `joystickPointerId` is null, so that a second finger (or
// a stray event) can't hijack an in-progress drag. That guard is only safe if we can GUARANTEE
// `joystickPointerId` always gets cleared again. In practice a real device's "the drag ended"
// event can go missing in several ways -- a mission modal opening mid-drag, an orientation
// change, the OS interrupting the gesture, the tab losing focus while a finger is still down --
// and if that happens with only a single pointerup/pointercancel listener on the canvas, the
// pointer id is orphaned forever and every touch/click after that is silently ignored (looks
// exactly like "movement stops responding after playing for a while"). Several independent
// recovery paths below all funnel into the same joystickHide() so any one of them is enough to
// unstick things.
let joystickPointerId=null;
const joystickOrigin={x:0,y:0};
const JOY_RADIUS=52; // px of drag before the input vector is fully saturated (magnitude 1)
const JOY_DEADZONE=8; // px -- ignores tiny jitter right around the press point
function joystickShow(x,y){
 const el=ui("virtualJoystick");
 if(!el)return;
 el.style.left=`${x}px`;el.style.top=`${y}px`;
 el.classList.add("active");
 const thumb=ui("joystickThumb");
 if(thumb)thumb.style.transform="translate(0px,0px)";
}
function joystickHide(){
 try{if(joystickPointerId!==null)canvas.releasePointerCapture?.(joystickPointerId)}catch{} // no-op if already released/invalid
 ui("virtualJoystick")?.classList.remove("active");
 joystickVec.x=0;joystickVec.y=0;
 joystickPointerId=null;
}
// Runs every animation frame (called from loop()). A held-still joystick can legitimately go a
// long time with zero pointermove events, so we don't use a timeout to detect a stuck drag --
// instead we ask the browser directly whether the canvas still actually holds capture for this
// pointer. If it doesn't (silently dropped -- see comment above bindJoystick), release instantly.
// This can never misfire on a real, steady, still-held press, only on a genuinely lost capture.
function joystickWatchdogTick(){
 if(joystickPointerId===null)return;
 if(canvas.hasPointerCapture&&!canvas.hasPointerCapture(joystickPointerId))joystickHide();
}
function bindJoystick(){
 if(!canvas)return;
 canvas.addEventListener("pointerdown",e=>{
   if(!started)return; // don't arm during loading/character-select, before gameplay actually begins
   if(e.target!==canvas)return; // never steal a tap that landed on a UI element above the canvas
   if(joystickPointerId!==null)return; // ignore extra fingers/buttons while a drag is already active
   if(autoPath.length){autoPath=[];currentEdge=null;setAutoActive(false)} // manual input takes over instantly, no stale route/edge
   joystickPointerId=e.pointerId;
   joystickOrigin.x=e.clientX;joystickOrigin.y=e.clientY;
   canvas.setPointerCapture?.(e.pointerId);
   joystickShow(e.clientX,e.clientY);
   e.preventDefault();
 });
 canvas.addEventListener("pointermove",e=>{
   if(e.pointerId!==joystickPointerId)return;
   let dx=e.clientX-joystickOrigin.x,dy=e.clientY-joystickOrigin.y;
   const dist=Math.hypot(dx,dy)||1;
   const clamped=Math.min(dist,JOY_RADIUS);
   dx=dx/dist*clamped;dy=dy/dist*clamped;
   const thumb=ui("joystickThumb");
   if(thumb)thumb.style.transform=`translate(${dx}px,${dy}px)`;
   if(clamped<JOY_DEADZONE){joystickVec.x=0;joystickVec.y=0}
   else{joystickVec.x=dx/JOY_RADIUS;joystickVec.y=dy/JOY_RADIUS}
   e.preventDefault();
 });
 const endDrag=e=>{if(e.pointerId===joystickPointerId)joystickHide()};
 canvas.addEventListener("pointerup",endDrag);
 canvas.addEventListener("pointercancel",endDrag);
 canvas.addEventListener("pointerleave",endDrag);
 // The canvas is the pointer-capture target, so this is the listener that actually catches a
 // capture being silently dropped by the browser without a matching pointerup/pointercancel --
 // this is the single most important line for not getting permanently stuck (see comment above).
 canvas.addEventListener("lostpointercapture",endDrag);
 // Belt-and-suspenders: if the release event somehow fires on a different target than the
 // canvas (observed on some mobile browsers once another element -- e.g. a modal -- has been
 // shown on top mid-drag), catch it at the window level too.
 addEventListener("pointerup",endDrag);
 addEventListener("pointercancel",endDrag);
 // A modal (mission popup, shop, etc.) can legitimately open while a finger is still down; force
 // a clean release the moment it appears so the drag can never "leak" input into it, and so the
 // next tap always starts from a known-good state.
 const modalObserver=new MutationObserver(()=>{if(joystickPointerId!==null&&ui("modal")?.classList.contains("show"))joystickHide()});
 if(ui("modal"))modalObserver.observe(ui("modal"),{attributes:true,attributeFilter:["class"]});
 // Backgrounding the tab/app (notification, app switch, screen lock) never guarantees a pointerup
 // for a finger that was down at the time -- reset on the way out so nothing is left stuck when
 // the player comes back.
 addEventListener("blur",joystickHide);
 document.addEventListener("visibilitychange",()=>{if(document.hidden)joystickHide()});
}
addEventListener("contextmenu",e=>e.preventDefault());
addEventListener("selectstart",e=>e.preventDefault());
addEventListener("copy",e=>e.preventDefault());
const MOVE_KEYS=new Set(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","w","a","s","d"]);
addEventListener("resize",resize);
addEventListener("orientationchange",()=>{
  // iOS/Android often report stale innerWidth/innerHeight the instant orientationchange fires;
  // re-measure shortly after the browser finishes its own layout pass so the dpad/HUD realign correctly.
  clearTimeout(resizeSettleTimer);
  resizeSettleTimer=setTimeout(resize,120);
});
if(window.visualViewport){
  // Fires specifically when a mobile browser's address bar/toolbar shows or hides, changing
  // the truly-visible viewport -- a plain window 'resize' event doesn't always fire for this,
  // which could leave the dpad positioned against a stale (too-small or too-large) measurement
  // until some other event happened to trigger a recompute.
  visualViewport.addEventListener("resize",resize);
  visualViewport.addEventListener("scroll",resize);
}
addEventListener("keydown",e=>{
  const typingInField=e.target&&(e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA");
  if(typingInField)return; // 로그인/검색/채팅 등 입력창에 타이핑 중일 땐 게임 단축키(이동, 상호작용)를 막음
  keys[e.key]=true;
  if(MOVE_KEYS.has(e.key)&&autoPath.length){autoPath=[];currentEdge=null;setAutoActive(false)}
  if(e.key==="e"||e.key==="Enter")interact()
});
addEventListener("keyup",e=>keys[e.key]=false);
function resetAllKeys(){for(const k in keys)keys[k]=false}
addEventListener("blur",resetAllKeys);
document.addEventListener("visibilitychange",()=>{if(document.hidden)resetAllKeys()});
bindJoystick();
ui("interactBtn").addEventListener("click",interact);
ui("autoBtn").addEventListener("click",()=>{
 if(autoPath.length){ // tap again to cancel an in-progress route
   autoPath=[];currentEdge=null;setAutoActive(false);toast("자동 이동을 취소했습니다.");return;
 }
 const h=WORLD.hotspots.reduce((a,b)=>Math.hypot(state.player.x-a.x,state.player.y-a.y)<Math.hypot(state.player.x-b.x,state.player.y-b.y)?a:b);
 startAuto(h);
});
ui("rankingBtn").addEventListener("click",openRankingPanel);ui("codexBtn").addEventListener("click",openCodex);ui("settingsBtn").addEventListener("click",openSettingsPanel);ui("notifBtn").addEventListener("click",openNotifPanel);ui("shareBtn").addEventListener("click",shareGame);ui("communityBtn").addEventListener("click",openCommunityPanel);
ui("menuBtn").addEventListener("click",()=>{const drawer=ui("utilityDrawer");const opening=!drawer.classList.contains("open");drawer.classList.toggle("open",opening);drawer.setAttribute("aria-hidden",String(!opening));const preview=ui("drawerMapPreview");if(preview)preview.src=isDay()?DAY:NIGHT;const quest=ui("questPanel");if(quest)quest.hidden=!opening;});ui("drawerClose").addEventListener("click",()=>{ui("utilityDrawer").classList.remove("open");ui("utilityDrawer").setAttribute("aria-hidden","true");const quest=ui("questPanel");if(quest)quest.hidden=true;});ui("shopShortcut").addEventListener("click",openShop);
ui("questCollapse").addEventListener("click",()=>ui("questPanel").classList.toggle("collapsed"));ui("claimRewardBtn").addEventListener("click",()=>{if(state.quests.every(Boolean)){state.gold+=500;state.quests=[false,false,false,false];save();toast("일일 보상 +500G")}else toast("모든 미션을 완료하세요.")});ui("modalClose").addEventListener("click",closeModal);ui("modal").addEventListener("click",e=>{if(e.target===ui("modal"))closeModal()});
ui("startBtn").addEventListener("click",async()=>{state.character=selected;started=true;ui("characterSelect").classList.remove("show");await KOMSCO.Orientation.lockLandscape();save();if(!state.tutorialDone)showTutorial();else{checkDailyAttendance();toast(`${CHARS[selected].name}과 함께 시작합니다.`)}});
function showTutorial(){
 const steps=[
   {title:"👋 환영합니다!",body:"KOMSCO 네온팜 시티에 오신 것을 환영합니다. 몇 가지만 빠르게 안내해드릴게요."},
   {title:"🕹️ 이동하기",body:"화면을 터치(PC는 마우스 클릭)한 채로 드래그하면 그 방향으로 이동하고, 키보드 방향키/WASD로도 이동할 수 있어요. 왼쪽 아래 AUTO 버튼을 누르면 가까운 건물까지 자동으로 이동합니다."},
   {title:"🏢 상호작용", body:"건물이나 시설 근처에 가면 오른쪽 아래 '상호작용' 버튼이 활성화됩니다. 눌러서 업무를 수행하거나 씨앗을 심어보세요."},
   {title:"🌱 씨앗상점 & 주말농장", body:"씨앗상점에서 씨앗을 구매하고, 주말농장의 빈 밭에 심어 키운 뒤 다 자라면 수확해 골드를 얻으세요."},
   {title:"📅 매일 접속하세요", body:"매일 접속하면 출석 보상을 받을 수 있고, 오늘의 미션을 모두 완료하면 퀘스트 패널에서 추가 보상도 받을 수 있어요. 즐거운 플레이 되세요!"}
 ];
 let idx=0;
 function render(){
   const s=steps[idx];
   const isLast=idx===steps.length-1;
   openModal(`<h2>${s.title}</h2><p>${s.body}</p><button type="button" id="tutorialNextBtn" class="ai-advisor-btn">${isLast?"시작하기":"다음"}</button><p style="text-align:center;opacity:.6;font-size:12px;margin-top:8px;">${idx+1} / ${steps.length}</p>`);
   document.getElementById("tutorialNextBtn").addEventListener("click",()=>{
     if(isLast){state.tutorialDone=true;save();closeModal();checkDailyAttendance();toast(`${CHARS[state.character].name}과 함께 시작합니다.`)}
     else{idx++;render()}
   });
 }
 render();
}

function showFatal(error,source="",line=0,column=0){
 console.error("[KOMSCO Runtime Error]",error,source,line,column);
 const panel=ui("fatalError"),message=ui("fatalMessage");
 const detail=error?.stack||error?.message||String(error||"알 수 없는 오류");
 const location=source?`\n${source}:${line}:${column}`:"";
 if(message)message.textContent=`${detail}${location}`;
 panel?.classList.add("show");
 ui("loading")?.classList.remove("show");
}
ui("fatalReload")?.addEventListener("click",()=>{
 if("serviceWorker"in navigator){
   navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.map(r=>r.unregister()))).finally(()=>location.reload());
 }else location.reload();
});
window.addEventListener("error",e=>showFatal(e.error||e.message,e.filename||"",e.lineno||0,e.colno||0));
window.addEventListener("unhandledrejection",e=>showFatal(e.reason));

let debugOn=new URLSearchParams(location.search).has("debug");
function updateDebugOverlay(){
  const el=ui("debugOverlay");
  if(!el)return;
  el.classList.toggle("show",debugOn);
  if(!debugOn)return;
  const isPortrait=matchMedia("(orientation:portrait)").matches;
  el.textContent=
`orientation: ${isPortrait?"portrait(rotated)":"landscape"}
game W,H: ${W},${H}
player: ${state.player.x.toFixed(2)}, ${state.player.y.toFixed(2)}
joystick vec: ${joystickVec.x.toFixed(2)}, ${joystickVec.y.toFixed(2)} (active: ${joystickPointerId!==null})
keys: ↑${keys.ArrowUp||keys.w?1:0} ↓${keys.ArrowDown||keys.s?1:0} ←${keys.ArrowLeft||keys.a?1:0} →${keys.ArrowRight||keys.d?1:0}
moveAccel: ${moveAccel.toFixed(2)}
autoPath: ${autoPath.length}`;
}
function loop(now){
 const dt=Math.min(.04,Math.max(0,(now-last)/1000));
 last=now;
 if(!document.hidden){update(dt);draw();updateDebugOverlay();joystickWatchdogTick();}
 requestAnimationFrame(loop);
}
document.addEventListener("visibilitychange",()=>{last=performance.now();});
(()=>{
  // Triple-tap the KOMSCO loading logo to toggle the diagnostic overlay on a real device
  // without needing a URL param or dev tools.
  const brand=document.querySelector(".brand");
  if(!brand)return;
  let taps=0,tapTimer=null;
  brand.addEventListener("click",()=>{
    taps++;
    clearTimeout(tapTimer);
    tapTimer=setTimeout(()=>taps=0,600);
    if(taps>=3){debugOn=!debugOn;taps=0;updateDebugOverlay();}
  });
})();
/* ===================== 알림 · 우편함 (2D 버전 참고, localStorage 기반 · 서버 불필요) ===================== */
function recalcLevel(){
 const prev=state.level;
 state.level=1+Math.floor((state.gold+state.harvest*80)/900);
 if(state.level>prev){
   const bonus=state.level*20;
   grantMail(`레벨 업! Lv.${state.level}`,`축하합니다! 레벨 ${state.level}에 도달했습니다.`,bonus);
   pushNotification("레벨 업",`Lv.${state.level} 달성! 우편함에서 보너스를 받아가세요.`);
   playSfx("levelup");
   showConfetti();
 }
}
// 레벨업 시 화면 전체에 색종이 축하 효과 (타격감/폴리시 강화)
function showConfetti(){
 const colors=["#ffd166","#f77f00","#06d6a0","#118ab2","#ef476f"];
 const container=document.createElement("div");
 container.className="confetti-container";
 for(let i=0;i<40;i++){
   const piece=document.createElement("div");
   piece.className="confetti-piece";
   piece.style.left=`${Math.random()*100}%`;
   piece.style.background=colors[Math.floor(Math.random()*colors.length)];
   piece.style.animationDelay=`${Math.random()*0.4}s`;
   piece.style.animationDuration=`${1.2+Math.random()*0.8}s`;
   container.appendChild(piece);
 }
 document.body.appendChild(container);
 setTimeout(()=>container.remove(),2200);
}
/* ===================== 출석체크 (매일 재접속 유인) ===================== */
function todayStr(){const d=new Date();return`${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`}
/* ===================== 행운의 시간 (매일 랜덤한 1시간, 전체 보상 2배) ===================== */
function simpleHash(str){let h=0;for(let i=0;i<str.length;i++){h=(h*31+str.charCodeAt(i))|0}return Math.abs(h)}
function getLuckyHourForToday(){return simpleHash(todayStr())%24}
function isLuckyHourNow(){return new Date().getHours()===getLuckyHourForToday()}
function getLuckyHourMultiplier(){return isLuckyHourNow()?2:1}
let lastLuckyHourBannerState=false;
function updateLuckyHourBanner(){
 const active=isLuckyHourNow();
 if(active===lastLuckyHourBannerState)return;
 lastLuckyHourBannerState=active;
 const banner=ui("luckyHourBanner");
 if(banner)banner.classList.toggle("show",active);
 if(active){
   toast("🍀 행운의 시간! 이번 시간 동안 모든 보상이 2배입니다!");
   pushNotification("행운의 시간","지금부터 1시간 동안 수확·미션 보상이 2배로 지급됩니다!");
 }
}
/* ===================== 주간 특가 작물 (서버 없이 날짜 기반 결정 -- 모든 플레이어가 동일하게 봄) ===================== */
function getIsoWeekNumber(){
 const now=new Date();
 const d=new Date(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()));
 d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
 const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
 return Math.ceil((((d-yearStart)/86400000)+1)/7);
}
function getWeeklyFeaturedSeed(){
 const ids=Object.keys(SEEDS);
 return ids[getIsoWeekNumber()%ids.length];
}
const WEEKLY_EVENT_BONUS=0.2; // 이번 주 특가 작물 수확 보상 +20%
function checkDailyAttendance(){
 const today=todayStr();
 if(state.lastAttendanceDate===today)return; // 오늘 이미 출석함
 const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
 const wasConsecutive=state.lastAttendanceDate===`${yesterday.getFullYear()}-${yesterday.getMonth()+1}-${yesterday.getDate()}`;
 state.attendanceStreak=wasConsecutive?state.attendanceStreak+1:1;
 state.lastAttendanceDate=today;
 const streakDay=Math.min(7,state.attendanceStreak); // 7일 주기로 순환
 const bonus=100*streakDay; // 1일차 100G ~ 7일차 700G
 state.gold+=bonus;
 save();
 flashGold();
 const canOpenBox=state.lastMysteryBoxDate!==today;
 openModal(`<h2>📅 출석체크</h2><p>${state.attendanceStreak}일 연속 출석 중입니다!</p>
   <div class="share-link-box" style="text-align:center;font-size:22px;">🎁 +${bonus.toLocaleString()}G</div>
   <p style="opacity:.7;font-size:12px;">매일 접속하면 7일차까지 보상이 점점 커집니다 (최대 700G, 이후 다시 순환).</p>
   ${canOpenBox?'<button type="button" id="mysteryBoxBtn" class="ai-advisor-btn">🎁 오늘의 미스터리 상자 열기</button>':""}`);
 if(canOpenBox)document.getElementById("mysteryBoxBtn").addEventListener("click",openMysteryBox);
}
// 확률형 보상 손맛 강화: 매일 1회 무료 미스터리 상자 (60% 소액/25% 중간/10% 무료 씨앗/5% 대박)
function openMysteryBox(){
 const today=todayStr();
 if(state.lastMysteryBoxDate===today)return;
 state.lastMysteryBoxDate=today;
 const roll=Math.random();
 let resultHtml,resultToast;
 if(roll<0.05){ // 5% 대박
   const bonus=1000;
   state.gold+=bonus;
   playSfx("jackpot");
   resultHtml=`🎉<br>대박!<br><b>+${bonus.toLocaleString()}G</b>`;
   resultToast=`🎉 미스터리 상자 대박! +${bonus.toLocaleString()}G`;
 }else if(roll<0.15){ // 10% 무료 씨앗
   const unlocked=Object.entries(SEEDS).filter(([id,s])=>state.level>=s.unlock);
   const[id,s]=unlocked[Math.floor(Math.random()*unlocked.length)];
   state.inventory[id]=(state.inventory[id]||0)+1;
   playSfx("badge");
   resultHtml=`${s.emoji}<br>무료 씨앗!<br><b>${s.name} 1개</b>`;
   resultToast=`${s.emoji} 미스터리 상자에서 ${s.name} 씨앗을 받았습니다!`;
 }else if(roll<0.4){ // 25% 중간 보상
   const bonus=200+Math.round(Math.random()*200);
   state.gold+=bonus;
   playSfx("badge");
   resultHtml=`💰<br>행운!<br><b>+${bonus.toLocaleString()}G</b>`;
   resultToast=`💰 미스터리 상자에서 +${bonus.toLocaleString()}G를 받았습니다!`;
 }else{ // 60% 소액
   const bonus=50+Math.round(Math.random()*80);
   state.gold+=bonus;
   resultHtml=`🎁<br><b>+${bonus.toLocaleString()}G</b>`;
   resultToast=`🎁 미스터리 상자에서 +${bonus.toLocaleString()}G를 받았습니다!`;
 }
 save();
 flashGold();
 const el=document.createElement("div");
 el.className="jackpot-flash";
 el.innerHTML=`<div class="jackpot-card">${resultHtml}</div>`;
 document.body.appendChild(el);
 setTimeout(()=>{el.remove();toast(resultToast)},1400);
 closeModal();
}
const NOTIF_KEY="komscoNotifV1",MAIL_KEY="komscoMailV1";
function loadList(key){try{return JSON.parse(localStorage.getItem(key)||"[]")}catch{return[]}}
function saveList(key,list){try{localStorage.setItem(key,JSON.stringify(list))}catch{}}
function pushNotification(title,body){
 const list=loadList(NOTIF_KEY);
 list.unshift({id:"n"+Date.now()+Math.random().toString(36).slice(2,6),title,body,ts:Date.now(),read:false});
 saveList(NOTIF_KEY,list.slice(0,40));
 updateNotifBadge();
 playSfx("notify");
 showBrowserNotification(title,body);
}
function grantMail(title,body,gold){
 const list=loadList(MAIL_KEY);
 list.unshift({id:"m"+Date.now()+Math.random().toString(36).slice(2,6),title,body,gold,ts:Date.now(),claimed:false});
 saveList(MAIL_KEY,list.slice(0,40));
 updateNotifBadge();
}
function updateNotifBadge(){
 const badge=ui("notifBadge");if(!badge)return;
 const unread=loadList(NOTIF_KEY).filter(n=>!n.read).length;
 const unclaimed=loadList(MAIL_KEY).filter(m=>!m.claimed).length;
 const total=unread+unclaimed;
 badge.textContent=total>99?"99+":total;
 badge.classList.toggle("show",total>0);
}
function openNotifPanel(){
 stopBellRing(); // 🔔 벨을 눌러 알림 패널을 여는 것만으로도 깜빡임은 꺼짐
 const notifs=loadList(NOTIF_KEY),mail=loadList(MAIL_KEY);
 let html="<h2>🔔 알림</h2>";
 html+=notifs.length?notifs.map(n=>n.dm
   ?`<div class="item notif-clickable" data-notif-dm="${n.dm.otherId}" data-notif-dm-nick="${n.dm.nickname}"><b>${n.title}</b><p>${n.body}</p></div>`
   :`<div class="item"><b>${n.title}</b><p>${n.body}</p></div>`).join(""):"<p>아직 알림이 없습니다.</p>";
 html+="<h2>📮 우편함</h2>";
 html+=mail.length?mail.map(m=>`<div class="item"><b>${m.title}</b><p>${m.body}</p><button type="button" data-mail="${m.id}" ${m.claimed?"disabled":""}>${m.claimed?"✅ 수령 완료":`💰 ${m.gold.toLocaleString()}G 받기`}</button></div>`).join(""):"<p>받은 우편이 없습니다.</p>";
 openModal(html);
 document.querySelectorAll("[data-mail]").forEach(b=>b.addEventListener("click",()=>claimMail(b.dataset.mail)));
 document.querySelectorAll("[data-notif-dm]").forEach(el=>el.addEventListener("click",()=>openDmThread(el.dataset.notifDm,el.dataset.notifDmNick)));
 notifs.forEach(n=>n.read=true);saveList(NOTIF_KEY,notifs);
 updateNotifBadge();
}
function claimMail(id){
 const list=loadList(MAIL_KEY);const mail=list.find(m=>m.id===id);
 if(!mail||mail.claimed)return;
 mail.claimed=true;saveList(MAIL_KEY,list);
 state.gold+=mail.gold;save();
 toast(`우편함에서 ${mail.gold.toLocaleString()}G를 받았습니다.`);
 openNotifPanel();
}
/* ===================== 커뮤니티 기반: 로그인 + 접속 상태 (1단계) =====================
   전체 커뮤니티 기능(1:1 쪽지, 즐겨찾기, 검색)의 전제조건이 되는 기반 단계만 구현합니다.
   로그인(이메일+닉네임) → 서버가 사용자 식별 → 20초마다 하트비트로 '접속 중' 갱신 →
   현재 접속 중인 다른 사용자 목록을 볼 수 있음. 쪽지/즐겨찾기/검색은 다음 단계에서 추가. */
const ACCOUNT_KEY="komscoAccountV1";
let heartbeatTimer=null;
function getAccount(){try{return JSON.parse(localStorage.getItem(ACCOUNT_KEY))}catch{return null}}
function setAccount(acc){try{localStorage.setItem(ACCOUNT_KEY,JSON.stringify(acc))}catch{}}
function clearAccount(){try{localStorage.removeItem(ACCOUNT_KEY)}catch{}}

async function doLogin(email,nickname){
 try{
   const res=await fetch("./api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,nickname})});
   const data=await res.json();
   if(!data.ok){toast(data.error||"로그인에 실패했습니다.");return false}
   setAccount(data.user);
   startHeartbeat();
   updateCommunityBtnStyle();
   toast(`${escapeHtml(data.user.nickname)}님, 환영합니다!`);
   return true;
 }catch{
   toast("서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
   return false;
 }
}
function doLogout(){
 clearAccount();
 if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null}
 updateCommunityBtnStyle();
 toast("로그아웃되었습니다.");
}
function updateCommunityBtnStyle(){
 const btn=ui("communityBtn");
 if(btn)btn.classList.toggle("logged-in",Boolean(getAccount()));
}
// 소셜로그인 콜백에서 돌아왔을 때(?logintoken=... 또는 ?loginerror=...) 처리
async function handleSocialLoginReturn(){
 const params=new URLSearchParams(location.search);
 const token=params.get("logintoken");
 const loginError=params.get("loginerror");
 if(!token&&!loginError)return;
 history.replaceState(null,"",location.pathname); // 토큰이 주소창/방문기록에 남지 않도록 즉시 정리
 if(loginError){toast(loginError);return}
 try{
   const res=await fetch("./api/auth/exchange",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});
   const data=await res.json();
   if(!data.ok){toast(data.error||"로그인에 실패했습니다.");return}
   setAccount(data.user);
   startHeartbeat();
   updateCommunityBtnStyle();
   toast(`${escapeHtml(data.user.nickname)}님, 환영합니다!`);
   openCommunityPanel();
 }catch{
   toast("로그인 처리 중 서버에 연결할 수 없습니다.");
 }
}
async function sendHeartbeat(){
 const acc=getAccount();
 if(!acc)return;
 try{
   const res=await fetch("./api/presence/heartbeat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:acc.id})});
   const data=await res.json();
   if(!data.ok&&res.status===404){
     // 서버에 더 이상 존재하지 않는 계정(예: DB 초기화) -- 로컬에 남은 옛 로그인 정보 정리
     clearAccount();
     if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null}
     return;
   }
   if(data.ok&&Array.isArray(data.unreadDms))checkDmNotifications(data.unreadDms);
   if(data.ok&&Array.isArray(data.cheersReceived)&&data.cheersReceived.length){
     data.cheersReceived.forEach(c=>{
       grantMail("🎉 친구 응원 도착!",`${c.senderNickname||"친구"}님이 응원을 보냈습니다.`,80);
       pushNotification("친구 응원",`${c.senderNickname||"친구"}님이 응원을 보내주셨어요! 우편함에서 확인하세요.`);
     });
   }
 }catch{} // 네트워크 문제로 하트비트가 실패해도 게임 플레이에는 영향 없음
 submitRanking(); // 같은 20초 주기에 랭킹 점수도 함께 갱신
}
async function submitRanking(){
 const acc=getAccount();
 if(!acc)return;
 const score=state.gold+state.harvest*100+state.level*1000;
 try{
   await fetch("./api/ranking-submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:acc.id,score,level:state.level,harvest:state.harvest})});
 }catch{}
}
async function openRankingPanel(){
 const myScore=state.gold+state.harvest*100+state.level*1000;
 const acc=getAccount();
 openModal(`<h2>🏆 랭킹</h2><div class="item"><b>내 점수</b><p>${myScore.toLocaleString()}</p></div><div id="rankingListBox"><p style="opacity:.7;">불러오는 중...</p></div>`);
 if(!acc){
   const box=document.getElementById("rankingListBox");
   if(box)box.innerHTML="<p style='opacity:.7;'>커뮤니티에 로그인하면 전체 랭킹을 볼 수 있습니다.</p>";
   return;
 }
 await submitRanking(); // 랭킹을 열어보는 시점에도 최신 점수를 바로 반영
 try{
   const res=await fetch("./api/ranking");
   const data=await res.json();
   const box=document.getElementById("rankingListBox");
   if(!box)return;
   const list=data.ok?data.ranking:[];
   if(!list.length){box.innerHTML="<p style='opacity:.7;'>아직 랭킹 데이터가 없습니다.</p>";return}
   box.innerHTML="<div class='shop-grid'>"+list.map((r,i)=>`<article class="item"><p>${i+1}위 · ${escapeHtml(r.nickname||"조폐 히어로")}${r.user_id===acc.id?" (나)":""}</p><p style="opacity:.75;font-size:12px;">Lv.${Number(r.level).toLocaleString()} · ${Number(r.score).toLocaleString()}점</p></article>`).join("")+"</div>";
 }catch{
   const box=document.getElementById("rankingListBox");
   if(box)box.innerHTML="<p style='opacity:.7;'>랭킹을 불러오지 못했습니다.</p>";
 }
}
function startHeartbeat(){
 if(heartbeatTimer)return;
 sendHeartbeat();
 heartbeatTimer=setInterval(sendHeartbeat,20000);
}
async function fetchOnlineUsers(){
 try{
   const res=await fetch("./api/presence/online");
   const data=await res.json();
   return data.ok?data.online:[];
 }catch{return[]}
}
let myFavoriteIds=new Set();
async function refreshFavoriteIds(){
 const acc=getAccount();if(!acc)return;
 try{
   const res=await fetch(`./api/favorites/list?userId=${encodeURIComponent(acc.id)}`);
   const data=await res.json();
   myFavoriteIds=new Set(data.ok?data.favorites.map(f=>f.id):[]);
 }catch{}
}
async function toggleFavorite(targetId){
 const acc=getAccount();if(!acc)return;
 try{
   const res=await fetch("./api/favorites/toggle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:acc.id,targetId})});
   const data=await res.json();
   if(data.ok){
     if(data.favorited)myFavoriteIds.add(targetId);else myFavoriteIds.delete(targetId);
     // 지금 보고 있는 탭이 접속자든 연락처든 바로 갱신
     if(communityActiveTab==="online")await renderOnlineTab();else await renderContactsTab();
   }
 }catch{toast("즐겨찾기 처리에 실패했습니다.")}
}
// 접속자/검색결과/즐겨찾기/최근대화 어디서든 동일한 형태(온라인 표시·레벨·⭐·✉️)로 렌더링
function userRowHtml(u){
 const online=u.is_online===undefined?true:Boolean(u.is_online); // 접속자 목록에서 온 경우 이미 온라인임이 자명
 const favorited=myFavoriteIds.has(u.id);
 const levelHtml=(u.level!=null)?`<span style="opacity:.7;font-size:12px;"> · Lv.${u.level}</span>`:"";
 const cheeredToday=state.lastCheerSentDate[u.id]===todayStr();
 return `<article class="item"><p>${online?"🟢":"⚫"} ${escapeHtml(u.nickname)}${levelHtml}</p>
   <div style="display:flex;gap:6px;">
     <button type="button" data-fav-user="${u.id}">${favorited?"⭐":"☆"}</button>
     <button type="button" data-dm-user="${u.id}" data-dm-nick="${escapeHtml(u.nickname)}">✉️</button>
     <button type="button" data-cheer-user="${u.id}" data-cheer-nick="${escapeHtml(u.nickname)}" ${cheeredToday?"disabled":""}>${cheeredToday?"✅":"🎉"}</button>
   </div></article>`;
}
function wireUserRows(container){
 container.querySelectorAll("[data-fav-user]").forEach(b=>b.addEventListener("click",()=>toggleFavorite(b.dataset.favUser)));
 container.querySelectorAll("[data-dm-user]").forEach(b=>b.addEventListener("click",()=>openDmThread(b.dataset.dmUser,b.dataset.dmNick)));
 container.querySelectorAll("[data-cheer-user]:not(:disabled)").forEach(b=>b.addEventListener("click",()=>sendCheer(b.dataset.cheerUser,b.dataset.cheerNick)));
}
// 친구 응원하기: 하루 1명당 1회, 보내는 사람에게 소액 보상 + 받는 사람에게는 다음 하트비트에서 우편 전달
async function sendCheer(targetId,targetNick){
 const acc=getAccount();
 if(!acc){toast("로그인이 필요합니다.");return}
 try{
   const res=await fetch("./api/cheer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({senderId:acc.id,recipientId:targetId})});
   const data=await res.json();
   if(!data.ok){toast(data.error||"응원에 실패했습니다.");return}
   state.lastCheerSentDate[targetId]=todayStr();
   state.gold+=50;
   save();
   flashGold();
   toast(`🎉 ${targetNick}님을 응원했습니다! +50G`);
   if(communityActiveTab==="online")await renderOnlineTab();else await renderContactsTab();
 }catch{toast("응원에 실패했습니다. 다시 시도해주세요.")}
}
let communityActiveTab="online";
async function openCommunityPanel(tab){
 const acc=getAccount();
 if(!acc){
   openModal(`<h2>👥 커뮤니티</h2><p>커뮤니티 기능을 사용하려면 먼저 로그인해주세요.</p>
     <div class="share-grid" style="margin-top:0;">
       <a class="share-chip" style="background:#fee500;color:#191919!important;" href="./api/auth/kakao-start">🟡 카카오로 로그인</a>
       <a class="share-chip" style="background:#03c75a;color:#fff!important;" href="./api/auth/naver-start">🟢 네이버로 로그인</a>
       <a class="share-chip" style="background:#fff;color:#3c4043!important;" href="./api/auth/google-start">🔵 구글로 로그인</a>
     </div>`);
   return;
 }
 communityActiveTab=tab||communityActiveTab||"online";
 await refreshFavoriteIds();
 openModal(`<h2>👥 커뮤니티</h2><p>${escapeHtml(acc.nickname)}님으로 로그인됨</p>
   <div class="community-tabs">
     <button type="button" class="community-tab ${communityActiveTab==="online"?"active":""}" data-ctab="online">🟢 접속자</button>
     <button type="button" class="community-tab ${communityActiveTab==="contacts"?"active":""}" data-ctab="contacts">👥 연락처</button>
   </div>
   <div id="communityBody"><p style="opacity:.7;">불러오는 중...</p></div>
   <button type="button" id="logoutBtn" class="ai-advisor-btn" style="background:linear-gradient(135deg,#7a2e2e,#4a1717);margin-top:10px;">로그아웃</button>`);
 document.querySelectorAll("[data-ctab]").forEach(b=>b.addEventListener("click",()=>openCommunityPanel(b.dataset.ctab)));
 document.getElementById("logoutBtn").addEventListener("click",()=>{doLogout();closeModal()});
 if(communityActiveTab==="online")await renderOnlineTab();else await renderContactsTab();
}
async function renderOnlineTab(){
 const box=document.getElementById("communityBody");
 if(!box)return;
 const online=await fetchOnlineUsers();
 if(!online.length){box.innerHTML="<p style='opacity:.7;'>현재 접속 중인 다른 사용자가 없습니다.</p>";return}
 box.innerHTML=`<div class="shop-grid">${online.map(userRowHtml).join("")}</div>`;
 wireUserRows(box);
}
async function renderContactsTab(){
 const box=document.getElementById("communityBody");
 if(!box)return;
 box.innerHTML=`<div class="dm-input-row"><input type="text" id="userSearchInput" placeholder="닉네임으로 검색 (오프라인 포함)"><button type="button" id="userSearchBtn">검색</button></div>
   <div id="searchResultsBox"></div>
   <h3 style="margin:14px 0 6px;font-size:14px;opacity:.85;">⭐ 즐겨찾기</h3>
   <div id="favoritesBox"><p style="opacity:.7;">불러오는 중...</p></div>
   <h3 style="margin:14px 0 6px;font-size:14px;opacity:.85;">🕑 최근 대화</h3>
   <div id="recentBox"><p style="opacity:.7;">불러오는 중...</p></div>`;
 const searchBtn=document.getElementById("userSearchBtn"),searchInput=document.getElementById("userSearchInput");
 const doSearch=async()=>{
   const q=searchInput.value.trim();
   const resBox=document.getElementById("searchResultsBox");
   if(!q){resBox.innerHTML="";return}
   const acc=getAccount();
   try{
     const res=await fetch(`./api/users/search?q=${encodeURIComponent(q)}&userId=${encodeURIComponent(acc.id)}`);
     const data=await res.json();
     const results=data.ok?data.results:[];
     resBox.innerHTML=results.length?`<div class="shop-grid">${results.map(userRowHtml).join("")}</div>`:"<p style='opacity:.7;'>검색 결과가 없습니다.</p>";
     wireUserRows(resBox);
   }catch{resBox.innerHTML="<p style='opacity:.7;'>검색에 실패했습니다.</p>"}
 };
 searchBtn.addEventListener("click",doSearch);
 searchInput.addEventListener("keydown",e=>{if(e.key==="Enter")doSearch()});
 await Promise.all([renderFavoritesSection(),renderRecentSection()]);
}
async function renderFavoritesSection(){
 const box=document.getElementById("favoritesBox");
 if(!box)return;
 const acc=getAccount();
 try{
   const res=await fetch(`./api/favorites/list?userId=${encodeURIComponent(acc.id)}`);
   const data=await res.json();
   const favs=data.ok?data.favorites:[];
   box.innerHTML=favs.length?`<div class="shop-grid">${favs.map(userRowHtml).join("")}</div>`:"<p style='opacity:.7;'>즐겨찾기한 사용자가 없습니다.</p>";
   wireUserRows(box);
 }catch{box.innerHTML="<p style='opacity:.7;'>불러오지 못했습니다.</p>"}
}
async function renderRecentSection(){
 const box=document.getElementById("recentBox");
 if(!box)return;
 const acc=getAccount();
 try{
   const res=await fetch(`./api/dm/recent?userId=${encodeURIComponent(acc.id)}`);
   const data=await res.json();
   const recent=data.ok?data.recent:[];
   box.innerHTML=recent.length?`<div class="shop-grid">${recent.map(userRowHtml).join("")}</div>`:"<p style='opacity:.7;'>최근 대화 기록이 없습니다.</p>";
   wireUserRows(box);
 }catch{box.innerHTML="<p style='opacity:.7;'>불러오지 못했습니다.</p>"}
}

/* ===================== 1:1 쪽지 (2단계) ===================== */
const DM_UNREAD_TRACK_KEY="komscoDmUnreadTrackV1";
function loadDmUnreadTrack(){try{return JSON.parse(localStorage.getItem(DM_UNREAD_TRACK_KEY)||"{}")}catch{return{}}}
function saveDmUnreadTrack(t){try{localStorage.setItem(DM_UNREAD_TRACK_KEY,JSON.stringify(t))}catch{}}
// 하트비트마다 안 읽은 쪽지 수를 발신자별로 비교해서, 그 사이 '새로' 늘어난 경우에만 알림을
// 띄우고 벨을 흔듦 (이미 알고 있던 안 읽은 쪽지에 대해 매번 다시 알리지 않도록)
function checkDmNotifications(unreadDms){
 const prev=loadDmUnreadTrack();
 const next={};
 let hasNew=false;
 for(const u of unreadDms){
   next[u.senderId]=u.count;
   if(u.count>(prev[u.senderId]||0)){
     hasNew=true;
     pushDmNotification(u.senderId,escapeHtml(u.nickname));
   }
 }
 saveDmUnreadTrack(next);
 if(hasNew)startBellRing();
}
function pushDmNotification(senderId,nickname){
 const list=loadList(NOTIF_KEY);
 list.unshift({id:"dm"+Date.now()+Math.random().toString(36).slice(2,6),title:"새 쪽지",body:`${nickname}님에게 쪽지가 왔습니다.`,ts:Date.now(),read:false,dm:{otherId:senderId,nickname}});
 saveList(NOTIF_KEY,list.slice(0,40));
 updateNotifBadge();
}
function startBellRing(){const b=ui("notifBtn");if(b)b.classList.add("ringing")}
function stopBellRing(){const b=ui("notifBtn");if(b)b.classList.remove("ringing")}
async function openDmThread(otherId,otherNickname){
 const acc=getAccount();
 if(!acc){toast("로그인이 필요합니다.");return}
 stopBellRing(); // 이 상대와의 대화창을 열면(알림 벨을 거치지 않고 접속자 목록의 ✉️로 바로 열어도) 벨 깜빡임을 끔
 openModal(`<h2>💬 ${escapeHtml(otherNickname)}</h2><div id="dmThreadBox" class="dm-thread"><p style="opacity:.6;">불러오는 중...</p></div>
   <div class="dm-input-row"><input type="text" id="dmInput" placeholder="메시지를 입력하세요" maxlength="1000"><button type="button" id="dmSendBtn">전송</button></div>`);
 // 대화창을 열면 이 상대에게서 온 안 읽은 쪽지를 자동으로 읽음 처리
 try{await fetch("./api/dm/read",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:acc.id,otherId})})}catch{}
 const track=loadDmUnreadTrack();delete track[otherId];saveDmUnreadTrack(track);
 updateNotifBadge();
 await renderDmThread(acc.id,otherId);
 const sendBtn=document.getElementById("dmSendBtn"),input=document.getElementById("dmInput");
 const send=async()=>{
   const text=input.value.trim();
   if(!text)return;
   input.value="";
   try{
     await fetch("./api/dm/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({senderId:acc.id,recipientId:otherId,body:text})});
     await renderDmThread(acc.id,otherId);
   }catch{toast("전송에 실패했습니다. 다시 시도해주세요.")}
 };
 sendBtn.addEventListener("click",send);
 input.addEventListener("keydown",e=>{if(e.key==="Enter")send()});
}
async function renderDmThread(myId,otherId){
 const box=document.getElementById("dmThreadBox");
 if(!box)return;
 let messages=[];
 try{
   const res=await fetch(`./api/dm/thread?userId=${encodeURIComponent(myId)}&otherId=${encodeURIComponent(otherId)}`);
   const data=await res.json();
   messages=data.ok?data.messages:[];
 }catch{}
 if(!messages.length){
   box.innerHTML="<p style='opacity:.6;'>아직 대화가 없습니다. 첫 메시지를 보내보세요!</p>";
   return;
 }
 // 카카오톡처럼 내 메시지는 오른쪽(보라색), 상대 메시지는 왼쪽으로 구분
 box.innerHTML=messages.map(m=>{
   const mine=m.sender_id===myId;
   return `<div class="dm-row ${mine?"dm-row-mine":"dm-row-theirs"}"><span class="dm-bubble ${mine?"dm-bubble-mine":"dm-bubble-theirs"}">${escapeHtml(m.body)}</span></div>`;
 }).join("");
 box.scrollTop=box.scrollHeight;
}
function escapeHtml(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML.replace(/"/g,"&quot;").replace(/'/g,"&#39;")}

/* ===================== 게임 공유하기 (2D 버전 getSharePayload 참고) ===================== */
function getSharePayload(){
 return{url:location.href,text:"KOMSCO 네온팜 시티에서 함께 도시를 키워요!",title:"KOMSCO 네온팜 시티"};
}
// navigator.share()는 기기의 실제 물리적 화면 방향으로 OS 공유창을 띄우는데, 이 게임은
// 세로로 쥔 폰을 CSS로 가로처럼 보이게 하는 방식이라 OS 공유창은 우리 CSS 회전과 무관하게
// 항상 실제(세로) 방향으로 나타나 화면이 통째로 뒤집힌 것처럼 보였습니다. OS 공유창을 아예
// 쓰지 않고, 게임과 같은 회전을 그대로 물려받는 자체 모달로만 공유를 처리하도록 변경.
// 카카오톡 공유는 Kakao JS SDK + 앱 키 등록이 필요한데 이 프로젝트엔 연동되어 있지 않아
// (가짜로 흉내내면 조용히 실패하거나 404가 나므로) 목록에서 제외했습니다.
async function shareGame(){
 // 공유 버튼을 누르는 시점에 다시 한 번 전체화면+가로 고정을 시도해서, 이메일/카카오톡 같은
 // 외부 앱이 열리기 직전에 기기가 실제로 가로 상태일 가능성을 최대한 높임. (외부 네이티브 앱
 // 자체의 화면 방향까지 우리 페이지에서 강제할 수는 없다는 한계는 있음)
 try{await KOMSCO.Orientation.lockLandscape()}catch{}
 const payload=getSharePayload();
 const msg=`${payload.title}\n${payload.text}\n${payload.url}`;
 const enc=encodeURIComponent;
 const channels=[
   {icon:"🟡",label:"카카오톡",kind:"native"},
   {icon:"💬",label:"문자",href:`sms:?body=${enc(msg)}`},
   {icon:"✉️",label:"이메일",href:`mailto:?subject=${enc(payload.title)}&body=${enc(msg)}`},
   {icon:"🐦",label:"X(트위터)",href:`https://twitter.com/intent/tweet?text=${enc(payload.text)}&url=${enc(payload.url)}`},
   {icon:"🟢",label:"라인",href:`https://social-plugins.line.me/lineit/share?url=${enc(payload.url)}&text=${enc(payload.text)}`}
 ];
 let html=`<h2>📤 게임 친구 공유하기</h2><p>친구에게 KOMSCO 네온팜 시티 링크를 공유해보세요.${state.shareRewardClaimed?"":" (첫 공유 시 보너스 골드 지급!)"}</p><div class="share-grid">`;
 channels.forEach((c,i)=>{
   if(c.kind==="native")html+=`<button type="button" class="share-chip" id="shareKakaoBtn">${c.icon} ${c.label}</button>`;
   else html+=`<a class="share-chip" href="${c.href}" target="_blank" rel="noopener" data-share-channel="1">${c.icon} ${c.label}</a>`;
 });
 html+=`<button type="button" id="shareCopyBtn" class="share-chip share-chip-copy">🔗 링크복사</button></div>
   <div class="share-link-box"><span id="shareLinkText">${payload.url}</span></div>`;
 openModal(html);
 document.querySelectorAll("[data-share-channel]").forEach(el=>el.addEventListener("click",claimShareRewardOnce));
 const copyBtn=document.getElementById("shareCopyBtn");
 if(copyBtn)copyBtn.addEventListener("click",async()=>{
   try{await navigator.clipboard.writeText(msg);copyBtn.textContent="✅ 복사 완료"}
   catch{copyBtn.textContent="복사 실패, 직접 선택해 복사해주세요"}
   claimShareRewardOnce();
 });
 // 카카오톡 전용: 이 프로젝트엔 Kakao SDK 앱 키가 연동되어 있지 않아 정식 "카카오톡으로
 // 공유" 버튼을 만들 수 없습니다. 대신 OS 기본 공유창(navigator.share)을 띄워, 설치된 앱
 // 목록에서 사용자가 직접 카카오톡을 선택할 수 있도록 합니다. (참고: 이 OS 공유창은 기기의
 // 실제 화면 방향으로 뜨기 때문에, 세로로 쥔 채 가로 트릭을 쓰는 중이라면 공유창만 세로로
 // 보일 수 있습니다 -- 이 버튼에서만 발생하는, OS 자체의 제약입니다.)
 const kakaoBtn=document.getElementById("shareKakaoBtn");
 if(kakaoBtn)kakaoBtn.addEventListener("click",async()=>{
   claimShareRewardOnce();
   if(navigator.share){
     try{await navigator.share(payload);return}catch{}
   }
   try{await navigator.clipboard.writeText(msg);toast("카카오톡 공유는 이 브라우저에서 지원되지 않아 링크를 복사했습니다. 카카오톡에 붙여넣어 주세요.")}
   catch{toast("카카오톡 앱에 아래 링크를 직접 붙여넣어 공유해주세요: "+payload.url)}
 });
}
// 바이럴 훅: 첫 공유 시 1회 한정 보너스 골드 지급 (별도의 리퍼럴 추적 백엔드 없이 간단하게 구현)
function claimShareRewardOnce(){
 if(state.shareRewardClaimed)return;
 state.shareRewardClaimed=true;
 state.gold+=300;
 save();
 flashGold();
 toast("🎁 첫 공유 보너스 +300G 지급!");
 pushNotification("공유 보너스","친구에게 게임을 공유해주셔서 300G를 지급했습니다.");
}

(async()=>{
 try{
   load();buildCards();resize();
   const tasks=[
     loadImage(DAY).then(v=>bgDay=v),
     loadImage(NIGHT).then(v=>bgNight=v),
     ...Object.entries(CHARS).map(([id,c])=>loadImage(CHAR_BASE+c.img).then(v=>images[id]=v))
   ];
   let done=0;
   await Promise.all(tasks.map(p=>p.finally(()=>{
     done++;
     const bar=ui("loadBar");
     if(bar)bar.style.width=`${done/tasks.length*100}%`;
   })));
   if(!bgDay&&!bgNight)throw new Error("낮·밤 배경 이미지를 찾을 수 없습니다.");
   const fallbackChar=Object.values(images).find(Boolean);
   for(const id of Object.keys(CHARS))if(!images[id])images[id]=fallbackChar;
   updateUI();resize();updateNotifBadge();if(getAccount())startHeartbeat();updateCommunityBtnStyle();handleSocialLoginReturn();
   fetchWeather();
   setInterval(fetchWeather,15*60*1000);
   syncTimeOffset();
   setInterval(syncTimeOffset,5*60*1000);
   ui("loading").classList.remove("show");
   ui("characterSelect").classList.add("show");
   requestAnimationFrame(loop);
   // Catch late viewport settling on Android browsers whose toolbar takes a moment to
   // collapse after load (this is what caused the character-select screen to render
   // clipped until the device was physically rotated, which forces a resize).
   requestAnimationFrame(resize);
   [150,400,900].forEach(ms=>setTimeout(resize,ms));
   if("serviceWorker"in navigator){
     navigator.serviceWorker.register("./sw.js").catch(console.warn);
   }
 }catch(error){showFatal(error);}
})();
})();