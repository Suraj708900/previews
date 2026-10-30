'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const token=crypto.randomBytes(32).toString('hex');process.env.OPERATOR_TOKEN=token;process.env.TRADING_MODE='paper';
const nativeFetch=global.fetch;let mockedCalls=0;
function candles(){const now=Date.now();return Array.from({length:150},(_,i)=>{const t=now-(150-i)*900000,p=100+i*.3;return [t,String(p),String(p+1),String(p-1),String(p+.2),String(100+(i%6)*10),t+899999];});}
global.fetch=async(url,options)=>{const u=String(url);if(u.startsWith('https://data-api.binance.vision')){mockedCalls++;let data;if(u.includes('/klines?'))data=candles();else if(u.includes('/ticker/price'))data={price:'144.9'};else if(u.includes('/depth?'))data={bids:[['144','10']],asks:[['145','9']]};else throw Error('Unexpected mock public API '+u);return {ok:true,json:async()=>data};}return nativeFetch(url,options);};
const {server}=require('../server');
test('private backend end-to-end paper ticket + approval + idempotency + kill lock',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port,root=`http://127.0.0.1:${port}`;
 async function api(route,method='GET',body,auth=true){const r=await nativeFetch(root+route,{method,headers:{...(auth?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
 try{
 const unauth=await api('/api/status','GET',null,false);assert.equal(unauth.status,401);
 const s=await api('/api/status');assert.equal(s.data.mode,'paper');assert.equal(s.data.armed,false);
 const m=await api('/api/market?symbol=BTCUSDT&interval=15m');assert.equal(m.status,200);assert.ok(m.data.analysis.dataHealth.fresh);
 const noTicket=await api('/api/ticket','POST',{symbol:'BTCUSDT',interval:'15m',side:'BUY',amount:10,limitPrice:200,stopPrice:195});assert.equal(noTicket.status,400);
 const ticket=await api('/api/ticket','POST',{symbol:'BTCUSDT',interval:'15m',side:'BUY',amount:10,limitPrice:144.9,stopPrice:143.45});assert.equal(ticket.status,200,JSON.stringify(ticket.data));const id=ticket.data.ticket.id;
 const noArm=await api('/api/execute','POST',{id,phrase:'EXECUTE '+id});assert.equal(noArm.status,403);
 const armed=await api('/api/arm','POST',{phrase:'ARM PAPER'});assert.equal(armed.status,200);
 const wrongPhrase=await api('/api/execute','POST',{id,phrase:'EXECUTE WRONG'});assert.equal(wrongPhrase.status,403);
 const fill=await api('/api/execute','POST',{id,phrase:'EXECUTE '+id});assert.equal(fill.status,200,JSON.stringify(fill.data));assert.equal(fill.data.outcome.mode,'SIMULATED');
 const duplicate=await api('/api/execute','POST',{id,phrase:'EXECUTE '+id});assert.equal(duplicate.status,409);
 const portfolio=await api('/api/portfolio');assert.ok(portfolio.data.account.cash<10000);
 const killed=await api('/api/kill','POST',{});assert.equal(killed.data.kill,true);
 const denied=await api('/api/arm','POST',{phrase:'ARM PAPER'});assert.equal(denied.status,403);
 assert.ok(mockedCalls>=2);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
