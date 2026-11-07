import { InviteHistory, installationPrompt } from './device-invite.mjs'
import { t, language } from './device-i18n.mjs'
const $=id=>document.getElementById(id),bridge=window.controlDevice
let active=false,shareScope='',shareAvailable=false,shareGeneration=0,shareBusy=false,installBusy=false,shareData=null,shareMessage='',shareFailed=false
const errors={BIND_REQUIRED:'请先扫码绑定账号',OFFLINE:'服务暂不可用，请稍后重试',
 SERVER_UPDATE_REQUIRED:'邀请记录暂时无法查看，请稍后再试',INVALID_ACTION:'邀请记录暂时无法查看，请稍后再试',
 PAIRING_PROOF_REQUIRED:'请重新扫码以验证设备授权',TIMEOUT:'请求超时，请稍后重试'}
const history=new InviteHistory({request:(...args)=>bridge.desktopAction(...args),changed:render})
function render(){
 $('invite-record-status').textContent=history.error?t(errors[history.error]||'邀请记录加载失败，请重试'):history.loading?t('正在加载邀请记录…'):''
 $('invite-record-refresh').disabled=!history.available||history.loading
 $('invite-record-prev').disabled=!history.available||history.loading||history.page<=1
 $('invite-record-next').disabled=!history.available||history.loading||history.page*20>=history.total
 $('invite-record-page').textContent=`${history.page} / ${Math.max(1,Math.ceil(history.total/20))}`
 $('invite-record-list').replaceChildren(...history.rows.map(row=>{
  const article=document.createElement('article');article.className='invite-record'
  const name=document.createElement('span');name.textContent=row.maskedName
  const date=document.createElement('time'),value=new Date(row.successAt.replace(' ','T'))
  date.textContent=Number.isFinite(value.getTime())?value.toLocaleString(language):'—'
  if(Number.isFinite(value.getTime()))date.dateTime=value.toISOString()
  article.append(name,date);return article
 }))
 if(!history.rows.length&&!history.loading&&!history.error){const empty=document.createElement('p');empty.className='secondary';empty.textContent=t('暂无成功邀请记录');$('invite-record-list').append(empty)}
}
function update(state){
 if(!state)return
 const scope=state.binding==='bound'?state.accountScope||'':'',old=history.scope,before=history.available
 history.context(scope,state.connection==='connected'&&(!state.proofRequired||state.accountAuthReady))
  const available=Boolean(scope&&state.connection==='connected'&&(!state.proofRequired||state.accountAuthReady))
  if(scope!==shareScope||shareAvailable&&!available){
    shareGeneration++;shareBusy=false;installBusy=false;shareData=null;shareMessage='';shareFailed=false
    if($('invite-share-dialog').open)$('invite-share-dialog').close()
  }
  shareScope=scope;shareAvailable=available;renderShare()
 if(active&&history.available&&(old!==scope||!before))void history.load(1)
}
function renderShare(){
  $('invite-share-url').value=shareData?.url||'';$('invite-share-app-url').value=shareData?.appUrl||''
  $('invite-share-installation').value=installationPrompt
  for(const id of ['invite-share-copy-url','invite-share-copy-app-url'])$(id).disabled=!shareAvailable||shareBusy||installBusy||!shareData
  $('invite-share-copy-installation').disabled=shareBusy||installBusy
  $('invite-share-status').textContent=t(shareMessage)
  $('invite-share-retry').hidden=!shareFailed||!shareAvailable;$('invite-share-retry').disabled=shareBusy||installBusy
}
async function shareRequest(copy){
  if(shareBusy||installBusy||!$('invite-share-dialog').open)return
  if(!shareAvailable){shareMessage=shareScope?'服务暂不可用，请稍后重试':'请先扫码绑定账号';renderShare();return}
  const token=++shareGeneration;shareBusy=true;shareFailed=false;shareMessage='正在加载邀请…';renderShare()
  let result;try{result=await bridge.desktopAction('invite',copy?{copy}:{})}catch{result={ok:false}}
  if(token!==shareGeneration||!$('invite-share-dialog').open)return
  shareBusy=false
  if(result?.ok&&typeof result.data?.url==='string'&&typeof result.data?.appUrl==='string'){
    shareData=result.data;shareMessage=copy==='app'?'手机 App 邀请链接已复制':copy?'电脑客户端邀请链接已复制':''
  }else{shareFailed=true;shareData=null;shareMessage='邀请暂时无法获取，请稍后重试'}
  renderShare()
}
$('invite-copy').onclick=()=>{
  shareData=null;shareMessage='';shareFailed=false;renderShare();$('invite-share-dialog').showModal();void shareRequest()
}
$('invite-share-close').onclick=()=>$('invite-share-dialog').close()
$('invite-share-dialog').addEventListener('close',()=>{shareGeneration++;shareBusy=false;installBusy=false;shareData=null;shareMessage='';shareFailed=false;renderShare()})
$('invite-share-dialog').addEventListener('click',event=>{const box=$('invite-share-dialog').getBoundingClientRect();if(event.target===$('invite-share-dialog')&&(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom))$('invite-share-dialog').close()})
$('invite-share-copy-url').onclick=()=>shareRequest('url')
$('invite-share-copy-app-url').onclick=()=>shareRequest('app')
$('invite-share-copy-installation').onclick=async()=>{
  if(shareBusy||installBusy||!$('invite-share-dialog').open)return
  const token=shareGeneration;installBusy=true;renderShare()
  let result;try{result=await bridge.copyInstallationPrompt()}catch{result={ok:false}}
  if(token!==shareGeneration||!$('invite-share-dialog').open)return
  installBusy=false;shareMessage=result?.ok?'安装提示词已复制':'复制失败，请重试';renderShare()
}
$('invite-share-retry').onclick=()=>shareRequest()
$('invite-record-refresh').onclick=()=>history.load()
$('invite-record-prev').onclick=()=>history.load(history.page-1)
$('invite-record-next').onclick=()=>history.load(history.page+1)
window.addEventListener('settings-page',event=>{const before=active;active=event.detail==='invite-section';if(active&&!before)void history.load(1)})
window.addEventListener('desktop-language',()=>{render();renderShare()})
bridge.onState(update);void bridge.state().then(update);render()
