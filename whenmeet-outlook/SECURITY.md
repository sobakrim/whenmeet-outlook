# Security notes

## Secrets

This frontend must never contain:

- a Supabase `service_role` / secret key,
- database passwords,
- any private API key.

The Supabase **publishable key** is intended for browser use. The SQL migration restricts what an anonymous browser can do with it.

## Calendar-file privacy

The app does **not** connect to Microsoft, Google, or another calendar provider.

When a participant chooses an `.ics` file:

1. the browser reads the file with the browser `File` API;
2. `ical.js` parses the calendar in memory;
3. event occurrences are reduced to busy start/end intervals;
4. the poll grid is filled with the slots that do not overlap those intervals;
5. only the participant name and the final availability slots are sent to Supabase after the participant clicks **Save availability**.

The `.ics` file itself, event titles, descriptions, locations, attendees, organizers, UIDs, and other calendar metadata are never sent to Supabase by the application code.

Important: the browser necessarily holds the selected `.ics` contents in memory while parsing it. A participant should still use a trusted deployment of this source code.

## ICS interpretation

- `STATUS:CANCELLED`, `TRANSP:TRANSPARENT`, and Outlook `X-MICROSOFT-CDO-BUSYSTATUS:FREE` entries do not block availability.
- Recurring events, recurrence dates/exclusions, and recurrence exceptions are expanded with `ical.js` for the poll period.
- Embedded `VTIMEZONE` definitions are registered before event expansion.
- Common Outlook Windows timezone IDs have IANA fallbacks.
- Calendar files are limited to 25 MB in the browser as a basic denial-of-service precaution.

## Database access

The migration enables RLS and revokes direct `anon` / `authenticated` privileges on all application tables. The browser can execute only the declared RPC functions.

Anyone possessing a participant share URL can see that poll's participant names and availability. Treat the share URL as a capability link; do not post it publicly unless that is intended.

The organizer URL contains an admin code in the URL fragment (`#admin=...`). URL fragments are not sent to GitHub Pages. The application also strips the fragment when copying a participant link.

## Abuse resistance

The MVP allows anonymous poll creation and responses. A public production deployment should add request throttling and/or bot protection in front of write operations and should receive an independent security review before high-volume or sensitive use.
