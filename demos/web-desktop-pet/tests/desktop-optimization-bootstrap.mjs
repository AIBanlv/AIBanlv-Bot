import { dialog } from 'electron'
import { createRequire } from 'node:module'
globalThis.fixtureRequire=createRequire(import.meta.url)
dialog.showErrorBox=(title,message)=>console.error('[fixture]',title,message)
const original=globalThis.fetch
globalThis.fetch=async(url,options)=>{
  const value=new URL(String(url))
  if(value.hostname==='127.0.0.1')return original(url,options)
  if(value.pathname.endsWith('/getBotListTWithPublic'))return Response.json({code:200,data:[{id:'fixture-role',name:'Fixture role',tenantId:'1',isDefault:1,digitalHumanId:'fixture-model',voiceId:'longanqian'}]})
  if(value.pathname.endsWith('/getReception'))return Response.json({code:200,data:{score:800}})
  if(value.pathname.endsWith('/anonymous/status'))return Response.json({code:200,data:{score:0}})
  throw new Error('Non-fixture request blocked')
}
await import('../electron/device-main.mjs')
