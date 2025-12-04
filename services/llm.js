import axios from 'axios'

function localRegexExtract(text) {
  const s = (text || '').toLowerCase()
  const deptMatch = s.match(/\b(dentist|dental|cardio|cardiologist|doctor|derma|dermatology|eye|ophthalmologist|optometrist|physio|physiotherapy|orthopedic|orthopedics|skin|general practitioner|gp|pediatrician|pediatrics)\b/)
  const timeMatch = s.match(/(\b\d{1,2}(?::\d{2})?\s*(am|pm)\b)|(\b\d{1,2}:\d{2}\b)|(\b\d{1,2}\s*pm\b)|(\b\d{1,2}\s*am\b)/i)
  const datePhraseMatch = s.match(/\b(next\s+\w+|this\s+\w+|tomorrow|today|tonight|in\s+\d+\s+days|on\s+\w+\s+\d{1,2}(st|nd|rd|th)?|[0-9]{4}-[0-9]{2}-[0-9]{2})\b/)
  const numericDate = s.match(/(\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b)/)

  const dept = deptMatch ? deptMatch[0] : null
  const time = timeMatch ? timeMatch[0] : null
  const date_phrase = datePhraseMatch ? datePhraseMatch[0] : (numericDate ? numericDate[0] : null)

  const confidence = 0.6
  return {
    status: 'ok',
    entities: { date_phrase, time_phrase: time, department: dept },
    entities_confidence: confidence,
    normalized: {}
  }
}

async function callOpenAI(text, todayISO, timezone) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { ok: false, reason: 'no_openai_key' }
  try {
    const system = `You are an appointment extraction assistant. Today's date is ${todayISO}. Your timezone is ${timezone}. Return EXACTLY JSON (no extra text). Keys: entities (date_phrase, time_phrase, department), entities_confidence (0 to 1). If ambiguous or missing, set status to needs_clarification and include a message.`
    const user = `Extract appointment entities from the following text. Return ONLY JSON (no commentary).\n\nText:\n${text}`

    const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0,
      max_tokens: 400
    }, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 20000
    })

    const content = resp.data?.choices?.[0]?.message?.content || resp.data?.choices?.[0]?.text || ''
    const cleaned = content.replace(/(^```json|^```|```$)/g, '').trim()
    try {
      const parsed = JSON.parse(cleaned)
      return { ok: true, parsed }
    } catch (err) {
      return { ok: false, reason: 'openai_non_json', raw: content }
    }
  } catch (err) {
    if (err.response && err.response.status === 429) {
      return { ok: false, reason: 'openai_429', details: err.response.data }
    }
    if (err.response && err.response.data) {
      return { ok: false, reason: 'openai_error', details: err.response.data }
    }
    return { ok: false, reason: 'openai_request_failed', details: err.message }
  }
}

export async function extractEntities(text, todayISO, timezone) {
  const tryOpenAI = await callOpenAI(text, todayISO, timezone)
  if (tryOpenAI.ok && tryOpenAI.parsed) {
    const p = tryOpenAI.parsed
    if (p.status === 'needs_clarification') return p
    return p
  }

   
  const fallback = localRegexExtract(text)
   
  fallback._source = 'local_regex_fallback'
  fallback._openai_attempt = tryOpenAI
  return fallback
}
