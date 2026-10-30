/* AIUseFlow TradeLab Phase 1 - transparent technical heuristics, not an LLM and not trade signals. */
'use strict';

const SMART_TFS = ['15m','1h','4h','1d'];
const SMART_TF_MILLISECONDS = {'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000};
const smartState = {overlays:{ob:true,fvg:true,structure:true}, scanRun:0, scanItems:new Map(), lastRefresh:null};

function smartAtr(candles, i, length=14) {
  const start=Math.max(1,i-length+1);
  let sum=0, n=0;
  for(let j=start;j<=i;j++) {
    const c=candles[j], p=candles[j-1];
    sum+=Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)); n++;
  }
  return n?sum/n:0;
}

function findFVGs(candles, minIndex=15) {
  const gaps=[];
  for(let i=Math.max(2,minIndex);i<candles.length;i++) {
    const prev=candles[i-2], current=candles[i];
    const threshold=Math.max(smartAtr(candles,i)*0.13,current.close*.00015);
    let gap=null;
    if(current.low-prev.high>=threshold) gap={type:'bull',low:prev.high,high:current.low,index:i};
    else if(prev.low-current.high>=threshold) gap={type:'bear',low:current.high,high:prev.low,index:i};
    if(!gap)continue;
    let status='OPEN';
    // Check subsequent candles only. A later touch can mitigate/fill a zone.
    for(let j=i+1;j<candles.length;j++) {
      const bar=candles[j];
      if(gap.type==='bull') {
        if(bar.low<=gap.low){status='FILLED';break;}
        if(bar.low<gap.high)status='TOUCHED';
      }else {
        if(bar.high>=gap.high){status='FILLED';break;}
        if(bar.high>gap.low)status='TOUCHED';
      }
    }
    gaps.push({...gap,status,widthPct:100*(gap.high-gap.low)/Math.max(gap.low,.000001)});
  }
  return gaps.slice(-70);
}

function findSwingStructure(bars, radius=3) {
  const pivots=[];
  for(let i=radius;i<bars.length-radius;i++) {
    const center=bars[i];let high=true,low=true;
    for(let off=1;off<=radius;off++) {
      if(center.high<=bars[i-off].high||center.high<=bars[i+off].high) high=false;
      if(center.low>=bars[i-off].low||center.low>=bars[i+off].low) low=false;
    }
    if(high)pivots.push({type:'high',index:i,price:center.high});
    if(low)pivots.push({type:'low',index:i,price:center.low});
  }
  // Only pivots that were already confirmed at the candle being evaluated can be broken.
  const events=[];
  let latestHigh=null, latestLow=null, lastBreak=null, p=0;
  let brokenHighIndex=-1,brokenLowIndex=-1;
  for(let i=radius*2+1;i<bars.length;i++) {
    while(p<pivots.length && pivots[p].index+radius < i) {
      const pivot=pivots[p++];
      if(pivot.type==='high')latestHigh=pivot;
      else latestLow=pivot;
    }
    const candle=bars[i];
    let event=null;
    if(latestHigh && latestHigh.index!==brokenHighIndex && candle.close>latestHigh.price) {
      const direction='bull';event={kind:lastBreak&&lastBreak!==direction?'CHoCH':'BOS',direction,index:i,level:latestHigh.price,time:candle.time};
      brokenHighIndex=latestHigh.index;
    }else if(latestLow&&latestLow.index!==brokenLowIndex&&candle.close<latestLow.price) {
      const direction='bear';event={kind:lastBreak&&lastBreak!==direction?'CHoCH':'BOS',direction,index:i,level:latestLow.price,time:candle.time};
      brokenLowIndex=latestLow.index;
    }
    if(event) {events.push(event); lastBreak=event.direction;}
  }
  return {pivots:pivots.slice(-24),events:events.slice(-12),last:events.at(-1)||null,latestHigh,latestLow};
}

function smartEma(values,period) {
  const a=2/(period+1);let previous=values[0];
  return values.map(v=>(previous=a*v+(1-a)*previous));
}

function advancedAnalysis(bars) {
  if(!Array.isArray(bars)||bars.length<55)return null;
  const closes=bars.map(x=>x.close),last=bars.at(-1);
  const ema20=smartEma(closes,20).at(-1),ema50=smartEma(closes,50).at(-1);
  const gaps=findFVGs(bars),structure=findSwingStructure(bars);
  const activeGaps=gaps.filter(g=>g.status!=='FILLED');
  const latestGap=activeGaps.at(-1)||null;
  const nearGap=activeGaps.slice(-12).reverse().find(g=>Math.abs(last.close-(g.high+g.low)/2)/last.close<.025)||null;
  const reasons=[];let score=50;
  function reason(points, description){score+=points;reasons.push({points,description});}
  reason(ema20>=ema50?16:-16,`EMA20 ${ema20>=ema50?'above':'below'} EMA50 (trend alignment)`);
  reason(last.close>=ema20?12:-12,`Last close ${last.close>=ema20?'above':'below'} EMA20`);
  const breakDir=structure.last?.direction;
  if(breakDir)reason(breakDir==='bull'?14:-14,`${structure.last.kind} confirmed above/below previous swing (${breakDir})`);
  else reason(0,'No confirmed swing break in available candles');
  if(nearGap)reason(nearGap.type==='bull'?7:-7,`Near ${nearGap.type==='bull'?'bullish':'bearish'} unfilled/touched FVG`);
  else reason(0,'No active FVG within 2.5% of current close');
  const delta=last.close/bars.at(-9).close-1;
  reason(delta>.008?6:delta<-.008?-6:0,`8-candle return ${(delta*100).toFixed(2)}%`);
  score=Math.max(0,Math.min(100,Math.round(score)));
  const bias=score>=63?'BULLISH':score<=37?'BEARISH':'MIXED';
  return {score,bias,gaps,activeGaps,latestGap,nearGap,structure,reasons,ema20,ema50};
}

function timeDisplay(ms){return new Date(ms).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}
function smartPrice(n) {return (typeof fmtPrice==='function')?fmtPrice(n):'$'+Number(n).toFixed(2);}
function smartEscape(x) {return String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function ui(id) {return document.getElementById(id);}

function renderAdvanced() {
  const a=state.smart;
  if(!a)return;
  const source=state.mode==='live'?'BINANCE PUBLIC DATA · snapshot':'SIMULATED SAMPLE · not live';
  ui('smart-source').textContent=source;
  ui('smart-score').textContent=a.score+'/100';
  ui('smart-bias').textContent=a.bias;
  ui('smart-bias').className='smart-bias '+a.bias.toLowerCase();
  const evt=a.structure.last;
  ui('smart-structure').textContent=evt?evt.kind+' '+(evt.direction==='bull'?'↑ Bullish':'↓ Bearish'):'No confirmed break';
  ui('smart-structure').className='smart-structure '+(evt?.direction||'neutral');
  ui('smart-gap-count').textContent=String(a.activeGaps.length);
  ui('smart-explain').innerHTML=a.reasons.map(r=>`<li><span class="point ${r.points>0?'up':r.points<0?'down':''}">${r.points>0?'+':''}${r.points}</span><span>${smartEscape(r.description)}</span></li>`).join('');
  ui('smart-footnote').textContent='Rules score: starting 50, then EMA ±16, close vs EMA ±12, swing break ±14, nearby active FVG ±7 and 8-candle change ±6. Not a probability or forecast.';
  const events=a.structure.events.slice(-5).reverse();
  ui('structure-list').innerHTML=events.length?events.map(e=>`<div class="signal-row"><span class="signal-dot ${e.direction}"></span><strong>${e.kind} · ${e.direction==='bull'?'Upward':'Downward'}</strong><span>${smartPrice(e.level)}</span><small>${timeDisplay(e.time)}</small></div>`).join(''):'<p class="smart-empty">No confirmed BOS / CHoCH in this sample.</p>';
  const selected=a.gaps.slice(-20).filter(x=>x.status!=='FILLED').slice(-5).reverse();
  ui('gap-list').innerHTML=selected.length?selected.map(g=>`<div class="gap-row"><span class="gap-type ${g.type}">${g.type==='bull'?'BULL FVG':'BEAR FVG'}</span><span class="gap-price">${smartPrice(g.low)} – ${smartPrice(g.high)}</span><span class="gap-state">${g.status}</span></div>`).join(''):'<p class="smart-empty">No unfilled FVG detected in recent candles.</p>';
  ui('smart-last').textContent='Chart: '+state.symbol.replace('USDT','/USDT')+' · '+state.interval+' · '+(state.mode==='live'?'public data':'sample data');
  if(ui('smart-snapshot'))ui('smart-snapshot').textContent='Last candle: '+timeDisplay(state.bars.at(-1).time)+' · Exchange feed is not streaming';
}

function drawAdvancedChart(ctx,g) {
  if(!state.smart)return;
  const smart=state.smart;
  if(smartState.overlays.fvg) {
    const zones=smart.gaps.filter(x=>x.status!=='FILLED'&&x.index>=g.start-2).slice(-8);
    zones.forEach(z=>{
      const px=g.x(Math.max(0,z.index-g.start));
      if(px>g.W-g.right)return;
      const y1=g.y(z.high),y2=g.y(z.low);
      const h=Math.max(3,y2-y1);
      ctx.fillStyle=z.type==='bull'?'rgba(67,214,160,.12)':'rgba(248,124,149,.13)';
      ctx.strokeStyle=z.type==='bull'?'rgba(67,214,160,.5)':'rgba(248,124,149,.5)';
      ctx.lineWidth=1;ctx.setLineDash([2,3]);
      ctx.fillRect(px,y1,g.W-g.right-px,h);ctx.strokeRect(px,y1,g.W-g.right-px,h);
      ctx.setLineDash([]);
      ctx.fillStyle=z.type==='bull'?'#63e0b2':'#ff97a5';ctx.font='bold 9px sans-serif';
      ctx.fillText('FVG',Math.min(px+5,g.W-g.right-28),Math.max(g.top+9,y1-8));
    });
  }
  if(smartState.overlays.structure) {
    smart.structure.events.filter(e=>e.index>=g.start&&e.index<g.start+g.visible).forEach(e=>{
      const xx=g.x(e.index-g.start),price=state.bars[e.index].close,yy=g.y(price);
      ctx.strokeStyle=e.direction==='bull'?'#4bdcaf':'#f38ba2';ctx.fillStyle=ctx.strokeStyle;
      ctx.lineWidth=1.4;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(xx,Math.max(g.top,yy-26));ctx.lineTo(xx,Math.min(g.H-g.bottom,yy+26));ctx.stroke();ctx.setLineDash([]);
      ctx.font='bold 10px sans-serif';
      ctx.fillText(e.kind+(e.direction==='bull'?' ↑':' ↓'),Math.max(g.left,Math.min(xx-18,g.W-g.right-65)),Math.max(g.top+11,yy-30));
    });
  }
}

function makeScanDemo() {
  for(const pair of PAIRS)for(const tf of SMART_TFS){
    const x=advancedAnalysis(sampleData(pair,tf));
    smartState.scanItems.set(pair+'-'+tf,{...x,source:'SAMPLE'});
  }
  renderSmartScanner();
}
function classForScore(x) {return x?.bias==='BULLISH'?'up':x?.bias==='BEARISH'?'down':'neutral';}
function renderSmartScanner() {
  const el=ui('mtf-rows');
  el.innerHTML=PAIRS.map(sym=>{
    let row=`<div class="mtf-row"><button class="mtf-symbol" type="button" data-pair="${sym}">${sym.replace('USDT','')}<small>/ USDT</small></button>`;
    for(const tf of SMART_TFS){
      const d=smartState.scanItems.get(sym+'-'+tf);
      row+=`<button class="mtf-cell ${classForScore(d)}" type="button" data-pair="${sym}" data-tf="${tf}" title="${d?.source==='LIVE'?'Public market data':'Sample data'} — open chart"><strong>${d?.bias==='BULLISH'?'↗':d?.bias==='BEARISH'?'↘':'→'} ${d?.score??'--'}</strong><small>${d?.source==='LIVE'?'LIVE':'SAMPLE'}</small></button>`;
    }
    return row+'</div>';
  }).join('');
  const results=[...smartState.scanItems.values()];
  const live=results.filter(x=>x?.source==='LIVE').length;
  ui('mtf-coverage').textContent=`${live}/${results.length} live cells · ${results.length-live} sample cells`;
}
function fetchKlWithTimeout(pair,tf) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),6200);
  return fetch('https://data-api.binance.vision/api/v3/klines?symbol='+encodeURIComponent(pair)+'&interval='+encodeURIComponent(tf)+'&limit=140',{signal:controller.signal,cache:'no-store'})
    .then(r=>{if(!r.ok)throw Error('Feed HTTP '+r.status);return r.json();})
    .then(rows=>{
      if(!Array.isArray(rows)||rows.length<55)throw Error('No kline data');
      const bars=rows.map(x=>({time:Number(x[0]),open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),volume:Number(x[5])})).filter(x=>Object.values(x).every(Number.isFinite));
      if(bars.length<55)throw Error('Invalid bars');
      return bars;
    }).finally(()=>clearTimeout(timer));
}
async function runSmartScanner(){
  const run=++smartState.scanRun;
  const b=ui('mtf-refresh');b.disabled=true;b.textContent='Scanning 0/20…';
  const jobs=[];
  for(const pair of PAIRS)for(const tf of SMART_TFS)jobs.push({pair,tf});
  let next=0,done=0;
  async function worker(){
    while(next<jobs.length){
      const {pair,tf}=jobs[next++];
      try{
        const bars=await fetchKlWithTimeout(pair,tf);
        if(run===smartState.scanRun)smartState.scanItems.set(pair+'-'+tf,{...advancedAnalysis(bars),source:'LIVE'});
      }catch(_){
        if(run===smartState.scanRun)smartState.scanItems.set(pair+'-'+tf,{...advancedAnalysis(sampleData(pair,tf)),source:'SAMPLE'});
      }
      if(run===smartState.scanRun){done++;b.textContent=`Scanning ${done}/20…`;renderSmartScanner();}
    }
  }
  await Promise.all([worker(),worker(),worker(),worker()]);
  if(run===smartState.scanRun){b.disabled=false;b.textContent='↻ Scan 5 assets × 4 TF';ui('mtf-scan-time').textContent='Last scan: '+new Date().toLocaleTimeString('en-IN')+' · each cell labelled LIVE or SAMPLE';}
}

function initAdvanced(){
  for(const name of ['ob','fvg','structure']){
    const toggle=ui('overlay-'+name);
    if(toggle)toggle.addEventListener('change',()=>{smartState.overlays[name]=toggle.checked;drawChart();});
  }
  ui('mtf-refresh').addEventListener('click',runSmartScanner);
  ui('mtf-rows').addEventListener('click',event=>{
    const button=event.target.closest('[data-pair]');if(!button)return;
    const pair=button.dataset.pair,tf=button.dataset.tf||state.interval;
    state.interval=tf;
    document.querySelectorAll('[data-interval]').forEach(x=>x.classList.toggle('selected',x.dataset.interval===tf));
    selectSymbol(pair);location.hash='market';
  });
  ui('mtf-csv').addEventListener('click',()=>{
    const rows=[['symbol','timeframe','bias','score_out_of_100','data_source']];
    for(const sym of PAIRS)for(const tf of SMART_TFS){const d=smartState.scanItems.get(sym+'-'+tf);rows.push([sym,tf,d?.bias||'',d?.score??'',d?.source||'SAMPLE']);}
    const file=new Blob([rows.map(x=>x.join(',')).join('\n')],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(file);a.download='tradelab-mtf-scan.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  });
  makeScanDemo();
}

if(typeof module!=='undefined'&&module.exports){module.exports={smartAtr,findFVGs,findSwingStructure,advancedAnalysis};}
