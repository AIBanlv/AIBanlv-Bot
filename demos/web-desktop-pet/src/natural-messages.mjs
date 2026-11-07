export const NATURAL_CHAT_INSTRUCTIONS = `TEXT-CHAT FORMAT: naturally send 1–3 short complete messages; simple answers need one. Each message begins [perform:one restrained continuous emotional intention] and ends [msg_end], including the last. Match the user's language and character; never explain or speak tags. Never invent successful task/reminder results.`

export function naturalMessages(raw, final = false) {
  const parts = String(raw || '').slice(0, 24000).split(/\[msg_end\]/i)
  const marked = parts.length > 1
  if (marked && !final) parts.pop()
  return parts.flatMap(part => part.split(/(?=\[perform\s*[:：])/i))
    .map(part => {
      let depth=0,text=''
      for(const char of part) {
        if(char==='[')depth++
        else if(char===']')depth=Math.max(0,depth-1)
        else if(!depth)text+=char
      }
      return text.trim()
    })
    .filter(Boolean).slice(0, 3)
}
