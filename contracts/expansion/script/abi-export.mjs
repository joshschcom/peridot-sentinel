import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
const names=['SentinelAccountV2','SentinelAccountFactoryV2','PeridotLendingAdapter','SinglePoolSwapAdapter','ExecutionPolicy','TestnetInventoryVenue']
const dir=new URL('../../../packages/chain-config/expansion/abi/',import.meta.url)
mkdirSync(dir,{recursive:true})
for (const name of names) {
  const file=new URL('../out/'+name+'.sol/'+name+'.json',import.meta.url)
  const abi=JSON.parse(readFileSync(file)).abi
  writeFileSync(new URL(name+'.json',dir),JSON.stringify(abi,null,2)+'\n')
}
