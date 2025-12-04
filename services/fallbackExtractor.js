import { cleanOCRText, levenshtein, similarity } from '../utils/textHelpers.js'

  
const DEPARTMENTS = [
  'dentist','dental','cardiology','cardiologist','doctor','dermatology','dermatologist',
  'ophthalmology','optometrist','physio','physiotherapy','orthopedics','pediatrician',
  'general practitioner','gp','ent','psychiatry','neurology','oncology'
]

const COMMON_OCR_FIXES = [
  ['\\bdenfist\\b','dentist'],
  ['\\bdenhst\\b','dentist'],
  ['\\bdenist\\b','dentist'],
  ['\\bnxt\\b','next'],
  ['\\bnent\\b','next'],
  ['\\bnxtt\\b','next'],
  ['\\bnx\\b','next'],
  ['\\b@\\b',' at ']
]

function applyOcrFixes(s) {
  let t = s
  for (const [pat, rep] of COMMON_OCR_FIXES) {
    t = t.replace(new RegExp(pat,'gi'), rep)
  }
  return t
}

function bestDeptCandidate(word) {
  let best = { score: 0, dept: null }
  for (const d of DEPARTMENTS) {
    const sim = similarity(word, d)
    if (sim > best.score) best = { score: sim, dept: d }
  }
  return best
}

export function fallbackExtract(raw) {
  const cleanedRaw = applyOcrFixes((raw||'').toLowerCase())
  const s = cleanOCRText(cleanedRaw)
  const tokens = s.split(/\s+/).filter(Boolean)

  let date_phrase = null
  let time_phrase = null
  let department = null

    
  const weekdayMatch = s.match(/\b(next|this|tomorrow|today)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
  if (weekdayMatch) {
    const prefix = (weekdayMatch[1] || '').trim()
    const day = weekdayMatch[2]
    date_phrase = (prefix ? prefix + ' ' + day : 'next ' + day)
  } else {
      
    const dateMatch = s.match(/\b(next\s+\w+|this\s+\w+|tomorrow|today|in\s+\d+\s+days|\d{4}-\d{2}-\d{2})\b/)
    if (dateMatch) date_phrase = dateMatch[0]
  }

    
  const timeMatch = s.match(/(\b\d{1,2}(?::\d{2})?\s*(am|pm)\b)|(\b\d{1,2}:\d{2}\b)|(\b\d{1,2}\s*pm\b)|(\b\d{1,2}\s*am\b)/i)
  if (timeMatch) {
    time_phrase = timeMatch[0].replace(/\s+/g,'')
  } else {
      
    const altMatch = s.match(/\b(\d{1,2})\b/)
    if (altMatch) time_phrase = altMatch[1]   
  }

    
  for (const d of DEPARTMENTS) {
    if (s.includes(d)) { department = d; break }
  }
  if (!department) {
      
    const candidates = tokens.concat(tokens.map((t,i)=> (tokens[i+1]? `${t} ${tokens[i+1]}` : null)).filter(Boolean))
    let best = { score: 0, dept: null }
    for (const c of candidates) {
      const { score, dept } = bestDeptCandidate(c)
      if (score > best.score) best = { score, dept }
    }
      
    if (best.score >= 0.35) department = best.dept
  }

  if (department === 'gp') department = 'general practitioner'

  const entities_confidence = department ? 0.7 : 0.45
  return {
    status: department && (date_phrase || time_phrase) ? 'ok' : 'needs_clarification',
    entities: { date_phrase, time_phrase, department },
    entities_confidence,
    normalized: {}
  }
}
