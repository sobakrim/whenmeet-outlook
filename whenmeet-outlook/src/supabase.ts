import { createClient } from '@supabase/supabase-js'
import type { MeetingPayload } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && key)
export const supabase = isSupabaseConfigured ? createClient(url!, key!) : null

export async function createMeeting(input: {
  title: string
  timezone: string
  startDate: string
  endDate: string
  dayStart: string
  dayEnd: string
  slotMinutes: number
}) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.rpc('create_meeting', {
    p_title: input.title,
    p_timezone: input.timezone,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_day_start: input.dayStart,
    p_day_end: input.dayEnd,
    p_slot_minutes: input.slotMinutes,
  })
  if (error) throw error
  return data as { share_code: string; admin_code: string }
}

export async function getMeeting(shareCode: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.rpc('get_meeting', { p_share_code: shareCode })
  if (error) throw error
  if (!data) throw new Error('Meeting not found.')
  return data as MeetingPayload
}

export async function saveParticipant(input: {
  shareCode: string
  editCode: string
  name: string
  slots: string[]
}) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.rpc('save_participant', {
    p_share_code: input.shareCode,
    p_edit_code: input.editCode,
    p_name: input.name,
    p_slots: input.slots,
  })
  if (error) throw error
  return data as string
}

export async function deleteMeeting(shareCode: string, adminCode: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.rpc('delete_meeting', {
    p_share_code: shareCode,
    p_admin_code: adminCode,
  })
  if (error) throw error
  return Boolean(data)
}
