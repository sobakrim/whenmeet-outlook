import { DateTime } from 'luxon'
import type { Meeting, Slot } from './types'

export function generateSlots(meeting: Meeting): Slot[] {
  const result: Slot[] = []
  let date = DateTime.fromISO(meeting.start_date, { zone: meeting.timezone }).startOf('day')
  const endDate = DateTime.fromISO(meeting.end_date, { zone: meeting.timezone }).endOf('day')

  while (date <= endDate) {
    const start = DateTime.fromISO(`${date.toISODate()}T${meeting.day_start}`, { zone: meeting.timezone })
    const end = DateTime.fromISO(`${date.toISODate()}T${meeting.day_end}`, { zone: meeting.timezone })
    for (let cursor = start; cursor < end; cursor = cursor.plus({ minutes: meeting.slot_minutes })) {
      result.push({
        iso: cursor.toUTC().toISO()!,
        dateKey: cursor.toISODate()!,
        dateLabel: cursor.toFormat('dd LLL'),
        weekdayLabel: cursor.toFormat('ccc'),
        timeLabel: cursor.toFormat('HH:mm'),
      })
    }
    date = date.plus({ days: 1 })
  }
  return result
}
