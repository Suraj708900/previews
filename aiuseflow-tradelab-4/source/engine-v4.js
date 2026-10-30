/* Pure, testable educational research helpers. No financial recommendations. */
'use strict';
const TradeEngine4 = (() => {
  const finite = x => Number.isFinite(Number(x));
  const safe = (x, fallback=0) => finite(x) ? Number(x) : fallback;
  function health({source, bars, interval, now=Date.now(), receivedAt=null}) {
    const periods={'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000};
    const ms=periods[interval]||3600000;
    if(source!=='live')return {status:'SAMPLE · NOT LIVE',isUsable:false,detail:'Synthetic demo candles. Analysis is for interface testing only.'};
    if(!Array.isArray(bars)||bars.length<55)return {status:'UNAVAILABLE',isUsable:false,detail:'Fewer than 55 valid candles.'};
    const newest=bars.at(-1),age=now-newest.time;
    const consistent=bars.every((b,i)=> i===0 || (Number.isFinite(b.time)&&b.time>bars[i-1].time&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)));
    const stale=age>ms*2+120000 || age< -ms;
    const freshFetch=receivedAt!=null && now-receivedAt<=120000;
    return {status:!consistent?'INVALID DATA':stale?'STALE CANDLES':!freshFetch?'OLD SNAPSHOT':'PUBLIC SNAPSHOT',isUsable:consistent&&!stale&&freshFetch,detail:`${bars.length} bars · last candle ${new Date(newest.time).toLocaleString('en-IN')} · received ${receivedAt?new Date(receivedAt).toLocaleTimeString('en-IN'):'unknown'}`};
  }
  function gate({source, smart, bars, interval, receivedAt, now=Date.now()}) {
    const h=health({source,bars,interval,receivedAt,now});
    if(!h.isUsable)return {status:'DO NOT TRADE',reason:h.status==='SAMPLE · NOT LIVE'?'Sample data cannot support a real trade.':h.detail,watchOnly:false};
    if(!smart)return {status:'DO NOT TRADE',reason:'Not enough validated indicators.',watchOnly:false};
    const atrPct=bars.length>20?(()=>{const b=bars.slice(-14);return 100*b.reduce((a,c)=>a+(c.high-c.low)/Math.max(c.close,1e-8),0)/b.length;})():0;
    if(atrPct>4.5)return {status:'HIGH VOLATILITY · WAIT',reason:`Mean recent candle range ${atrPct.toFixed(2)}% exceeds 4.5% threshold.`,watchOnly:false};
    if(smart.score>37&&smart.score<63)return {status:'UNCLEAR · WAIT',reason:`Score ${smart.score}/100 is mixed (38–62).`,watchOnly:false};
    const age=now-bars.at(-1).time;
    return {status:'WATCHLIST ONLY',reason:`${smart.bias}, score ${smart.score}/100, candle age ${Math.max(0,Math.round(age/60000))}m. Research checklist only, not a buy/sell command.`,watchOnly:true};
  }
  function liquidity(book){
    if(!book||!Array.isArray(book.bids)||!Array.isArray(book.asks))throw Error('Missing orderbook sides');
    const side = rows => rows.slice(0,20).map(r=>({price:safe(r[0]),qty:safe(r[1]),value:safe(r[0])*safe(r[1])})).filter(r=>r.price>0&&r.qty>0);
    const bids=side(book.bids),asks=side(book.asks);if(!bids.length||!asks.length)throw Error('Empty order book');
    const bidValue=bids.reduce((a,b)=>a+b.value,0),askValue=asks.reduce((a,b)=>a+b.value,0);
    const total=bidValue+askValue;
    return {bidValue,askValue,imbalance:total>0?(bidValue-askValue)/total:0,bestBid:bids[0].price,bestAsk:asks[0].price,bidWall:bids.reduce((a,b)=>b.value>a.value?b:a,bids[0]),askWall:asks.reduce((a,b)=>b.value>a.value?b:a,asks[0])};
  }
  const ema=(values,period)=>{const k=2/(period+1);let v=values[0];return values.map(n=>(v=n*k+v*(1-k)));};
  function backtest(rows,{fee=0.001,slip=0.0005,initial=1000,share=0.25}={}) {
    if(!Array.isArray(rows)||rows.length<110)throw Error('Need at least 110 CLOSED historical candles');
    if(![fee,slip,initial,share].every(Number.isFinite)||fee<0||slip<0||fee>.03||slip>.03||initial<=0||share<=0||share>1)throw Error('Invalid simulation parameters');
    const bars=rows.filter(b=>Number.isFinite(b.open)&&Number.isFinite(b.close)&&b.open>0&&b.close>0);
    if(bars.length<110)throw Error('Historical candles invalid');
    const e20=ema(bars.map(b=>b.close),20),e50=ema(bars.map(b=>b.close),50);
    const division=Math.floor(bars.length*.7);
    function segment(start,end){
      let cash=initial,qty=0,entryCost=0,peak=initial,dd=0,wins=0,losses=0,orders=0;
      let closed=0, holding=false;
      const trace=[];
      for(let i=start;i<end;i++){
        // Signal from the PREVIOUS fully closed candle; fill at this candle's OPEN.
        const prior=i-1,priorPrior=i-2;
        const crossedUp=e20[prior]>e50[prior]&&e20[priorPrior]<=e50[priorPrior];
        const crossedDown=e20[prior]<e50[prior]&&e20[priorPrior]>=e50[priorPrior];
        if(qty>0 && (crossedDown||i===end-1)){
          const sell=bars[i].open*(1-slip),gross=qty*sell,proceeds=gross*(1-fee);
          cash+=proceeds;const pnl=proceeds-entryCost;pnl>=0?wins++:losses++;closed++;orders++;qty=0;entryCost=0;holding=false;
        }else if(qty===0 && crossedUp && i!==end-1){
          const buy=bars[i].open*(1+slip),allocation=cash*share;
          const feeAdj=allocation/(1+fee);qty=feeAdj/buy;entryCost=allocation;cash-=allocation;orders++;holding=true;
        }
        const eq=cash+qty*bars[i].close*(1-slip)*(1-fee);
        peak=Math.max(peak,eq);dd=Math.max(dd,(peak-eq)/peak);trace.push(eq);
      }
      return {initial,final:cash,returnPct:100*(cash/initial-1),maxDrawdownPct:100*dd,trades:closed,wins,losses,winRate:closed?100*wins/closed:null,orders,trace};
    }
    return {train:segment(52,division),test:segment(division,bars.length),trainCount:division-52,testCount:bars.length-division,totalBars:bars.length};
  }
  function paperBuy(account, {symbol, price, amount, source, time=Date.now(), fee=.001, slip=.0005}) {
    if(!Number.isFinite(price)||price<=0||!Number.isFinite(amount)||amount<=0||amount>account.cash)throw Error('Insufficient virtual cash or invalid amount');
    const fill=price*(1+slip),qty=(amount/(1+fee))/fill;
    return {...account,cash:account.cash-amount,positions:[...account.positions,{id:String(time)+'-'+account.positions.length,symbol,qty,entry:fill,cost:amount,source,time}],fills:[...account.fills,{action:'BUY',symbol,cost:amount,at:fill,source,time}].slice(-200)};
  }
  function paperSell(account,id,price,time=Date.now(),fee=.001,slip=.0005){
    const pos=account.positions.find(p=>p.id===id);if(!pos)throw Error('Unknown position');if(!(price>0))throw Error('Invalid sale price');
    const sale=price*(1-slip),received=pos.qty*sale*(1-fee),pnl=received-pos.cost;
    return {...account,cash:account.cash+received,positions:account.positions.filter(p=>p.id!==id),fills:[...account.fills,{action:'SELL',symbol:pos.symbol,received,pnl,at:sale,source:pos.source,time}].slice(-200)};
  }
  return {health,gate,liquidity,backtest,paperBuy,paperSell};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=TradeEngine4;

