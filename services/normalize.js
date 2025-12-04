import { formatISO, addDays } from 'date-fns'
import pkg from 'date-fns-tz'
const { utcToZonedTime } = pkg

const WEEKDAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }

export function parseTimePhraseTo24(timePhrase) {
  if (!timePhrase) return null
  const s = timePhrase.toLowerCase().trim()
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!m) return null
  let hh = parseInt(m[1], 10)
  const mm = m[2] ? parseInt(m[2], 10) : 0
  const ampm = m[3]
  if (ampm) {
    if (ampm.toLowerCase() === 'pm' && hh < 12) hh += 12
    if (ampm.toLowerCase() === 'am' && hh === 12) hh = 0
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function computeDateFromPhrase(baseDate, phrase, tz) {
  if (!phrase) return null
  const p = phrase.toLowerCase().trim()
  const now = baseDate

  const isoMatch = p.match(/(\d{4}-\d{2}-\d{2})/)
  if (isoMatch) return isoMatch[1]

  if (p === 'today') return formatISO(utcToZonedTime(now, tz)).slice(0, 10)
  if (p === 'tomorrow') return formatISO(utcToZonedTime(addDays(now, 1), tz)).slice(0, 10)

  const inDays = p.match(/in\s+(\d+)\s+days?/)
  if (inDays) return formatISO(utcToZonedTime(addDays(now, parseInt(inDays[1], 10)), tz)).slice(0, 10)

  const wd = p.match(/(?:next|this)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/)
  if (wd) {
    const target = WEEKDAY_MAP[wd[1]]
    const cur = utcToZonedTime(now, tz).getDay()
    let daysAhead = (target - cur + 7) % 7
    if (p.startsWith('next')) {
      if (daysAhead === 0) daysAhead = 7
      else if (daysAhead <= 0) daysAhead += 7
    }
    if (!p.includes('this') && !p.includes('next') && daysAhead === 0) daysAhead = 7
    const d = addDays(now, daysAhead)
    return formatISO(utcToZonedTime(d, tz)).slice(0, 10)
  }
  return null
}

export function isValidISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}
