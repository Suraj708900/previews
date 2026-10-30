const assert=require('node:assert/strict');
const {findFVGs, findSwingStructure,advancedAnalysis}=require('./intelligence.js');
function makeBar(i, o,c,h,l){return {time:1700000000000+i*3600000,open:o,close:c,high:h,low:l,volume:100};}
const baseline=Array.from({length:70},(_,i)=>makeBar(i,100+(i%5)*.05,100+(i%5)*.05,101.1,98.9));
// Three-bar bullish FVG: candle[i].low > candle[i-2].high.
const bullish=baseline.slice();bullish[21]=makeBar(21,103,105,105.8,103);bullish[19]=makeBar(19,99,100,101,98);
const gaps=findFVGs(bullish,19);
assert(gaps.some(g=>g.type==='bull'&&g.index===21&&g.low===101&&g.high===103));
// Subsequent candle fills bullish FVG when low<=old upper gap boundary.
assert(gaps.some(g=>g.index===21&&g.status==='FILLED'));
const rising=Array.from({length:90},(_,i)=>{let center=100+i*.15+Math.sin(i*.6)*3;return makeBar(i,center-.1,center+.2,center+1,center-1.1)});
const smart=advancedAnalysis(rising);
assert(Number.isInteger(smart.score) && smart.score>=0&&smart.score<=100);
assert.equal(smart.reasons.length,5);
assert(smart.structure.pivots.length>0);
const structure=findSwingStructure(rising);
assert(structure.events.every(e=>['BOS','CHoCH'].includes(e.kind)));
assert(structure.pivots.every(x=>x.index>=3&&x.index<rising.length-3));
console.log('Algorithm checks passed:', {fvg:gaps.length,events:structure.events.length,score:smart.score});
