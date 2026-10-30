/* AIUseFlow TradeLab 4.0: no auth, no keys, no automated execution; transparent on-device research. */
'use strict';
const V4_KEY='aiuseflow-tradelab-v4';
const v4={receivedAt:null,seenSymbol:null,depth:null,futures:null,lastCopilot:'',priceHistory:new Map(),alertTimer:null,refreshing:false};
const v4Node=id=>document.getElementById(id);
const v4esc = value=>String(value).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const v4dollars = n=>Number.isFinite(Number(n))?'$'+Number(n).toLocaleString('en-US',{maximumFractionDigits:2}):'—';
const v4percent=n=>n!=null&&Number.isFinite(Number(n))?Number(n).toFixed(2)+'%':'—';
function v4StorageRead(key,fallback){try{const v=JSON.parse(localStorage.getItem(V4_KEY+'-'+key));return v??fallback;}catch(_){return fallback;}}
function v4StorageWrite(key,val){try{localStorage.setItem(V4_KEY+'-'+key,JSON.stringify(val));return true;}catch(_){showToast('Browser storage disabled — change not saved');return false;}}
function v4Account(){const obj=v4StorageRead('paper',null);return obj&&Number.isFinite(obj.cash)&&Array.isArray(obj.positions)&&Array.isArray(obj.fills)?obj:{cash:10000,positions:[],fills:[]};}
function v4Alerts(){const arr=v4StorageRead('alerts',[]);return Array.isArray(arr)?arr.slice(-30):[];}
async function v4Fetch(url,timeout=9000){const c=new AbortController();const handle=setTimeout(()=>c.abort(),timeout);try{const response=await fetch(url,{signal:c.signal,cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);return await response.json();}finally{clearTimeout(handle);}}
function v4Health(){return TradeEngine4.health({source:state.mode,bars:state.bars,interval:state.interval,receivedAt:v4.receivedAt});}
function v4Gate(){return TradeEngine4.gate({source:state.mode,bars:state.bars,smart:state.smart,interval:state.interval,receivedAt:v4.receivedAt});}
function updateV4(){
  // Called when existing v2 chart gets replaced, including a documented sample fallback.
  v4.receivedAt=state.mode==='live'?Date.now():null;
  v4.seenSymbol=state.symbol;
  const h=v4Health(),g=v4Gate();
  v4Node('v4-health-status').textContent=h.status;
  v4Node('v4-health-detail').textContent=h.detail+' · NOT a streaming feed';
  v4Node('v4-trade-gate').textContent=g.status;
  v4Node('v4-gate-explain').textContent=g.reason;
  v4Node('v4-signal').textContent=state.smart?`${state.smart.bias} · ${state.smart.score}/100`:'UNAVAILABLE';
  v4Node('v4-signal-explain').textContent=state.smart?state.smart.reasons.filter(x=>x.points).map(x=>`${x.points>0?'+':''}${x.points}: ${x.description}`).join(' / ').slice(0,240):'Not enough candles';
  renderV4Radar();renderV4Alerts();renderV4Paper();renderV4Coach();
  v4Node('v4-depth-data').innerHTML='<p class="v4-small">Symbol or candles refreshed. Request a NEW order book snapshot; old snapshot is not reused.</p>';
  v4Node('v4-derivatives').innerHTML='<p class="v4-small">Refresh to verify derivatives for the selected symbol.</p>';
  v4.depth=null;v4.futures=null;
  if(state.mode==='live')checkV4Alerts();
}
function renderV4Radar(){
 const root=v4Node('v4-radar');if(!root)return;
 const items=[];
 for(const symbol of PAIRS)for(const tf of SMART_TFS){const a=smartState.scanItems.get(symbol+'-'+tf);if(!a)continue;const usable=a.source==='LIVE';items.push({symbol,tf,score:a.score,bias:a.bias,usable,reasons:a.reasons||[]});}
 const sorted=items.sort((a,b)=>Number(b.usable)-Number(a.usable)||Math.abs(b.score-50)-Math.abs(a.score-50)).slice(0,9);
 root.innerHTML=sorted.map(x=>`<div class="v4-row"><span><strong>${v4esc(x.symbol)}</strong><small>${x.tf} · ${x.bias} · ${x.usable?'PUBLIC SNAPSHOT':'SAMPLE'}</small></span><span class="v4-right"><strong>${x.score}/100</strong><small>${x.usable?'Research only':'Not tradable data'}</small></span></div>`).join('')+'<p class="v4-small">Confluence score = technical rule points, not probability. Click main Smart Lab scanner for chart/timeframe detail.</p>';
}
async function v4RefreshDepth(){
 const node=v4Node('v4-depth-data'),symbol=state.symbol;node.textContent='Requesting public order book…';
 try{const raw=await v4Fetch('https://data-api.binance.vision/api/v3/depth?symbol='+encodeURIComponent(symbol)+'&limit=100');if(state.symbol!==symbol)return;
 const x=TradeEngine4.liquidity(raw),sign=x.imbalance>0?'bid':'ask';v4.depth={...x,symbol,time:Date.now()};
 node.innerHTML=`<div class="v4-metrics"><span>Top-20 bid notional<strong>${v4dollars(x.bidValue)}</strong></span><span>Top-20 ask notional<strong>${v4dollars(x.askValue)}</strong></span><span>Bid/Ask imbalance<strong>${(x.imbalance*100).toFixed(1)}%</strong></span><span>Spread<strong>${v4percent((x.bestAsk-x.bestBid)/x.bestAsk*100)}</strong></span></div><div class="v4-bar"><i style="width:${(50+50*x.imbalance).toFixed(0)}%"></i></div><div class="v4-row"><span>Largest visible bid wall</span><strong>${v4dollars(x.bidWall.price)}</strong></div><div class="v4-row"><span>Largest visible ask wall</span><strong>${v4dollars(x.askWall.price)}</strong></div><p class="v4-small">Snapshot ${new Date().toLocaleTimeString('en-IN')} · ${v4esc(symbol)} · ${sign==='bid'?'Bid':'Ask'} side larger in top 20. Orders can be cancelled instantly.</p>`;
 }catch(err){node.innerHTML=`<p class="v4-error">Order book unavailable (${v4esc(err.message)}). No sample liquidity is invented.</p>`;}}
async function v4RefreshFutures(){
 const node=v4Node('v4-derivatives'),symbol=state.symbol;node.textContent='Requesting futures funding and open interest…';
 const base='https://fapi.binance.com';const [prem,oi]=await Promise.allSettled([v4Fetch(base+'/fapi/v1/premiumIndex?symbol='+encodeURIComponent(symbol)),v4Fetch(base+'/fapi/v1/openInterest?symbol='+encodeURIComponent(symbol))]);
 if(state.symbol!==symbol)return;
 if(prem.status==='rejected'&&oi.status==='rejected'){node.innerHTML='<p class="v4-error">Futures data unavailable or restricted. No synthetic funding/open interest is shown. Try the public API from an allowed network.</p>';return;}
 const p=prem.status==='fulfilled'?prem.value:null,o=oi.status==='fulfilled'?oi.value:null;
 v4.futures={symbol,p,o,time:Date.now()};
 node.innerHTML=`<div class="v4-metrics"><span>Latest funding rate<strong>${p&&Number.isFinite(Number(p.lastFundingRate))?v4percent(Number(p.lastFundingRate)*100):'UNAVAILABLE'}</strong></span><span>Open interest (contracts)<strong>${o&&Number.isFinite(Number(o.openInterest))?Number(o.openInterest).toLocaleString('en-US',{maximumFractionDigits:2}):'UNAVAILABLE'}</strong></span><span>Mark price<strong>${p?v4dollars(Number(p.markPrice)):'—'}</strong></span><span>Next funding<strong>${p&&Number(p.nextFundingTime)?new Date(Number(p.nextFundingTime)).toLocaleTimeString('en-IN'):'—'}</strong></span></div><p class="v4-small">Binance USDⓈ-M perpetual futures public snapshot · ${new Date().toLocaleTimeString('en-IN')} · not spot funding. Missing values are shown as unavailable.</p>`;
}
function renderV4Alerts(){
 const arr=v4Alerts().filter(a=>a&&PAIRS.includes(a.symbol));
 v4Node('v4-alerts').innerHTML=arr.length?arr.map(a=>`<div class="v4-row"><span><strong>${v4esc(a.symbol)} ${a.direction==='above'?'≥':'≤'} ${v4dollars(a.target)}</strong><small>${a.hit?'TRIGGERED':'Monitoring while page is open'}</small></span><button data-v4-alert-delete="${v4esc(a.id)}" type="button" class="v4-inline-btn">Remove</button></div>`).join(''):'<p class="v4-small">No price alerts set.</p>';
 v4Node('v4-alert-status').textContent='Last checked only when verified public chart data loads. This page does not run in the background.';
}
function checkV4Alerts(){
 if(state.mode!=='live'||!v4Health().isUsable)return;
 const arr=v4Alerts();let changed=false;const current=state.anal.last.close;
 for(const a of arr){if(a.hit||a.symbol!==state.symbol)continue;
   const was=Number(a.last);const crossed=a.direction==='above'?(was<a.target&&current>=a.target):(was>a.target&&current<=a.target);
   if(a.last!=null&&Number.isFinite(was)&&crossed){a.hit=Date.now();changed=true;showToast('Price alert: '+a.symbol+' '+a.direction+' '+a.target);}
   if(a.last!==current){a.last=current;changed=true;}
 }
 if(changed)v4StorageWrite('alerts',arr);
}
function v4Copilot(q){
 if(!state.smart)return 'अभी analysis उपलब्ध नहीं है।';
 const h=v4Health(),g=v4Gate(),a=state.smart,s=state.symbol.replace('USDT','/USDT'),query=q.toLowerCase();
 const source=h.isUsable?'Binance public snapshot':'SAMPLE / UNVERIFIED data';
 if(/risk|जोखिम|stop|नुकसान|ट्रेड|trade|buy|sell/.test(query))return `${s}: ${g.status}। कारण: ${g.reason}। यह व्यक्तिगत Buy/Sell सलाह नहीं है। डेटा: ${source}।`;
 if(/fvg|gap|ब्लॉक|block|liquidity/.test(query))return `${s}: Active FVG ${a.activeGaps.length}, latest ${a.latestGap?a.latestGap.type+' '+a.latestGap.status:'none'}। Order Blocks संभावित technical zones हैं, बड़े निवेशक की पुष्टि नहीं। डेटा: ${source}।`;
 if(/trend|ट्रेंड|bull|bear|तेजी|गिरावट|market/.test(query))return `${s} ${state.interval}: ${a.bias} (score ${a.score}/100)। EMA20 ${a.ema20>=a.ema50?'EMA50 से ऊपर':'EMA50 से नीचे'} है। ${g.status}। डेटा: ${source}।`;
 return `${s}, ${state.interval}: score ${a.score}/100 (${a.bias})। कारण: ${a.reasons.map(r=>`${r.points>=0?'+':''}${r.points} ${r.description}`).join('; ')}। ${g.status}। डेटा: ${source}।`;
}
function v4PaperMark(){const acc=v4Account();const markets=v4StorageRead('marks',{});if(state.mode==='live'&&v4Health().isUsable){markets[state.symbol]={price:state.anal.last.close,time:Date.now(),source:'PUBLIC SNAPSHOT'};v4StorageWrite('marks',markets);}return markets;}
function renderV4Paper(){
 const acc=v4Account(),marks=v4PaperMark();let equity=acc.cash,unknown=0;
 const holdings=acc.positions.map(p=>{const mark=marks[p.symbol];const usable=mark&&Date.now()-mark.time<180000;const value=usable?p.qty*mark.price*(1-.0015):null;if(value===null)unknown++;else equity+=value;return {...p,estimate:value,price:usable?mark.price:null};});
 v4Node('v4-paper').innerHTML=`<div class="v4-metrics"><span>Virtual cash<strong>${v4dollars(acc.cash)}</strong></span><span>Estimated equity<strong>${unknown?'INCOMPLETE':v4dollars(equity)}</strong></span><span>Open positions<strong>${acc.positions.length}</strong></span><span>Completed trades<strong>${acc.fills.filter(x=>x.action==='SELL').length}</strong></span></div>${holdings.map(p=>`<div class="v4-row"><span><strong>${v4esc(p.symbol)} · ${Number(p.qty).toFixed(6)} units</strong><small>${v4esc(p.source)} · cost ${v4dollars(p.cost)} · ${p.price?v4dollars(p.price):'stale/missing mark'}</small></span><button type="button" class="v4-inline-btn" data-v4-paper-sell="${v4esc(p.id)}" ${p.symbol!==state.symbol||state.mode!=='live'||!v4Health().isUsable?'disabled':''}>Close*</button></div>`).join('')||'<p class="v4-small">No open paper positions.</p>'}<p class="v4-small">*Closing requires a verified public price for the selected asset. Equity excludes stale marks. Positions and fills stay only in this browser.</p>`;
}
function renderV4Coach(){
 const acc=v4Account(),sells=acc.fills.filter(f=>f.action==='SELL'),notes=getNotes(),wins=sells.filter(f=>f.pnl>=0),losses=sells.filter(f=>f.pnl<0);
 const reminders=[];
 if(!sells.length)reminders.push('अभी closed paper trades नहीं हैं। पहले कम-से-कम 5 simulated trades के बाद performance patterns देखें।');
 else{const sum=sells.reduce((t,x)=>t+x.pnl,0);reminders.push(`${sells.length} closed virtual trades: ${wins.length} wins, ${losses.length} losses, net ${v4dollars(sum)} after modeled fees/slippage.`);if(losses.length>=wins.length)reminders.push('Losses जीत के बराबर या अधिक हैं—strategy और stop planning को backtest करें।');}
 if(notes.length<3)reminders.push('Journal में setup, invalidation level और बाद का outcome लिखें; फिलहाल notes कम हैं।');
 if(acc.positions.length>4)reminders.push('एक साथ कई open positions हैं; correlated exposure की जाँच करें।');
 if(acc.fills.filter(x=>x.action==='BUY'&&Date.now()-x.time<86400000).length>=5)reminders.push('आज paper entries की संख्या पाँच या अधिक है; overtrading पर नज़र रखें।');
 v4Node('v4-coach').innerHTML=reminders.map((s,i)=>`<div class="v4-row"><span><strong>${i===0?'Performance':'Coach reminder '+i}</strong><small>${v4esc(s)}</small></span></div>`).join('');
}
function v4Desk(){
 const h=v4Health(),g=v4Gate(),a=state.smart,account=v4Account(),data=h.isUsable?'Verified public chart snapshot':'Sample / expired / unavailable chart',tf=state.interval;
 const roles=[
 ['Desk Lead',`Coordinate six review roles. ${g.status}; no real orders are authorized.`],
 ['Market Research',`${state.symbol} ${tf}, ${data}. ${a?.bias||'Unknown'} score ${a?.score??'—'}/100. ${(a?.structure?.events||[]).length} swing events detected.`],
 ['Strategy Research',`EMA20/50, FVG and structure research only; no historical out-of-sample strategy certification is implied. Run Backtesting separately.`],
 ['Risk Manager',`${g.status}: ${g.reason}. Check position size, source freshness, fees and slippage.`],
 ['Execution / Ticket Only','NO EXCHANGE CONNECTION. Paper trading is manually clicked; no autonomous order placement or execution API.'],
 ['Compliance & Journal',`${account.fills.length} local paper fills and ${getNotes().length} research notes. Education only; disclose sample data and regional market-data restrictions.`]
 ];
 v4Node('v4-desk').innerHTML=roles.map((r,i)=>`<div class="v4-agent"><span class="v4-agent-count">${i+1}</span><div><strong>${v4esc(r[0])}</strong><p>${v4esc(r[1])}</p></div></div>`).join('');
}
async function v4Backtest(){
 const node=v4Node('v4-backtest'),symbol=state.symbol,interval=state.interval;
 const fee=Number(v4Node('v4-fee').value)/100,slip=Number(v4Node('v4-slip').value)/100;
 if(!Number.isFinite(fee)||!Number.isFinite(slip)||fee<0||slip<0||fee>.03||slip>.03){node.textContent='Invalid fee/slippage values.';return;}
 node.textContent='Loading 800 historical candles. Live public data required; no fabricated backtests.';
 try{
 const result=await v4Fetch('https://data-api.binance.vision/api/v3/klines?symbol='+encodeURIComponent(symbol)+'&interval='+encodeURIComponent(interval)+'&limit=800',15000);
 if(!Array.isArray(result))throw Error('No candle array');
 const candles=result.filter(row=>Number(row[6])<Date.now()).map(r=>({time:Number(r[0]),open:Number(r[1]),close:Number(r[4])})).filter(r=>Number.isFinite(r.open)&&Number.isFinite(r.close));
 if(candles.length<110)throw Error('Not enough CLOSED candles');
 const bt=TradeEngine4.backtest(candles,{fee,slip});
 if(state.symbol!==symbol||state.interval!==interval)return;
 node.innerHTML=`<p class="v4-small">PUBLIC HISTORICAL · ${v4esc(symbol)} ${v4esc(interval)} · ${bt.totalBars} closed bars · rules are fixed, no optimization</p><div class="v4-metrics"><span>TRAIN (${bt.trainCount} bars)<strong>${v4percent(bt.train.returnPct)} return</strong><small>${bt.train.trades} trades · ${v4percent(bt.train.maxDrawdownPct)} DD</small></span><span>OUT-OF-SAMPLE (${bt.testCount} bars)<strong>${v4percent(bt.test.returnPct)} return</strong><small>${bt.test.trades} trades · ${v4percent(bt.test.maxDrawdownPct)} DD</small></span><span>Train win rate<strong>${v4percent(bt.train.winRate)}</strong></span><span>Test win rate<strong>${v4percent(bt.test.winRate)}</strong></span></div><p class="v4-small">Each split starts with $1,000 virtual capital. Entries/exits at NEXT candle open, 25% allocation, no leverage. Fee ${(fee*100).toFixed(2)}% and slippage ${(slip*100).toFixed(2)}% per side. Short track length and few trades may make results unreliable. Past performance is not predictive.</p>`;
 }catch(err){node.innerHTML=`<p class="v4-error">Historical backtest unavailable: ${v4esc(err.message)}. No fabricated metrics displayed.</p>`;}
}
function initV4(){
 const on=(id,event,fn)=>v4Node(id).addEventListener(event,fn);
 on('v4-radar-refresh','click',async()=>{const btn=v4Node('v4-radar-refresh');btn.disabled=true;btn.textContent='Scanning…';try{await runSmartScanner();renderV4Radar();}finally{btn.disabled=false;btn.textContent='Scan opportunities';}});
 on('v4-depth-refresh','click',v4RefreshDepth);on('v4-futures-refresh','click',v4RefreshFutures);
 on('v4-backtest-run','click',v4Backtest);on('v4-coach-refresh','click',renderV4Coach);on('v4-desk-run','click',v4Desk);
 on('v4-alert-form','submit',e=>{e.preventDefault();const target=Number(v4Node('v4-alert-price').value);if(!Number.isFinite(target)||target<=0){showToast('Valid price entered');return;}const arr=v4Alerts();if(arr.length>=30){showToast('Maximum 30 alerts');return;}arr.push({id:String(Date.now()),symbol:state.symbol,target,direction:v4Node('v4-alert-direction').value,last:state.mode==='live'?state.anal.last.close:null,hit:null});v4StorageWrite('alerts',arr);renderV4Alerts();v4Node('v4-alert-price').value='';});
 on('v4-alerts','click',e=>{const btn=e.target.closest('[data-v4-alert-delete]');if(!btn)return;v4StorageWrite('alerts',v4Alerts().filter(a=>a.id!==btn.dataset.v4AlertDelete));renderV4Alerts();});
 on('v4-copilot-form','submit',e=>{e.preventDefault();v4.lastCopilot=v4Copilot(v4Node('v4-copilot-input').value.trim());v4Node('v4-copilot-answer').textContent=v4.lastCopilot;});
 on('v4-speak','click',()=>{if(!('speechSynthesis' in window)){showToast('Voice support unavailable in this browser');return;}if(!v4.lastCopilot)v4.lastCopilot=v4Copilot('market');window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(v4.lastCopilot);u.lang='hi-IN';u.rate=.95;window.speechSynthesis.speak(u);});
 on('v4-paper-form','submit',e=>{e.preventDefault();const amount=Number(v4Node('v4-paper-size').value);if(!state.anal||!(amount>0)){showToast('Enter a valid virtual allocation');return;}try{const source=state.mode==='live'&&v4Health().isUsable?'PUBLIC SNAPSHOT':'SAMPLE DEMO';v4StorageWrite('paper',TradeEngine4.paperBuy(v4Account(),{symbol:state.symbol,price:state.anal.last.close,amount,source}));renderV4Paper();renderV4Coach();showToast('Virtual paper position opened. No real order.');}catch(err){showToast(err.message);}});
 on('v4-paper','click',e=>{const btn=e.target.closest('[data-v4-paper-sell]');if(!btn||btn.disabled)return;try{const next=TradeEngine4.paperSell(v4Account(),btn.dataset.v4PaperSell,state.anal.last.close);v4StorageWrite('paper',next);renderV4Paper();renderV4Coach();showToast('Virtual position closed.');}catch(err){showToast(err.message);}});
 on('v4-paper-reset','click',()=>{if(window.confirm('Reset ALL virtual paper trades and balance on this device?')){v4StorageWrite('paper',{cash:10000,positions:[],fills:[]});renderV4Paper();renderV4Coach();}});
 v4Node('v4-paper').textContent='Loading local virtual account…';renderV4Radar();renderV4Alerts();renderV4Paper();renderV4Coach();
 // Alerts depend on chart polling. Refresh only when tab is active, one request every 60s.
 v4.alertTimer=setInterval(()=>{if(!document.hidden && state.mode==='live')refreshChart();else if(!document.hidden) {v4Node('v4-health-status').textContent='SAMPLE / OFFLINE';}},60000);
 window.addEventListener('focus',()=>{if(state.bars.length)renderV4Alerts();});
}

