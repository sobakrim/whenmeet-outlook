# WhenMeet Calendar

A privacy-oriented, open-source alternative to When2Meet. Participants can fill their availability automatically by selecting an Outlook/iCalendar `.ics` file, or select slots manually.

The repository folder can still be named `whenmeet-outlook`; no rename is required. 

## What it does

- Create a meeting poll with a date range, daily hours, timezone and 15/30/60-minute slots.
- Share a participant link.
- Participants can either:
  - **Import calendar (.ics)** and automatically mark calendar-free slots, or
  - **Select availability manually** with a click-and-drag grid.
- Everyone with the participant link sees a group heatmap.
- The organizer gets a separate URL containing an admin code that can delete the poll.

## Why `.ics` instead of Microsoft login?

Some university/company Microsoft 365 tenants prevent users from registering or authorizing third-party Entra applications. `.ics` import avoids that dependency entirely.

There is no Microsoft client ID, OAuth token, or Graph permission in this version.

## Privacy model

The calendar import happens entirely in the participant's browser:

1. The participant selects an `.ics` file.
2. `ical.js` parses it locally.
3. Recurring events and exceptions are expanded for the poll period.
4. Events are reduced to busy intervals in memory.
5. The app marks every poll slot that does not overlap a busy interval as available.
6. Only after **Save availability** is clicked are the participant name and selected slot timestamps sent to Supabase.

The application does **not** upload the `.ics` file, event title, description, location, attendee list, organizer, or other event metadata.

> This is an MVP, not a formally audited security product. Before a high-volume public deployment, add abuse controls such as rate limiting / CAPTCHA and conduct an independent security review.

## Outlook: getting an `.ics` file

In new Outlook / Outlook on the web, the usual route is:

**Settings → Calendar → Shared calendars → Publish a calendar → ICS**

Choose the lowest-detail publication option your organization offers. After downloading the file, you can unpublish the calendar if you do not want the published link to remain active.

Some organizations disable calendar publishing. In that case you will need another export route provided by your organization/calendar client, or use the manual grid.

## 1. Install locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

## 2. Create the Supabase project

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Run the full contents of [`supabase/001_init.sql`](supabase/001_init.sql).
4. Copy the project URL and the **publishable key** (or legacy anon key).
5. Put them in `.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Do **not** put a Supabase `service_role`/secret key in this application.

## 3. Build

```bash
npm run build
npm run preview
```

## 4. Deploy to GitHub Pages

This repository includes `.github/workflows/deploy-pages.yml`.

In GitHub:

1. Push the project to a repository whose default branch is `main`.
2. Go to **Settings → Pages** and choose **GitHub Actions** as the source.
3. Go to **Settings → Secrets and variables → Actions → Variables** and create only:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
4. Push to `main`; the workflow builds and deploys automatically.

There is **no `VITE_MICROSOFT_CLIENT_ID` anymore**.

The Vite configuration automatically uses the repository name as the GitHub Pages base path during GitHub Actions builds.

## How `.ics` availability is interpreted

- Calendar entries are busy by default.
- `STATUS:CANCELLED` is ignored.
- `TRANSP:TRANSPARENT` is ignored.
- Outlook `X-MICROSOFT-CDO-BUSYSTATUS:FREE` is ignored.
- Recurrence rules, RDATE/EXDATE and recurrence exceptions are handled through `ical.js`.
- Embedded `VTIMEZONE` definitions are registered.
- Common Outlook Windows timezone identifiers have fallback mappings to IANA timezones.
- A poll slot is considered unavailable if any part of the slot overlaps a busy calendar occurrence.
- The import is limited to `.ics` files up to 25 MB.

## Data model

The database contains only three tables:

- `meetings`: poll configuration + random share code + hash of organizer admin code.
- `participants`: display name + hash of the participant's local edit code.
- `availability`: participant ID + available slot timestamp.

Direct browser table access is revoked. The browser calls these RPCs:

- `create_meeting(...)`
- `get_meeting(share_code)`
- `save_participant(share_code, edit_code, name, slots)`
- `delete_meeting(share_code, admin_code)`

## Important current limitations

- Availability is boolean: a slot is either available or unavailable.
- The poll covers every calendar day in a contiguous date range.
- A participant's edit code is kept in that browser's local storage. Opening the link on another device creates a new participant entry.
- Participant names and availability are visible to anyone who has the unguessable participant link, like a normal scheduling poll.
- There is no email notification system.
- There is no rate limiter / CAPTCHA in this static MVP.
- If an `.ics` file uses a non-standard timezone without an embedded `VTIMEZONE` definition and without a known fallback, the poll timezone is used as the fallback.

## Suggested next improvements

- Weekday/specific-date picker instead of only a continuous range.
- Hover a group cell to see exactly which participants are available.
- Optional hidden participant names.
- Drag-and-drop `.ics` import.
- Organizer dashboard and poll closing date.
- Tentative / preferred / unavailable states instead of only free/unavailable.
- Supabase Edge Function + Turnstile for abuse prevention.
- Automated tests for the SQL RPC permission boundaries and calendar recurrence cases.

## License

MIT
