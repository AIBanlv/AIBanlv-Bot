import { t, language } from './device-i18n.mjs'
const $ = id => document.getElementById(id), bridge = window.controlDevice
let scope = '', generation = 0, epoch = 0, page = 1, total = 0, requestId = '', lastRows = [], active = false, available = false, loading = false, saving = false, loadJob
const errors = { BIND_REQUIRED:'请先扫码绑定账号', OFFLINE:'服务暂不可用，请稍后重试',
  SERVER_UPDATE_REQUIRED:'请更新控制服务后重试', PAIRING_PROOF_REQUIRED:'请重新扫码以验证设备授权',
  TIMEOUT:'请求结果未确认，请刷新任务列表核对后再试', INVALID_ACTION:'请检查任务内容、时间和时区',
  REMINDERS_DISABLED:'服务端提醒调度未启用，请联系管理员', FORBIDDEN:'当前账号无权访问该提醒' }
const errorText = result => t(errors[result?.code] || '服务暂不可用，请稍后重试')
const run = async (operation, payload = {}, id) => {
  try { return await bridge.desktopAction(operation, payload, id) }
  catch { return { ok:false, code:'OFFLINE' } }
}
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
$('memo-timezone').textContent = t(`时区：${timezone}`)
const initial = new Date(Date.now()+5*60000), pad = n => String(n).padStart(2,'0')
$('memo-date').value = `${initial.getFullYear()}-${pad(initial.getMonth()+1)}-${pad(initial.getDate())}`
$('memo-time').value = `${pad(initial.getHours())}:${pad(initial.getMinutes())}`
function controls() {
  for (const id of ['memo-save','memo-refresh','memo-new']) $(id).disabled = !available || saving || loading
  $('memo-cancel').disabled = saving
  $('memo-prev').disabled = !available || saving || loading || page <= 1
  $('memo-next').disabled = !available || saving || loading || page * 20 >= total
}
function editor(open) {
  $('memo-form').hidden = !open
  $('memo-new').setAttribute('aria-expanded', String(open))
  if (open) $('memo-content').focus()
}
function renderRows() {
  $('memo-list').replaceChildren(...lastRows.map(row => {
    const article = document.createElement('article'); article.className='workbuddy-item'
    const title=document.createElement('p'); title.textContent=row.content
    const detail=document.createElement('p'); detail.className='secondary'
    let trigger=''
    try { if(row.nextTriggerAt) trigger=new Intl.DateTimeFormat(language,{ timeZone:row.timezone || timezone,dateStyle:'medium',timeStyle:'short' }).format(new Date(row.nextTriggerAt)) } catch {}
    detail.textContent=[row.agentName || row.agentId, t(row.intervalType==='daily'?'每天':'仅一次'), trigger || [row.date,row.time].filter(Boolean).join(' '), row.timezone].filter(Boolean).join(' · ')
    const remove=document.createElement('button'); remove.type='button';remove.className='plain-button';remove.textContent=t('删除任务')
    remove.disabled = !available || saving
    remove.onclick=async()=>{
      if (!available || saving) return
      const token=epoch; saving=true; controls(); renderRows()
      const result=await run('memo_delete',{ id:row.id,requestId:crypto.randomUUID() })
      if(token!==epoch)return
      saving=false; controls()
      if(result.ok){if(lastRows.length===1&&page>1)page--;await load();$('memo-status').textContent=t('任务已删除')}
      else{$('memo-status').textContent=errorText(result);renderRows()}
    }
    article.append(title,detail,remove);return article
  }))
  if(!lastRows.length&&!loading){const empty=document.createElement('p');empty.textContent=t('暂无定时任务');$('memo-list').append(empty)}
  controls()
}
async function load() {
  if(!available){$('memo-status').textContent=t(scope?'服务暂不可用，请稍后重试':'请先扫码绑定账号');return}
  if(loadJob?.scope===scope&&loadJob.page===page)return loadJob.promise
  const token=++generation,key=scope,requestedPage=page
  loading=true;controls();$('memo-status').textContent=t('正在加载任务…')
  const job=loadJob={scope:key,page:requestedPage}
  job.promise=(async()=>{
    const result=await run('memo_list',{page:requestedPage})
    if(token!==generation||key!==scope)return
    loading=false;loadJob=null;controls()
    if(!result.ok){$('memo-status').textContent=errorText(result);return}
    if(!Array.isArray(result.data?.records)||result.data.records.length>20||!Number.isSafeInteger(Number(result.data.total))||Number(result.data.total)<0){$('memo-status').textContent=errorText({});return}
    lastRows=result.data.records;total=Number(result.data.total);renderRows();$('memo-status').textContent=''
  })()
  return job.promise
}
$('memo-new').onclick=()=>{if(available&&!saving)editor($('memo-form').hidden)}
$('memo-cancel').onclick=()=>{if(!saving)editor(false)}
$('memo-refresh').onclick=()=>load()
$('memo-prev').onclick=()=>{if(page>1){page--;void load()}}
$('memo-next').onclick=()=>{if(page*20<total){page++;void load()}}
$('memo-repeat').onchange=()=>{$('memo-date').disabled=$('memo-repeat').value==='daily';requestId=''}
for(const id of ['memo-role','memo-content','memo-date','memo-time'])$(id).addEventListener('input',()=>{requestId=''})
$('memo-form').onsubmit=async event=>{
  event.preventDefault();if(!available||saving)return
  const token=epoch
  requestId ||= crypto.randomUUID()
  const payload={requestId,agentId:$('memo-role').value,content:$('memo-content').value.trim(),date:$('memo-date').value,
    time:$('memo-time').value,repeat:$('memo-repeat').value,timezone,language}
  if(!payload.agentId||!payload.content||payload.repeat==='none'&&new Date(`${payload.date}T${payload.time}`).getTime()<=Date.now()){
    $('memo-status').textContent=t('请检查任务内容、时间和时区');return
  }
  saving=true;controls()
  const result=await run('memo_create',payload,requestId)
  if(token!==epoch)return
  saving=false;controls()
  if(result.ok){requestId='';$('memo-content').value='';editor(false);page=1;await load();$('memo-status').textContent=t(result.data?.notificationsEnabled===false?'提醒已保存，但账号通知已关闭；开启通知后才会播报':'任务已添加')}
  else $('memo-status').textContent=errorText(result)
}
$('device-unbind').onclick=async()=>{
  $('device-unbind').disabled=true
  const result=await run('unbind')
  $('device-unbind').disabled=false
  if(!result.ok)$('binding-action-status').textContent=errorText(result)
}
function update(state) {
  if(!state)return
  const notice=state.notificationSync||{}
  $('notification-status').textContent=t(({ready:'通知通道已连接，漏收恢复已启用',unsupported:'当前后端不支持通知漏收恢复，请更新后端并检查电脑通知下发',
    unauthorized:'请重新扫码验证设备授权；验证前只接收实时推送',disabled:'账号通知已关闭，请先在手机开启通知',offline:'通知通道离线，重新连接后恢复',
    unbound:'绑定账号后可接收并播报通知',error:'通知恢复查询失败，将自动重试；实时推送仍可接收'})[notice.state]||'')
  const key=state.binding==='bound'?state.accountScope:'',before=available,changed=scope!==key
  available=Boolean(key&&state.connection==='connected'&&(!state.proofRequired||state.accountAuthReady))
  if(changed||before&&!available){epoch++;generation++;loadJob=null;loading=false;saving=false}
  if(changed){scope=key;page=1;total=0;lastRows=[];requestId='';$('memo-content').value='';editor(false);$('memo-status').textContent='';$('binding-action-status').textContent='';renderRows()}
  if(!scope)$('memo-status').textContent=t('请先扫码绑定账号')
  $('device-unbind').disabled=!available
  controls()
  const selected=$('memo-role').value
  $('memo-role').replaceChildren(...(state.roles||[]).filter(role=>role.source!=='local'&&role.available!==false).map(role=>new Option(role.agentName||role.agentId,role.agentId)))
  $('memo-role').value=[selected,state.current?.agentId].find(id=>[...$('memo-role').options].some(option=>option.value===id))||$('memo-role').options[0]?.value||''
  if(active&&available&&(changed||!before))void load()
}
window.addEventListener('settings-page',event=>{
  const wasActive=active;active=event.detail==='scheduled-tasks'
  if(active&&!wasActive){editor(false);page=1;void load()}
})
bridge.onState(update);void bridge.state().then(update)
window.addEventListener('desktop-language',()=>{renderRows();$('memo-timezone').textContent=t(`时区：${timezone}`)})
