'use strict';const test=require('node:test');const assert=require('node:assert/strict');const {analyze,validateOrder,stepRound}=require('../engine');
const now=Date.now();function bars(up=true){return Array.from({length:120},(_,i)=>{const p=up?100+i*.3:160-i*.3;let time=now-(120-i)*900000;return [time,p,p+1,p-1,p+.2,100+(i%6)*10,time+899999];});}
test('bullish radar returns a traceable score',()=>{const a=analyze(bars(true),now,'15m');assert.equal(a.dataHealth.fresh,true);assert.ok(a.score>=65);assert.equal(a.dataHealth.source,'BINANCE_PUBLIC');assert.ok(a.reasons.length>3)});
test('bearish trend vetoed',()=>{const a=analyze(bars(false),now,'15m');assert.equal(a.decision,'NO_TRADE')});
test('stale feed vetoed',()=>{const x=bars(true);x.forEach(r=>{r[0]-=86400000;r[6]-=86400000});assert.equal(analyze(x,now,'15m').decision,'NO_TRADE')});
test('quantization',()=>assert.equal(stepRound(1.234567,'0.001000'), '1.234'));
test('strict risk cap',()=>{const a=analyze(bars(true),now,'15m');const limits={maxOrderUsdt:25,maxEstimatedRiskUsdt:.75}; assert.throws(()=>validateOrder({symbol:'BTCUSDT',side:'BUY',quoteAmount:50,limitPrice:a.price,stopPrice:a.price*.99,analysis:a,limits}));});
