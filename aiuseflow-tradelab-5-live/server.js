'use strict';
// Local operator prototype. Never expose directly to the public internet.
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {SYMBOLS,INTERVALS,analyze,validateOrder,stepRound}=require('./engine');
const ROOT=__dirname,PORT=Number(process.env.PORT||8787),HOST=process.env.HOST||'127.0.0.1';
const MODE=process.env.TRADING_MODE||'paper';if(!['paper','testnet','live'].includes(MODE))throw Error('Invalid TRADING_MODE');
if(HOST!=='127.0.0.1'&&HOST!=='::1')throw Error('Prototype must bind to loopback. Deploy behind a properly authenticated secure proxy only after security review.');
const OPERATOR_TOKEN=process.env.OPERATOR_TOKEN||'',KEY=process.env.BINANCE_API_KEY||'',SECRET=process.env.BINANCE_API_SECRET||'';
const MAX_ORDER=Number(process.env.MAX_ORDER_USDT||25),MAX_DAILY=Number(process.env.MAX_DAILY_NOTIONAL_USDT||50),MAX_RISK=Number(process.env.MAX_ESTIMATED_RISK_USDT||.75),MAX_ORDERS=Number(process.env.MAX_ORDERS_PER_DAY||2);
if([MAX_ORDER,MAX_DAILY,MAX_RISK,MAX_ORDERS].some(v=>!Number.isFinite(v)||v<=0)||MAX_ORDER>1000||MAX_DAILY>5000||MAX_RISK>100)throw Error('Unsafe limits');
const realConfigured=MODE==='live'&&process.env.LIVE_TRADING_ENABLED==='true'&&KEY&&SECRET&&OPERATOR_TOKEN.length>=32;
const testnetConfigured=MODE==='testnet'&&KEY&&SECRET&&OPERATOR_TOKEN.length>=32;
const BASE=MODE==='testnet'?'https://testnet.binance.vision':'https://api.binance.com';
const MARKET_BASE='https://data-api.binance.vision';const DATA_DIR=path.join(ROOT,'.runtime');fs.mkdirSync(DATA_DIR,{recursive:true,mode:0o700});
const STATE_PATH=path.join(DATA_DIR,'state.json'),JOURNAL=path.join(DATA_DIR,'audit.jsonl');
function loadState(){try{const s=JSON.parse(fs.readFileSync(STATE_PATH,'utf8'));return {kill:!!s.kill,daily:s.daily||{},paper:s.paper||{cash:10000,positions:{},fills:[]}};}catch{return {kill:false,daily:{},paper:{cash:10000,positions:{},fills:[]}};}}
const state=loadState();let armed=false,executing=false;const tickets=new Map();const lastMarket=new Map();
function save(){const temp=STATE_PATH+'.tmp';fs.writeFileSync(temp,JSON.stringify(state),{mode:0o600});fs.renameSync(temp,STATE_PATH);}
function audit(type,entry={}){fs.appendFileSync(JOURNAL,JSON.stringify({at:new Date().toISOString(),type,...entry})+'\n',{mode:0o600});}
const limits={maxOrderUsdt:MAX_ORDER,maxDailyNotionalUsdt:MAX_DAILY,maxEstimatedRiskUsdt:MAX_RISK,maxOrdersPerDay:MAX_ORDERS};
function fail(msg,status=400){const e=new Error(msg);e.status=status;throw e;}
function dayKey(){return new Date().toISOString().slice(0,10)}
function todayUsage(){return state.daily[dayKey()]||{notional:0,orders:0};}
function ensureDaily(amount){const d=todayUsage();if(d.orders>=MAX_ORDERS||d.notional+amount>MAX_DAILY)fail('Daily order-count or gross-notional cap reached');}
function reserveDaily(amount){const date=dayKey();const d=todayUsage();state.daily[date]={orders:d.orders+1,notional:Math.round((d.notional+amount)*100)/100};save();}
function authenticated(req){if(OPERATOR_TOKEN.length<32)return false;const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const a=Buffer.from(token),b=Buffer.from(OPERATOR_TOKEN);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function headers(extra={}){return {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; connect-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",...extra};}
function send(res,status,obj){res.writeHead(status,headers());res.end(JSON.stringify(obj));}
async function readBody(req){let body='';for await(const chunk of req){body+=chunk.toString();if(body.length>15000)fail('Request too large',413);}try{return JSON.parse(body||'{}');}catch{fail('Invalid JSON');}}
async function publicGet(apiPath){const u=MARKET_BASE+apiPath;const r=await fetch(u,{signal:AbortSignal.timeout(9000),headers:{'Accept':'application/json'}});if(!r.ok)fail('Exchange public market feed returned HTTP '+r.status,503);return r.json();}
async function signed(method,apiPath,params={}){
 if(!KEY||!SECRET)fail('Exchange credentials not configured',503);
 const search=new URLSearchParams({...params,timestamp:String(Date.now()),recvWindow:'5000'}).toString();
 const signature=crypto.createHmac('sha256',SECRET).update(search).digest('hex');
 const url=BASE+apiPath+'?'+search+'&signature='+signature;
 const r=await fetch(url,{method,headers:{'X-MBX-APIKEY':KEY,'Accept':'application/json'},signal:AbortSignal.timeout(10000)});
 let result;try{result=await r.json()}catch{fail('Unparseable exchange response; verify status manually',502)}
 if(!r.ok)fail('Exchange rejected request: '+String(result?.msg||r.status).slice(0,180),502);
 return result;
}
async function fetchAnalysis(symbol,interval){if(!SYMBOLS.includes(symbol)||!INTERVALS.includes(interval))fail('Unsupported symbol/timeframe');const rows=await publicGet(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=150`);let a=analyze(rows,Date.now(),interval);lastMarket.set(symbol+'-'+interval,{at:Date.now(),a});return a;}
async function exchangeInfo(symbol){const r=await publicGet('/api/v3/exchangeInfo?symbol='+symbol);const market=r?.symbols?.find(s=>s.symbol===symbol);if(!market||market.status!=='TRADING')fail('Symbol is not actively tradable',503);return market;}
async function latestPrice(symbol){const p=await publicGet('/api/v3/ticker/price?symbol='+symbol);const price=Number(p.price);if(!(price>0))fail('Missing fresh market price',503);return price;}
function plannedTicket(b){if(!SYMBOLS.includes(b.symbol)||!INTERVALS.includes(b.interval))fail('Symbol/interval not permitted');if(!['BUY','SELL'].includes(b.side))fail('Side not allowed');if(!Number.isFinite(Number(b.amount))||!Number.isFinite(Number(b.limitPrice))||!Number.isFinite(Number(b.stopPrice)))fail('Invalid order fields');}
async function createTicket(body){plannedTicket(body);const symbol=body.symbol,interval=body.interval,side=body.side,quoteAmount=Number(body.amount),limitPrice=Number(body.limitPrice),stopPrice=Number(body.stopPrice);
 const a=await fetchAnalysis(symbol,interval);let risk;try{risk=validateOrder({symbol,side,quoteAmount,limitPrice,stopPrice,analysis:a,limits});}catch(e){fail(e.message,400);}
 const spot=await latestPrice(symbol);if(Math.abs(limitPrice/spot-1)>.0075)fail('Order price exceeds fresh ticker deviation limit');
 ensureDaily(quoteAmount);const id=crypto.randomBytes(8).toString('hex').toUpperCase();const ticket={id,symbol,interval,side,quoteAmount,limitPrice,stopPrice,created:Date.now(),expires:Date.now()+90000,engineScore:a.score,engineReason:a.veto,estimatedRisk:risk.estimatedRisk,used:false};tickets.set(id,ticket);audit('TICKET_CREATED',{id,symbol,side,quoteAmount,mode:MODE});return ticket;}
async function commitOrder(ticket){const m=await exchangeInfo(ticket.symbol);if(!m.isSpotTradingAllowed)fail('Not spot tradable');const filters=m.filters||[];const lot=filters.find(x=>x.filterType==='LOT_SIZE');const notional=filters.find(x=>x.filterType==='NOTIONAL'||x.filterType==='MIN_NOTIONAL');const pf=filters.find(x=>x.filterType==='PRICE_FILTER');
 const qty=stepRound(ticket.quoteAmount/ticket.limitPrice,lot?.stepSize||'0.000001');const quantity=Number(qty);
 if(!(quantity>0)||quantity<Number(lot?.minQty||0)||quantity>Number(lot?.maxQty||Infinity))fail('Order fails LOT_SIZE check');
 if(Number(pf?.tickSize||0)>0){const normalized=stepRound(ticket.limitPrice,pf.tickSize);if(Math.abs(Number(normalized)-ticket.limitPrice)>1e-8)fail('Price does not match exchange tickSize');}
 const minNotional=Number(notional?.minNotional||0);if(quantity*ticket.limitPrice<minNotional)fail('Order below exchange minimum notional');
 const params={symbol:ticket.symbol,side:ticket.side,type:'LIMIT',timeInForce:'GTC',quantity:qty,price:String(ticket.limitPrice),newClientOrderId:'AIF'+ticket.id};
 // Order may be accepted but response lost. Never retry automatically.
 const result=await signed('POST','/api/v3/order',params);
 return {orderId:result.orderId,clientOrderId:result.clientOrderId,status:result.status,executedQty:result.executedQty,symbol:ticket.symbol,side:ticket.side};
}
function paperTrade(ticket){const account=state.paper;const quantity=ticket.quoteAmount/ticket.limitPrice;const fee=ticket.quoteAmount*.001;
 if(ticket.side==='BUY'){if(account.cash<ticket.quoteAmount+fee)fail('Insufficient virtual USDT');account.cash-=ticket.quoteAmount+fee;account.positions[ticket.symbol]=(account.positions[ticket.symbol]||0)+quantity;}
 else{if((account.positions[ticket.symbol]||0)<quantity-1e-9)fail('Insufficient virtual inventory');account.positions[ticket.symbol]-=quantity;account.cash+=ticket.quoteAmount-fee;}
 const fill={id:ticket.id,time:Date.now(),symbol:ticket.symbol,side:ticket.side,qty:quantity,limitPrice:ticket.limitPrice,fee,mode:'SIMULATED'};account.fills.unshift(fill);account.fills=account.fills.slice(0,250);save();return fill;
}
function desk(a,symbol){return [
 {role:'Desk Lead',result:`${symbol}: ${a.decision}. Real-money orders require operator approval.`},
 {role:'Market Intelligence',result:`Trend ${a.bias}; ${a.volumeRatio.toFixed(2)}x volume; ${a.structure.replaceAll('_',' ')}.`},
 {role:'Strategy Analyst',result:`Rule score ${a.score}/100. ${a.reasons.map(r=>r.name+': '+r.points).join(' · ')}. Not a win probability.`},
 {role:'Risk Officer',result:a.veto},
 {role:'Execution Control',result:'LIMIT spot tickets only, restricted symbols, gross daily cap, short expiry, explicit confirmation. STOP is a reference only.'},
 {role:'Audit & Compliance',result:'All ticket creation and submission attempts are recorded. No automatic withdrawals, leverage or futures.'}];}
async function explainAI(a,symbol){if(!process.env.OPENAI_API_KEY)return {provider:'RULE_BASED',answer:`${symbol} has a ${a.bias.toLowerCase()} technical bias (${a.score}/100). ${a.reasons.map(x=>x.explain).join('. ')}. Gate: ${a.decision}, ${a.veto}. This is not a trade instruction.`};
 const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-6-luna',instructions:'You are a cautious English-language market research explainer. Only explain the structured data supplied. Do not recommend a trade, guarantee profits, or claim to have placed an order. Do not output instructions to bypass risk controls.',input:JSON.stringify({symbol,score:a.score,bias:a.bias,reasons:a.reasons,health:a.dataHealth,gate:a.decision,veto:a.veto}),max_output_tokens:450}),signal:AbortSignal.timeout(20000)});
 if(!r.ok)fail('AI explanation provider unavailable',503);const x=await r.json();const answer=x.output_text||x.output?.flatMap(y=>y.content||[]).filter(z=>z.type==='output_text').map(z=>z.text).join('\n');if(!answer)fail('AI explanation empty',503);return {provider:'OPTIONAL_LLM',answer};}
async function backtest(symbol,interval){const raw=await publicGet(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=700`);const now=Date.now();const xs=raw.filter(x=>Number(x[6])<now).map(r=>({open:Number(r[1]),close:Number(r[4])}));if(xs.length<200)fail('Insufficient historical candles');
 // Fixed EMA20/50 long-only, next-bar open, 70/30 chronological OOS, 0.1% fee per side + 0.05% slippage.
 const closes=xs.map(x=>x.close);const EMA=n=>{const result=Array(xs.length).fill(null);let p=null;for(let i=n-1;i<xs.length;i++){if(p===null)p=closes.slice(0,n).reduce((a,b)=>a+b,0)/n;else p=p+(2/(n+1))*(closes[i]-p);result[i]=p;}return result;};const e20=EMA(20),e50=EMA(50),split=Math.floor(xs.length*.7);
 function run(start,end){let cash=1000,qty=0,trades=0,peak=1000,dd=0,prevUp=null,wins=0,entry=0;for(let i=Math.max(51,start);i<end-1;i++){const up=e20[i]>e50[i],next=xs[i+1].open;const previous=prevUp;prevUp=up;if(previous===null||!(next>0))continue;if(up&&!previous&&!qty){const spend=cash*.25;qty=spend*(1-.001)/ (next*1.0005);cash-=spend;entry=spend;trades++;}if(!up&&previous&&qty){const proceeds=qty*next*.9995*(1-.001);if(proceeds>entry)wins++;cash+=proceeds;qty=0;}let eq=cash+qty*xs[i].close;peak=Math.max(peak,eq);dd=Math.max(dd,(peak-eq)/peak*100);}return {returnPct:((cash+qty*xs[end-1].close)/1000-1)*100,maxDrawdownPct:dd,trades,wins};}
 return {symbol,interval,bars:xs.length,method:'EMA20/50 cross, next-open fills, 25% allocation, 0.1% fee plus 0.05% slippage per side',training:run(0,split),outOfSample:run(split,xs.length)};}
async function api(req,res,url){if(!authenticated(req))fail('Operator token required. Set OPERATOR_TOKEN (32+ characters) on the server.',401);
 const key=url.pathname,method=req.method; if(key==='/api/status'&&method==='GET')return send(res,200,{mode:MODE,configured:MODE==='paper'||Boolean(realConfigured||testnetConfigured),armed,kill:state.kill,limits,usage:todayUsage(),hasLLM:!!process.env.OPENAI_API_KEY,note:'Reference stop is NOT an exchange stop order. Orders are operator-confirmed LIMIT spot only.'});
 if(key==='/api/market'&&method==='GET'){const symbol=url.searchParams.get('symbol')||'BTCUSDT',tf=url.searchParams.get('interval')||'15m';return send(res,200,{symbol,interval:tf,analysis:await fetchAnalysis(symbol,tf)});}
 if(key==='/api/radar'&&method==='GET'){const out=await Promise.allSettled(SYMBOLS.map(async symbol=>({symbol,analysis:await fetchAnalysis(symbol,'15m')})));return send(res,200,{results:out.map((x,i)=>x.status==='fulfilled'?x.value:{symbol:SYMBOLS[i],unavailable:true,error:String(x.reason.message||x.reason)})});}
 if(key==='/api/depth'&&method==='GET'){const symbol=url.searchParams.get('symbol')||'BTCUSDT';if(!SYMBOLS.includes(symbol))fail('Unsupported symbol');const depth=await publicGet(`/api/v3/depth?symbol=${symbol}&limit=20`),bids=depth.bids.map(r=>({price:Number(r[0]),qty:Number(r[1])})),asks=depth.asks.map(r=>({price:Number(r[0]),qty:Number(r[1])}));return send(res,200,{symbol,bids,asks,timestamp:Date.now(),note:'Visible order book snapshot only; orders may change or be canceled.'});}
 if(key==='/api/backtest'&&method==='GET'){const symbol=url.searchParams.get('symbol')||'BTCUSDT',tf=url.searchParams.get('interval')||'15m';if(!SYMBOLS.includes(symbol)||!INTERVALS.includes(tf))fail('Invalid market');return send(res,200,await backtest(symbol,tf));}
 if(key==='/api/desk'&&method==='GET'){const symbol=url.searchParams.get('symbol')||'BTCUSDT',tf=url.searchParams.get('interval')||'15m';const a=await fetchAnalysis(symbol,tf);return send(res,200,{roles:desk(a,symbol)});}
 if(key==='/api/explain'&&method==='GET'){const symbol=url.searchParams.get('symbol')||'BTCUSDT',tf=url.searchParams.get('interval')||'15m';return send(res,200,await explainAI(await fetchAnalysis(symbol,tf),symbol));}
 if(key==='/api/portfolio'&&method==='GET'){if(MODE==='paper')return send(res,200,{mode:MODE,account:state.paper});if(!KEY||!SECRET)fail('Exchange keys not configured',503);const a=await signed('GET','/api/v3/account');return send(res,200,{mode:MODE,balances:a.balances.filter(x=>Number(x.free)>0||Number(x.locked)>0).filter(x=>['USDT','BTC','ETH','SOL','BNB','XRP'].includes(x.asset))});}
 if(key==='/api/ticket'&&method==='POST'){if(state.kill)fail('Kill switch is engaged',403);const b=await readBody(req);return send(res,200,{ticket:await createTicket(b),mode:MODE,requiresOperatorConfirmation:true,warning:'Reference stop is not placed on exchange. A LIMIT order may remain open without protection.'});}
 if(key==='/api/arm'&&method==='POST'){if(state.kill)fail('Kill switch engaged; restart and manually clear kill lock from runtime state after investigation.',403);if(MODE==='live'&&!realConfigured)fail('Live trading disabled or keys/token absent',403);if(MODE==='testnet'&&!testnetConfigured)fail('Testnet keys/token absent',403);let b=await readBody(req);if(b.phrase!==`ARM ${MODE.toUpperCase()}`)fail(`Type ARM ${MODE.toUpperCase()} exactly`);armed=true;audit('ARMED',{mode:MODE});return send(res,200,{armed:true,mode:MODE});}
 if(key==='/api/execute'&&method==='POST'){
   const b=await readBody(req),t=tickets.get(b.id);if(!t||t.used||Date.now()>t.expires)fail('Ticket missing, expired or previously used',409);
   if(b.phrase!==`EXECUTE ${t.id}`)fail('Explicit ticket phrase mismatch',403);if(!armed||state.kill)fail('Order execution disarmed',403);if(MODE==='live'&&!realConfigured)fail('Live mode not configured',403);if(MODE==='testnet'&&!testnetConfigured)fail('Testnet not configured',403);
   if(executing)fail('An exchange order is already processing',409);executing=true;t.used=true;
   try{const fresh=await fetchAnalysis(t.symbol,t.interval),quote=await latestPrice(t.symbol);try{validateOrder({symbol:t.symbol,side:t.side,quoteAmount:t.quoteAmount,limitPrice:t.limitPrice,stopPrice:t.stopPrice,analysis:fresh,limits});}catch(e){fail(e.message,400);}if(Math.abs(quote/t.limitPrice-1)>.0075)fail('Market moved: ticket must be recreated');ensureDaily(t.quoteAmount);
     // Reserve before sending: a timeout could still mean a filled order. Fail closed, never retry an ambiguous send.
     reserveDaily(t.quoteAmount);audit('ORDER_ATTEMPT',{id:t.id,symbol:t.symbol,side:t.side,mode:MODE,notional:t.quoteAmount});
     const outcome=MODE==='paper'?paperTrade(t):await commitOrder(t);audit('ORDER_RESPONSE',{id:t.id,mode:MODE,outcome});return send(res,200,{mode:MODE,outcome,note:MODE==='live'?'LIVE Binance order submitted; verify exchange status and stop protection.':'Not real-money execution.'});
   }catch(e){audit('ORDER_FAILED_OR_UNKNOWN',{id:t.id,mode:MODE,error:String(e.message).slice(0,150)});throw e;}finally{executing=false;armed=false;}
 }
 if(key==='/api/order-status'&&method==='GET'){if(MODE==='paper')fail('No exchange order in paper mode');const id=url.searchParams.get('id');if(!/^[A-F0-9]{16}$/.test(id||''))fail('Invalid ticket id');const t=tickets.get(id);if(!t)fail('Order ticket not held on this server; consult exchange');return send(res,200,{order:await signed('GET','/api/v3/order',{symbol:t.symbol,origClientOrderId:'AIF'+id})});}
 if(key==='/api/kill'&&method==='POST'){state.kill=true;armed=false;tickets.clear();save();audit('KILL_ENGAGED',{mode:MODE});return send(res,200,{kill:true,note:'Blocks new orders from THIS app only. Does not cancel existing exchange orders or close positions.'});}
 if(key==='/api/audit'&&method==='GET'){let lines=[];try{lines=fs.readFileSync(JOURNAL,'utf8').trim().split('\n').slice(-40).map(s=>JSON.parse(s)).reverse()}catch{}return send(res,200,{events:lines});}
 fail('Unknown endpoint',404);
}
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/')){if(req.method!=='GET'&&req.method!=='POST')fail('Method not allowed',405);const origin=req.headers.origin;if(origin&&origin!==`http://${HOST}:${PORT}`)fail('Cross-site requests denied',403);return await api(req,res,url);}
 let p=url.pathname==='/'?'/index.html':url.pathname;if(!/^\/[a-zA-Z0-9._\/-]+$/.test(p)||p.includes('..'))fail('Invalid path',404);const file=path.resolve(ROOT,'public',p.slice(1));if(!file.startsWith(path.join(ROOT,'public')+path.sep))fail('Forbidden',403);
 const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
 if(!types[path.extname(file)]||!fs.existsSync(file))fail('Not found',404);res.writeHead(200,{...headers(),'Content-Type':types[path.extname(file)]});fs.createReadStream(file).pipe(res);
 }catch(e){send(res,e.status||503,{error:String(e.message||e).slice(0,200)});}});
if(require.main===module){server.listen(PORT,HOST,()=>{console.log(`TradeLab 5.0 server at http://${HOST}:${PORT}; MODE=${MODE}; liveConfigured=${Boolean(realConfigured)}; keyConfigured=${Boolean(KEY&&SECRET)}. No order is placed until armed and individually confirmed.`);});}
module.exports={server,MODE,limits,desk};
