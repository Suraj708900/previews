'use strict';
const SYMBOLS = Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT']);
const INTERVALS = Object.freeze(['5m','15m','1h','4h']);
const finite = x => typeof x==='number'&&Number.isFinite(x);
function mean(a){return a.reduce((s,v)=>s+v,0)/a.length;}
function ema(values,period){if(values.length<period) return null;const alpha=2/(period+1);let result=mean(values.slice(0,period));for(let i=period;i<values.length;i++)result=alpha*values[i]+(1-alpha)*result;return result;}
function analyze(raw,now=Date.now(),interval='15m'){
  const ms={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000}[interval];
  if(!ms) throw Error('Invalid interval');
  if(!Array.isArray(raw)||raw.length<65) throw Error('Insufficient candles');
  const bars=raw.map(r=>({openAt:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closeAt:Number(r[6])}));
  const closed=bars.filter(b=>b.closeAt<now);
  if(closed.length<60||!closed.every(b=>finite(b.open)&&finite(b.high)&&finite(b.low)&&finite(b.close)&&finite(b.volume)&&b.low>0&&b.high>=b.low&&b.close>=b.low&&b.close<=b.high)) throw Error('Invalid market candles');
  const last=closed.at(-1),close=closed.map(x=>x.close),vol=closed.slice(-21,-1).map(x=>x.volume);
  const e20=ema(close,20),e50=ema(close,50);
  const recent=closed.slice(-15),prev=closed.slice(-16,-1);
  const r=recent.map(x=>x.high-x.low),atr=mean(r),volAvg=mean(vol),volumeRatio=volAvg>0?last.volume/volAvg:0;
  const high20=Math.max(...closed.slice(-21,-1).map(x=>x.high)),low20=Math.min(...closed.slice(-21,-1).map(x=>x.low));
  const up=e20>e50&&last.close>e20,down=e20<e50&&last.close<e20;
  const breakout=last.close>high20?'BULLISH_BREAK_OF_STRUCTURE':last.close<low20?'BEARISH_BREAK_OF_STRUCTURE':'NONE';
  const fairGaps=[];
  for(let i=Math.max(2,closed.length-40);i<closed.length;i++){
    let a=closed[i-2],c=closed[i];
    if(c.low>a.high)fairGaps.push({side:'BULLISH',low:a.high,high:c.low,at:c.openAt});
    if(c.high<a.low)fairGaps.push({side:'BEARISH',low:c.high,high:a.low,at:c.openAt});
  }
  const latestGap=fairGaps.at(-1)||null;
  const spreadVol=atr/last.close*100;
  const reasons=[
    {name:'EMA trend',points:up?24:down?-24:0,explain:up?'EMA20 is above EMA50 and price is above EMA20':down?'EMA20 is below EMA50 and price is below EMA20':'Trend alignment is mixed'},
    {name:'Price momentum',points:last.close>close.at(-6)?14:-14,explain:last.close>close.at(-6)?'Price above its five-candle reference':'Price below its five-candle reference'},
    {name:'Volume',points:volumeRatio>1.4?(up?10:down?-10:0):0,explain:`Last closed-candle volume is ${volumeRatio.toFixed(2)}× its 20-candle average`},
    {name:'Structure',points:breakout.startsWith('BULLISH')?12:breakout.startsWith('BEARISH')?-12:0,explain:breakout==='NONE'?'No fresh 20-candle structure break':breakout.replaceAll('_',' ').toLowerCase()},
    {name:'FVG',points:latestGap?.side==='BULLISH'?5:latestGap?.side==='BEARISH'?-5:0,explain:latestGap?`${latestGap.side.toLowerCase()} historical fair value gap located`:'No recent fair value gap'}
  ];
  const score=Math.max(0,Math.min(100,50+reasons.reduce((s,x)=>s+x.points,0)));
  const age=now-last.closeAt;
  const fresh=age>=0&&age<ms*2+60000;
  const dataHealth={source:'BINANCE_PUBLIC',fresh,lastClosedAt:last.closeAt,ageMs:age,count:closed.length};
  let veto=null;
  if(!fresh)veto='Market data is stale';
  else if(spreadVol>4)veto='Volatility exceeds the configured safety threshold';
  else if(score>40&&score<65)veto='Confluence is not decisive';
  else if(!up)veto='Long entry requires aligned bullish trend';
  const decision=veto?'NO_TRADE':'WATCH_ONLY';
  return {price:last.close,ema20:e20,ema50:e50,score,bias:score>=65?'BULLISH':score<=35?'BEARISH':'NEUTRAL',decision,veto:veto||'Technical conditions passed; this is NOT an order recommendation',structure:breakout,fvg:latestGap,volumeRatio,volatilityPct:spreadVol,reasons,dataHealth,bars:closed.slice(-85).map(b=>({time:b.openAt,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume}))};
}
function stepRound(qty,step){let n=Number(step);if(!finite(n)||n<=0)throw Error('Invalid exchange lot size');let d=(String(step).split('.')[1]||'').replace(/0+$/,'').length;return (Math.floor((qty+1e-12)/n)*n).toFixed(Math.min(12,d));}
function validateOrder({symbol,side,quoteAmount,limitPrice,stopPrice,analysis,limits}){
 if(!SYMBOLS.includes(symbol))throw Error('Symbol not allowed');
 if(!['BUY','SELL'].includes(side))throw Error('Side must be BUY or SELL');
 if(!finite(quoteAmount)||quoteAmount<5||quoteAmount>limits.maxOrderUsdt)throw Error(`Order notional must be $5–$${limits.maxOrderUsdt}`);
 if(!finite(limitPrice)||limitPrice<=0||!finite(stopPrice)||stopPrice<=0)throw Error('Invalid limit or reference stop');
 if(!analysis?.dataHealth?.fresh)throw Error('Verified fresh market data required');
 if(Math.abs(limitPrice/analysis.price-1)>0.0075)throw Error('Limit price more than 0.75% away from market');
 if(side==='BUY'&&stopPrice>=limitPrice)throw Error('Buy reference stop must be below limit price');
 if(side==='SELL'&&stopPrice<=limitPrice)throw Error('Sell reference stop must be above limit price');
 const estimatedRisk=quoteAmount*Math.abs(limitPrice-stopPrice)/limitPrice;
 if(estimatedRisk>limits.maxEstimatedRiskUsdt)throw Error(`Estimated price risk exceeds $${limits.maxEstimatedRiskUsdt}`);
 if(side==='BUY'&&analysis.decision==='NO_TRADE')throw Error('AI risk gate vetoed this buy');
 return {estimatedRisk,referenceStopIsNotExchangeOrder:true};
}
module.exports={SYMBOLS,INTERVALS,analyze,stepRound,validateOrder};
