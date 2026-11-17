# Nicol Pickleball Complex Online Reservation System

A responsive Node.js + SQLite reservation app for Nicol Pickleball Complex, Bood, Ubay, Bohol.

## Included
- Public booking website and live availability polling (15-second refresh)
- Three courts and one-hour slots, 5:00 AM–12:00 MN
- Day rate ₱150/hour (5 AM–before 5 PM); night rate ₱250/hour (5 PM–midnight)
- Server-side rate calculation and SQLite unique partial index to prevent double-booking
- Booking codes and reservation records
- GCash reference capture with manual staff/admin verification; cash payment tracking
- Separate Admin and Staff roles; admin-only payment verification and account management
- Daily booking, booked-value, collected-payment and per-court reports

## Run locally
1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and set a strong `SESSION_SECRET`, `ADMIN_PASSWORD`, and `STAFF_PASSWORD`.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000`.

The SQLite database is created automatically at `./data/nicol.sqlite` (or `DB_FILE`). The first run creates the admin and staff accounts from the environment variables. If `.env` is not configured, development defaults are used; **do not expose the app publicly with those defaults**.

## Initial login defaults (development only)
- Admin: `admin` / `ChangeThisAdmin123!`
- Staff: `staff` / `ChangeThisStaff123!`

Change these before any public deployment. The admin can add and deactivate staff/admin accounts from the dashboard.

## Deploying publicly
Deploy this folder to a Node.js host (for example Render or Railway) that supports a persistent disk/volume. Configure:
- `NODE_ENV=production`
- `SESSION_SECRET` = long random secret
- `DB_FILE` = path on the persistent mounted disk, e.g. `/var/data/nicol.sqlite`
- strong `ADMIN_PASSWORD` and `STAFF_PASSWORD` for first boot
- `PORT` = supplied by the host

Attach a persistent volume to the directory containing the SQLite file. Without persistent storage, reservations may be lost when a host restarts or redeploys. Enable HTTPS. The default Express in-memory session store is suitable only for a single-instance starter deployment; for multi-instance production, use a persistent shared session store and managed database.

## Payments
This release records GCash references and lets an admin mark a payment as received after checking the GCash account. It does **not** initiate or automatically verify GCash payments. Automated GCash checkout requires an approved merchant account and gateway credentials/webhooks (for example, a supported local payment gateway).

## Production checklist
- Set strong credentials and session secret; remove all development defaults.
- Use a persistent disk/database and backups.
- Configure a persistent session store if scaling beyond one app instance.
- Add CSRF protection, audit logs, SMS/email notifications, and a gateway integration before handling high-volume public bookings.
- Confirm local operating hours, cancellation/refund policy, and whether bookings require prepayment.
