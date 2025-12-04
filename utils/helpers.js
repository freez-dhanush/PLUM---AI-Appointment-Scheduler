import pkg from 'date-fns-tz'
const { utcToZonedTime } = pkg
import { formatISO } from 'date-fns'
export function utcToZonedISODate(date, tz) {
  return formatISO(utcToZonedTime(date, tz)).slice(0, 10)
}
