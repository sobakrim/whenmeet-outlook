export type Meeting = {
  title: string
  timezone: string
  start_date: string
  end_date: string
  day_start: string
  day_end: string
  slot_minutes: number
}

export type Participant = {
  name: string
  slots: string[]
}

export type MeetingPayload = {
  meeting: Meeting
  participants: Participant[]
}

export type Slot = {
  iso: string
  dateKey: string
  dateLabel: string
  weekdayLabel: string
  timeLabel: string
}
