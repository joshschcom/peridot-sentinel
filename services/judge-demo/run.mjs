// Invoke from the repository root. Signing is isolated by command and role.
import assert from 'node:assert/strict'
import {open,readJson} from './transport.mjs'
import {funding,refresh,setup} from './setup.mjs'
const [mode,phase,campaign='judge-01',...opts]=process.argv.slice(2)
assert(['fund','setup','refresh','policy-denials','swap','repay','deny-operator','revoke'].includes(phase),'Select a judge-demo phase')
assert(opts.length===0 || (phase==='setup' && opts.length===1 && /^--adopt-market=0x[0-9a-fA-F]{64}$/.test(opts[0])))
const s=await open(mode,campaign,phase)
try{
  if(phase==='fund'){await funding(s);console.log(JSON.stringify(s.state.plan))}
  else if(phase==='setup')console.log(await setup(s,opts[0]?.split('=')[1]))
  else {
    const m=readJson(s.dir+'/manifest.json')
    if(phase==='refresh') await refresh(s,m)
    else{const {execute}=await import('./operations.mjs');console.log(await execute(s,m))}
  }
}finally{s.close()}
