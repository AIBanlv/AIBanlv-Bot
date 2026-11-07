export const installationPrompt = '帮我安装 AIBanlv 桌面伴侣：https://github.com/AIBanlv/AIBanlv-Bot'

const templates = {
  "zh-Hans": "邀请你体验很有意思的互动 AI 伴侣 AIBanlv：{url}\n首次注册填写邀请码 {code}，邀请双方各获得 1000 积分。",
  "zh-Hant": "邀請你體驗很有意思的互動 AI 伴侶 AIBanlv：{url}\n首次註冊填寫邀請碼 {code}，邀請雙方各獲得 1000 積分。",
  "en": "Try AIBanlv, a fun interactive AI companion: {url}\nEnter invite code {code} during first registration and we will each receive 1,000 credits.",
  "ja": "楽しい対話型AIコンパニオン AIBanlv を体験してみてください：{url}\n初回登録時に招待コード {code} を入力すると、双方に1,000クレジットずつ付与されます。"
}
export function invitation(code, language) {
 if (typeof code !== "string" || !code.trim() || code.length > 256) throw new Error("Invalid invite code")
 const url = new URL("https://aibanlv.ai/zh?view=desktop-companion")
 url.searchParams.set("inviteCode", code)
 const appUrl = new URL('https://aibanlv.ai/')
 appUrl.searchParams.set('inviteCode', code)
 return { url: url.href, appUrl: appUrl.href, text: (templates[language] || templates["zh-Hans"]).replaceAll("{url}", url.href).replaceAll("{code}", code) }
}

// Clipboard data is always reconstructed from the bound account's server code,
// never arbitrary renderer text. Opening the dialog does not write clipboard.
export function invitationResult(code, language, payload = {}, writeText = () => {}) {
 if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => key !== 'copy') ||
     payload.copy !== undefined && !['url','app','code','text'].includes(payload.copy)) throw new Error('Invalid invitation action')
 const value = invitation(code, language)
 if (payload.copy) writeText(payload.copy === 'code' ? code : payload.copy === 'url' ? value.url : payload.copy === 'app' ? value.appUrl : value.text)
 return { ok: true, data: { code, url: value.url, appUrl: value.appUrl } }
}

export function maskedInviteName(value) {
 const text = typeof value === 'string' ? value.trim() : ''
 if (!text) return '***'
 if (/^(?:\*{1,3}|[^*]\*{3}[^*]?)$/u.test(text)) return text
 const points = [...text]
 return points.length === 1 ? '*' : `${points[0]}***${points.length > 2 ? points.at(-1) : ''}`
}

// No polling: load only when the page opens, reconnects, or the user paginates.
export class InviteHistory {
 constructor({ request, changed = () => {} }) { Object.assign(this, { request, changed }); this.scope='';this.available=false;this.generation=0;this.page=1;this.total=0;this.rows=[];this.loading=false;this.error='' }
 context(scope, available) {
  if (scope !== this.scope || !available && this.available) { this.generation++;this.pending=null;this.loading=false }
  if (scope !== this.scope) { this.scope=scope;this.rows=[];this.total=0;this.page=1;this.error='' }
  this.available=Boolean(scope && available);this.changed()
 }
 load(page = this.page) {
  if (!this.available) { this.error=this.scope?'OFFLINE':'BIND_REQUIRED';this.changed();return Promise.resolve() }
  if (!Number.isSafeInteger(page)||page<1||page>100000)return Promise.resolve()
  if (this.pending?.page===page)return this.pending.promise
  const token=++this.generation,key=this.scope
  this.page=page;this.loading=true;this.error='';this.changed()
  const job=this.pending={page}
  job.promise=(async()=>{
   try {
    const result=await this.request('invite_list',{page})
    if(token!==this.generation||key!==this.scope)return
    if(!result?.ok)throw new Error(result?.code||'OFFLINE')
    const data=result.data
    if(!Array.isArray(data?.records)||data.records.length>20||!Number.isSafeInteger(data.total)||data.total<0)throw new Error('INVALID_RESPONSE')
    this.rows=data.records.map(row=>({maskedName:maskedInviteName(row?.maskedName),successAt:typeof row?.successAt==='string'?row.successAt.slice(0,64):''}))
    this.total=data.total
   }catch(error){if(token===this.generation)this.error=error.message}
   finally{if(token===this.generation){this.pending=null;this.loading=false;this.changed()}}
  })()
  return job.promise
 }
}
