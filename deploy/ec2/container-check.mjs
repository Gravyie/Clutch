// Mount at /app/engine/container-check.mjs inside the built image. Local RPC fixture only; no transactions.
import assert from 'node:assert/strict';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { encodeAbiParameters, toFunctionSelector } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import WebSocket from 'ws';
const manifest=JSON.parse(readFileSync('/app/contracts/deployments/84532.json','utf8'));
const agent=privateKeyToAccount(process.env.AGENT_PRIVATE_KEY).address;
const signer=privateKeyToAccount(process.env.PASS_SIGNER_PRIVATE_KEY).address;
const values={engine:agent,resolver:agent,owner:manifest.owner,signer,usdc:manifest.usdc,gate:manifest.humanPassGate,vault:manifest.lpVault};
const selectors=new Map(Object.entries(values).map(([name,value])=>[toFunctionSelector(`${name}()`),encodeAbiParameters([{type:'address'}],[value])]));
let writes=0;
const hash='0x'+'1'.repeat(64);
const rpc=https.createServer({key:readFileSync('/run/check/tls.key'),cert:readFileSync('/run/check/tls.crt')},async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  function respond(q){
    let result;
    if(q.method.startsWith('eth_send')){writes++;return {jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'All signing/broadcast disabled in fixture'}};}
    if(q.method==='eth_chainId')result='0x'+(84532).toString(16);
    else if(q.method==='eth_getCode')result='0x6000';
    else if(q.method==='eth_blockNumber')result='0x3938700';
    else if(q.method==='eth_getLogs')result=[];
    else if(q.method==='eth_getBlockByNumber')result={number:'0x3938700',hash,parentHash:hash,nonce:'0x0000000000000000',sha3Uncles:hash,logsBloom:'0x'+'0'.repeat(512),transactionsRoot:hash,stateRoot:hash,receiptsRoot:hash,miner:manifest.owner,difficulty:'0x0',totalDifficulty:'0x0',extraData:'0x',size:'0x1',gasLimit:'0x1c9c380',gasUsed:'0x0',timestamp:'0x'+Math.floor(Date.now()/1000).toString(16),transactions:[],uncles:[],baseFeePerGas:'0x1'};
    else if(q.method==='eth_call')result=selectors.get((q.params[0].data??'').slice(0,10));
    if(result===undefined)return {jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'Read unsupported by local fixture'}};
    return {jsonrpc:'2.0',id:q.id,result};
  }
  try{const q=JSON.parse(raw);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(Array.isArray(q)?q.map(respond):respond(q)));}catch{res.writeHead(400).end();}
});
rpc.listen(19443,'127.0.0.1');await once(rpc,'listening');
const child=spawn(process.execPath,['dist/main.mjs'],{env:{...process.env,RPC_URL:'https://localhost:19443',NODE_EXTRA_CA_CERTS:'/run/check/tls.crt'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
let exit;
child.on('exit',(code)=>{exit=code;});
async function snapshot(){
  const ws=new WebSocket('ws://127.0.0.1:8787/ws');
  await once(ws,'open');const message=once(ws,'message');
  ws.send(JSON.stringify({type:'sub',channels:['global']}));
  const [data]=await message;assert.equal(JSON.parse(String(data)).type,'hello');ws.close();await once(ws,'close');
}
try{
  let ready=false;
  for(let i=0;i<100;i++){
    if(exit!==undefined)throw new Error(`Engine exited during startup (${exit}): ${logs}`);
    try{const r=await fetch('http://127.0.0.1:8787/ready');ready=r.ok;if(ready){assert.equal((await r.json()).chainId,84532);break;}}catch{}
    await delay(200);
  }
  assert.ok(ready,`Bundled engine did not become ready: ${logs}`);
  const health=await fetch('http://127.0.0.1:8787/health',{headers:{Origin:'https://example.vercel.app'}});
  assert.equal(health.headers.get('access-control-allow-origin'),'https://example.vercel.app');
  assert.equal((await health.json()).chainId,84532);
  const config=await(await fetch('http://127.0.0.1:8787/config')).json();assert.equal(config.deployment.clutchHook,manifest.clutchHook);
  await snapshot();await snapshot();
  assert.equal(writes,0,'Container check must never submit a transaction');
  child.kill('SIGTERM');await once(child,'exit');assert.equal(exit,0);
  console.log(JSON.stringify({ok:true,rpc:'LOCAL TLS FIXTURE',chainId:84532,bundledEngine:true,ready:true,cors:true,websocketReconnect:true,shutdown:true,transactionsSent:writes}));
}catch(e){child.kill('SIGKILL');throw e;}
finally{rpc.close();}
