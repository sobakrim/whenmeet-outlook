import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { generateSlots } from './calendar'
import { importIcsAvailability } from './ics'
import { createMeeting, deleteMeeting, getMeeting, isSupabaseConfigured, saveParticipant } from './supabase'
import type { MeetingPayload, Slot } from './types'
import './styles.css'

function randomCode(bytes = 18) {
  const values = new Uint8Array(bytes)
  crypto.getRandomValues(values)
  return Array.from(values, (b) => b.toString(16).padStart(2, '0')).join('')
}

function shareCodeFromUrl() {
  return new URLSearchParams(window.location.search).get('m') || ''
}

function adminCodeFromUrl() {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('admin') || ''
}


function meetingUrl(shareCode: string) {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('m', shareCode)
  return url.toString()
}

function organizerUrl(shareCode: string, adminCode: string) {
  const url = new URL(meetingUrl(shareCode))
  url.hash = new URLSearchParams({ admin: adminCode }).toString()
  return url.toString()
}

function groupSlotsByDate(slots: Slot[]) {
  const map = new Map<string, Slot[]>()
  for (const slot of slots) {
    const list = map.get(slot.dateKey) ?? []
    list.push(slot)
    map.set(slot.dateKey, list)
  }
  return Array.from(map.entries()).map(([dateKey, daySlots]) => ({ dateKey, slots: daySlots }))
}

function Home() {
  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dayStart, setDayStart] = useState('09:00')
  const [dayEnd, setDayEnd] = useState('18:00')
  const [slotMinutes, setSlotMinutes] = useState(30)
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Zurich')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!isSupabaseConfigured) {
      setError('Supabase is not configured. Add the VITE_SUPABASE_* variables first.')
      return
    }
    if (!title.trim() || !startDate || !endDate) {
      setError('Please fill in the title and date range.')
      return
    }
    if (endDate < startDate) {
      setError('The end date must be on or after the start date.')
      return
    }
    if (dayEnd <= dayStart) {
      setError('The daily end time must be after the start time.')
      return
    }
    setLoading(true)
    try {
      const created = await createMeeting({ title: title.trim(), timezone, startDate, endDate, dayStart, dayEnd, slotMinutes })
      window.location.href = organizerUrl(created.share_code, created.admin_code)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the meeting.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="page shell">
      <header className="hero">
        <div className="brand-pill">WhenMeet Calendar</div>
        <h1>Find a time. Import your calendar privately.</h1>
        <p>Create a shared availability grid. Participants can import an Outlook/iCalendar .ics file to fill free slots automatically, or select times manually.</p>
      </header>

      <section className="card create-card">
        <div className="card-heading">
          <div>
            <span className="eyebrow">New meeting</span>
            <h2>Create an availability poll</h2>
          </div>
          <span className="privacy-chip">.ics stays in the browser</span>
        </div>
        <form onSubmit={submit} className="create-form">
          <label className="field full">
            <span>Meeting title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title" />
          </label>
          <label className="field">
            <span>From</span>
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (!endDate) setEndDate(e.target.value) }} />
          </label>
          <label className="field">
            <span>To</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Day starts</span>
            <input type="time" value={dayStart} onChange={(e) => setDayStart(e.target.value)} />
          </label>
          <label className="field">
            <span>Day ends</span>
            <input type="time" value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} />
          </label>
          <label className="field">
            <span>Slot length</span>
            <select value={slotMinutes} onChange={(e) => setSlotMinutes(Number(e.target.value))}>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>60 minutes</option>
            </select>
          </label>
          <label className="field">
            <span>Timezone</span>
            <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </label>
          {error && <div className="notice error full">{error}</div>}
          <button className="primary full" disabled={loading}>{loading ? 'Creating…' : 'Create meeting'}</button>
        </form>
      </section>

      <section className="feature-grid">
        <article><strong>.ics import</strong><span>Works with Outlook and other calendars that export iCalendar files.</span></article>
        <article><strong>Manual fallback</strong><span>Click and drag even if you do not want to import a calendar.</span></article>
        <article><strong>Privacy-first</strong><span>The .ics file is parsed locally; event details are never uploaded.</span></article>
      </section>
    </main>
  )
}

function MeetingPage({ shareCode }: { shareCode: string }) {
  const [payload, setPayload] = useState<MeetingPayload | null>(null)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importedFile, setImportedFile] = useState('')
  const [dragValue, setDragValue] = useState<boolean | null>(null)
  const adminCode = adminCodeFromUrl()

  const editStorageKey = `whenmeet-edit:${shareCode}`
  const nameStorageKey = `whenmeet-name:${shareCode}`
  const slotsStorageKey = `whenmeet-slots:${shareCode}`

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const value = await getMeeting(shareCode)
      setPayload(value)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load meeting.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    const storedName = localStorage.getItem(nameStorageKey)
    const storedSlots = localStorage.getItem(slotsStorageKey)
    if (storedName) setName(storedName)
    if (storedSlots) {
      try { setSelected(new Set(JSON.parse(storedSlots) as string[])) } catch { /* ignore */ }
    }
  }, [shareCode])

  const slots = useMemo(() => payload ? generateSlots(payload.meeting) : [], [payload])
  const days = useMemo(() => groupSlotsByDate(slots), [slots])
  const timeLabels = days[0]?.slots.map((s) => s.timeLabel) ?? []

  const counts = useMemo(() => {
    const result = new Map<string, number>()
    for (const participant of payload?.participants ?? []) {
      for (const slot of participant.slots) {
        const key = new Date(slot).toISOString()
        result.set(key, (result.get(key) ?? 0) + 1)
      }
    }
    return result
  }, [payload])

  function setSlot(iso: string, value: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (value) next.add(iso); else next.delete(iso)
      return next
    })
  }

  function beginDrag(iso: string) {
    const value = !selected.has(iso)
    setDragValue(value)
    setSlot(iso, value)
  }

  async function importCalendarFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!payload || !file) return
    setError(''); setMessage(''); setImporting(true)
    try {
      const imported = await importIcsAvailability(payload.meeting, file)
      setSelected(new Set(imported.slots))
      setImportedFile(imported.fileName)
      setMessage(`Calendar imported locally: ${imported.calendarEvents} calendar entr${imported.calendarEvents === 1 ? 'y' : 'ies'} read and ${imported.busyOccurrences} busy occurrence${imported.busyOccurrences === 1 ? '' : 's'} found in the poll period. Review the highlighted free slots, then save.`)
    } catch (err) {
      setImportedFile('')
      setError(err instanceof Error ? err.message : 'Could not import the .ics calendar.')
    } finally {
      setImporting(false)
    }
  }

  async function save() {
    if (!name.trim()) { setError('Please enter your name.'); return }
    setSaving(true); setError(''); setMessage('')
    try {
      let editCode = localStorage.getItem(editStorageKey)
      if (!editCode) { editCode = randomCode(); localStorage.setItem(editStorageKey, editCode) }
      await saveParticipant({ shareCode, editCode, name: name.trim(), slots: Array.from(selected) })
      localStorage.setItem(nameStorageKey, name.trim())
      localStorage.setItem(slotsStorageKey, JSON.stringify(Array.from(selected)))
      setMessage('Availability saved.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save availability.')
    } finally {
      setSaving(false)
    }
  }

  async function copyShareLink() {
    await navigator.clipboard.writeText(meetingUrl(shareCode))
    setMessage('Participant link copied.')
  }

  async function removeMeeting() {
    if (!adminCode) return
    if (!window.confirm('Delete this meeting and all availability? This cannot be undone.')) return
    try {
      const deleted = await deleteMeeting(shareCode, adminCode)
      if (!deleted) throw new Error('The organizer code is invalid.')
      window.location.href = import.meta.env.BASE_URL
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete meeting.')
    }
  }

  if (loading && !payload) return <main className="page shell"><div className="card loading-card">Loading meeting…</div></main>
  if (!payload) return <main className="page shell"><div className="card"><h1>Meeting unavailable</h1><p>{error || 'This link is invalid or the meeting was deleted.'}</p><a className="button-link" href={import.meta.env.BASE_URL}>Create another meeting</a></div></main>

  const participantCount = payload.participants.length
  const maxCount = Math.max(1, participantCount)

  return (
    <main className="page shell wide">
      <header className="meeting-header">
        <div>
          <a className="brand-link" href={import.meta.env.BASE_URL}>WhenMeet Calendar</a>
          <h1>{payload.meeting.title}</h1>
          <p>{payload.meeting.start_date} → {payload.meeting.end_date} · {payload.meeting.day_start.slice(0,5)}–{payload.meeting.day_end.slice(0,5)} · {payload.meeting.timezone}</p>
        </div>
        <div className="header-actions">
          <button className="secondary" onClick={copyShareLink}>Copy participant link</button>
          {adminCode && <button className="secondary" onClick={async () => { await navigator.clipboard.writeText(window.location.href); setMessage('Organizer link copied. Keep it private.') }}>Copy organizer link</button>}
          {adminCode && <button className="danger" onClick={removeMeeting}>Delete meeting</button>}
        </div>
      </header>

      <section className="card availability-card">
        <div className="availability-top">
          <div>
            <span className="eyebrow">Your availability</span>
            <h2>Choose when you are free</h2>
          </div>
          <div className="mode-actions">
            <label className={`ics-import ${importing ? 'disabled' : ''}`}>
              <input className="file-input" type="file" accept=".ics,text/calendar" disabled={importing} onChange={importCalendarFile} />
              {importing ? 'Reading calendar…' : 'Import calendar (.ics)'}
            </label>
            <button className="secondary" onClick={() => setSelected(new Set(slots.map((s) => s.iso)))}>Select all</button>
            <button className="secondary" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>

        {adminCode && <div className="notice">Organizer mode: bookmark this URL or copy the organizer link. The admin key is stored only in the URL fragment; do not share that organizer link with participants.</div>}
        <div className="notice privacy-notice"><strong>Private import:</strong> your .ics file is read only inside this browser. Event titles, descriptions, attendees and the file itself are never sent to Supabase. Only the free slots you save are uploaded.</div>
        {importedFile && <div className="imported-file">Imported: <strong>{importedFile}</strong></div>}
        <div className="person-row">
          <label className="field name-field"><span>Your name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></label>
          <button className="primary save-button" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save availability'}</button>
        </div>
        {error && <div className="notice error">{error}</div>}
        {message && <div className="notice success">{message}</div>}

        <div className="grid-scroll" onMouseLeave={() => setDragValue(null)} onMouseUp={() => setDragValue(null)}>
          <div className="availability-grid" style={{ gridTemplateColumns: `72px repeat(${days.length}, minmax(76px, 1fr))` }}>
            <div className="corner-cell" />
            {days.map((day) => <div className="day-head" key={day.dateKey}><strong>{day.slots[0].weekdayLabel}</strong><span>{day.slots[0].dateLabel}</span></div>)}
            {timeLabels.map((time, rowIndex) => (
              <div className="grid-row" key={time} style={{ display: 'contents' }}>
                <div className="time-cell">{time}</div>
                {days.map((day) => {
                  const slot = day.slots[rowIndex]
                  if (!slot) return <div className="slot disabled" key={`${day.dateKey}-${time}`} />
                  const active = selected.has(slot.iso)
                  return <button
                    type="button"
                    aria-label={`${day.dateKey} ${time}`}
                    aria-pressed={active}
                    className={`slot ${active ? 'selected' : ''}`}
                    key={slot.iso}
                    onMouseDown={(e) => { e.preventDefault(); beginDrag(slot.iso) }}
                    onMouseEnter={() => { if (dragValue !== null) setSlot(slot.iso, dragValue) }}
                    onTouchStart={() => beginDrag(slot.iso)}
                  />
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card results-card">
        <div className="card-heading">
          <div><span className="eyebrow">Group view</span><h2>Best common times</h2></div>
          <span className="participant-count">{participantCount} participant{participantCount === 1 ? '' : 's'}</span>
        </div>
        {participantCount === 0 ? <p className="empty">No saved responses yet.</p> : (
          <div className="grid-scroll">
            <div className="availability-grid results" style={{ gridTemplateColumns: `72px repeat(${days.length}, minmax(76px, 1fr))` }}>
              <div className="corner-cell" />
              {days.map((day) => <div className="day-head" key={day.dateKey}><strong>{day.slots[0].weekdayLabel}</strong><span>{day.slots[0].dateLabel}</span></div>)}
              {timeLabels.map((time, rowIndex) => (
                <div className="grid-row" key={time} style={{ display: 'contents' }}>
                  <div className="time-cell">{time}</div>
                  {days.map((day) => {
                    const slot = day.slots[rowIndex]
                    if (!slot) return <div className="result-slot disabled" key={`${day.dateKey}-${time}`} />
                    const count = counts.get(slot.iso) ?? 0
                    const alpha = count / maxCount
                    return <div className="result-slot" key={slot.iso} style={{ backgroundColor: `rgba(64, 88, 204, ${0.06 + 0.94 * alpha})`, color: alpha > 0.55 ? '#fff' : '#4e5667' }} title={`${count}/${participantCount} available`}><span>{count || ''}</span></div>
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
        {participantCount > 0 && <div className="participants"><strong>Participants:</strong> {payload.participants.map((p) => p.name).join(', ')}</div>}
      </section>

      <footer className="privacy-footer">Calendar-file parsing happens in your browser. This app stores only your display name and the slots you mark as available.</footer>
    </main>
  )
}

export default function App() {
  const shareCode = shareCodeFromUrl()
  return shareCode ? <MeetingPage shareCode={shareCode} /> : <Home />
}
