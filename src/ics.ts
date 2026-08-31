import ICAL from 'ical.js'
import { DateTime } from 'luxon'
import { generateSlots } from './calendar'
import type { Meeting } from './types'

type BusyInterval = { start: DateTime; end: DateTime }

export type IcsImportResult = {
  slots: string[]
  calendarEvents: number
  busyOccurrences: number
  fileName: string
}

// Outlook sometimes exports Windows timezone identifiers instead of IANA names.
// These cover common cases; an embedded VTIMEZONE definition takes precedence.
const WINDOWS_TO_IANA: Record<string, string> = {
  UTC: 'UTC',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'GMT Standard Time': 'Europe/London',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
}

function isValidZone(zone: string) {
  return DateTime.now().setZone(zone).isValid
}

function normalizeZone(tzid: string | null | undefined, fallback: string) {
  if (!tzid) return fallback
  const mapped = WINDOWS_TO_IANA[tzid] ?? tzid
  return isValidZone(mapped) ? mapped : fallback
}

function registerEmbeddedTimezones(calendar: ICAL.Component) {
  for (const component of calendar.getAllSubcomponents('vtimezone')) {
    const value = component.getFirstPropertyValue('tzid')
    if (!value) continue
    const tzid = String(value)
    try {
      ICAL.TimezoneService.register(tzid, new ICAL.Timezone({ component, tzid }))
    } catch {
      // A duplicate timezone registration is harmless for this one-file import.
    }
  }
}

function componentTimezone(component: ICAL.Component, propertyName: string, fallback: string) {
  let property = component.getFirstProperty(propertyName)
  if (!property && propertyName === 'dtend') property = component.getFirstProperty('dtstart')
  const parameter = property?.getParameter('tzid')
  return normalizeZone(parameter == null ? undefined : String(parameter), fallback)
}

function timeToDateTime(time: ICAL.Time, component: ICAL.Component, propertyName: string, fallbackZone: string) {
  // Date-only values (typical for all-day events) are interpreted in the poll timezone.
  if (time.isDate) {
    return DateTime.fromObject(
      { year: time.year, month: time.month, day: time.day },
      { zone: componentTimezone(component, propertyName, fallbackZone) },
    )
  }

  const zoneId = time.zone?.tzid
  if (zoneId && zoneId !== 'floating') {
    // When ICAL.js knows the zone (UTC or an embedded VTIMEZONE), toJSDate gives
    // the correct absolute instant.
    return DateTime.fromJSDate(time.toJSDate(), { zone: 'utc' })
  }

  // For floating/unknown zones, preserve the wall-clock fields and apply the
  // DTSTART/DTEND TZID when it is an IANA (or mapped Outlook Windows) zone.
  const zone = componentTimezone(component, propertyName, fallbackZone)
  return DateTime.fromObject(
    {
      year: time.year,
      month: time.month,
      day: time.day,
      hour: time.hour,
      minute: time.minute,
      second: time.second,
    },
    { zone },
  ).toUTC()
}

function textProperty(component: ICAL.Component, name: string) {
  const value = component.getFirstPropertyValue(name)
  return value == null ? '' : String(value).toUpperCase()
}

function componentBlocksTime(component: ICAL.Component) {
  if (textProperty(component, 'status') === 'CANCELLED') return false
  if (textProperty(component, 'transp') === 'TRANSPARENT') return false

  // Outlook-specific busy status. If absent, RFC 5545 events are opaque/busy by default.
  const outlookBusy = textProperty(component, 'x-microsoft-cdo-busystatus')
  if (outlookBusy === 'FREE') return false
  return true
}

function overlapsRange(start: DateTime, end: DateTime, rangeStart: DateTime, rangeEnd: DateTime) {
  return start.isValid && end.isValid && end > rangeStart && start < rangeEnd
}

function addOccurrence(
  intervals: BusyInterval[],
  startTime: ICAL.Time,
  endTime: ICAL.Time,
  component: ICAL.Component,
  meeting: Meeting,
  rangeStart: DateTime,
  rangeEnd: DateTime,
) {
  if (!componentBlocksTime(component)) return false
  const start = timeToDateTime(startTime, component, 'dtstart', meeting.timezone).toUTC()
  const end = timeToDateTime(endTime, component, 'dtend', meeting.timezone).toUTC()
  if (!overlapsRange(start, end, rangeStart, rangeEnd)) return false
  intervals.push({ start, end })
  return true
}

function busyIntervalsFromIcs(icsText: string, meeting: Meeting) {
  const parsed = ICAL.parse(icsText)
  const calendar = new ICAL.Component(parsed)
  if (calendar.name !== 'vcalendar') throw new Error('This file is not a valid iCalendar (.ics) calendar.')

  registerEmbeddedTimezones(calendar)

  const components = calendar.getAllSubcomponents('vevent')
  const masters = components.filter((component) => !component.hasProperty('recurrence-id'))
  const masterUids = new Set(masters.map((component) => String(component.getFirstPropertyValue('uid') ?? '')))

  const rangeStart = DateTime.fromISO(`${meeting.start_date}T00:00:00`, { zone: meeting.timezone }).toUTC()
  const rangeEnd = DateTime.fromISO(`${meeting.end_date}T23:59:59.999`, { zone: meeting.timezone }).plus({ milliseconds: 1 }).toUTC()
  const intervals: BusyInterval[] = []
  let busyOccurrences = 0

  for (const masterComponent of masters) {
    const uid = String(masterComponent.getFirstPropertyValue('uid') ?? '')
    const exceptions = components.filter(
      (component) => component.hasProperty('recurrence-id') && String(component.getFirstPropertyValue('uid') ?? '') === uid,
    )
    const event = new ICAL.Event(masterComponent, { strictExceptions: true, exceptions })

    if (!event.isRecurring()) {
      if (addOccurrence(intervals, event.startDate, event.endDate, masterComponent, meeting, rangeStart, rangeEnd)) busyOccurrences += 1
      continue
    }

    const iterator = event.iterator()
    let iterations = 0
    for (let next = iterator.next(); next; next = iterator.next()) {
      iterations += 1
      if (iterations > 200000) throw new Error('The calendar contains a recurrence that is too large to expand safely.')

      const occurrence = event.getOccurrenceDetails(next)
      const occurrenceComponent = occurrence.item.component
      const start = timeToDateTime(occurrence.startDate, occurrenceComponent, 'dtstart', meeting.timezone).toUTC()

      // Recurrence expansion starts at the first event occurrence. Once occurrence
      // starts are beyond the poll range, subsequent occurrences can be ignored.
      if (start >= rangeEnd) break

      if (addOccurrence(
        intervals,
        occurrence.startDate,
        occurrence.endDate,
        occurrenceComponent,
        meeting,
        rangeStart,
        rangeEnd,
      )) busyOccurrences += 1
    }
  }

  // Extremely unusual ICS files can contain only a detached recurrence exception.
  // Treat such an exception as a standalone event rather than silently ignoring it.
  for (const component of components) {
    if (!component.hasProperty('recurrence-id')) continue
    const uid = String(component.getFirstPropertyValue('uid') ?? '')
    if (masterUids.has(uid)) continue
    const event = new ICAL.Event(component)
    if (addOccurrence(intervals, event.startDate, event.endDate, component, meeting, rangeStart, rangeEnd)) busyOccurrences += 1
  }

  return { intervals, calendarEvents: components.length, busyOccurrences }
}

export async function importIcsAvailability(meeting: Meeting, file: File): Promise<IcsImportResult> {
  if (!file.name.toLowerCase().endsWith('.ics') && file.type && file.type !== 'text/calendar') {
    throw new Error('Please select an .ics calendar file.')
  }
  if (file.size > 25 * 1024 * 1024) throw new Error('The calendar file is too large (maximum 25 MB).')

  const text = await file.text()
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('This does not look like an iCalendar (.ics) file.')

  const { intervals, calendarEvents, busyOccurrences } = busyIntervalsFromIcs(text, meeting)
  const slots = generateSlots(meeting)
    .filter((slot) => {
      const slotStart = DateTime.fromISO(slot.iso, { zone: 'utc' })
      const slotEnd = slotStart.plus({ minutes: meeting.slot_minutes })
      return !intervals.some((busy) => slotStart < busy.end && slotEnd > busy.start)
    })
    .map((slot) => slot.iso)

  return { slots, calendarEvents, busyOccurrences, fileName: file.name }
}
