# PromptVault

PromptVault is a web application for saving, organizing, searching, and reusing AI prompts.

## Project structure

- `frontend/` — React + Vite application
- `backend/` — Node.js and Express API
- `docs/` — project and API documentation
- `tests/` — shared or end-to-end tests

## Development status

Phase 1 — project structure: complete.
Phase 2 — frontend dashboard: complete.
Phase 3 — backend API and auth foundation: complete.
Phase 4 — MongoDB integration and prompt persistence: complete.
Phase 5 — prompt version history: complete.
Phase 6 — prompt tester with mock provider: complete.
Phase 7 — prompt duplicate and archive/restore: complete.
Phase 8 — collections and read-only sharing: complete.
Phase 9 — profile display name editing: complete.
Phase 10 — authenticated password change: complete.
Phase 11 — email password recovery: implemented; configure Resend to enable delivery.
Phase 12 — private prompt and collection backup export: complete.
Phase 13 — validated prompt import and multi-format export: complete.
Phase 14 — authenticated activity history: complete.
Phase 15 — account-level light and dark themes: complete.
Phase 16 — secure admin access foundation: complete.
Phase 17 — admin platform dashboard: complete.
Phase 18 — admin user management: complete.
Phase 19 — admin prompt management and public-content moderation: complete.
Phase 20 — admin collection management: complete.
Phase 21 — admin platform activity history: complete.
Phase 22 — featured public prompt discovery: complete.

The frontend supports creating, searching, filtering, favoriting, copying,
editing, and deleting prompts. The UI is connected to the real API and includes
duplicate, archive/restore, version history, version comparison, restore, and a prompt tester that resolves
dynamic `{{variables}}`. The mock provider previews the rendered prompt without
calling an external AI service. Successful mock runs can be saved and compared.
Users can group prompts into private or public collections, manage collection
membership, and create read-only share links for collections and individual
prompts. Shared pages expose only explicitly public, unarchived prompt content;
they do not expose account details, prompt versions, or test runs.
Users can update their profile display name; account email is shown read-only.
Users can change their password after verifying their current password.
Users can export prompts as JSON, CSV, Markdown, or TXT and import files in
those formats. JSON exports include version history, saved test runs, and
collections; the other formats include prompt text and metadata only. Imports
append new private prompts and collections without overwriting existing data,
assign new IDs and ownership, and remap collection membership. Imports are
limited to 100 prompts and 100 collections per file, with a 900 KB dashboard
file-size limit. JSON backups and exports may contain private prompt content
and should be stored securely.
The Activity view records recent prompt, collection, saved-test, and import
actions for the signed-in user. It shows the latest 100 entries and retains up
to 500 entries per user.
Users can select a light or dark appearance from account settings; the selected
theme is saved to their profile and applied automatically on later sign-ins.
Admin access uses a separate sign-in page, server-verified roles, rate-limited
login, and revocable 30-minute HTTP-only cookie sessions. User registration
always creates a standard user account; it cannot assign admin privileges.
User and admin sessions are held in `HttpOnly`, `SameSite=Strict` cookies and
are never returned as JavaScript-readable tokens. Password changes invalidate
existing user sessions. Existing browser bearer-token sessions are not migrated;
users and admins must sign in again after deploying this authentication change.
Authentication responses use an explicit user-profile allowlist and never
include password hashes, reset-token hashes, or session-version fields.
API responses use `Cache-Control: no-store` to prevent browsers and intermediary
caches from retaining authentication or private account data.
User and admin login validate bounded string credentials and perform a dummy
password-hash comparison for unknown accounts to reduce timing-based account
enumeration. Failed login responses do not disclose whether an account is
inactive or whether a user account has administrator access.
The protected admin dashboard summarizes users, prompts, collections, saved
tests, recorded prompt copies, and recent activity. Active and new user counts
use a rolling 30-day window. Usage totals reflect retained activity and saved
test results; historical copy counts are available only for copies recorded
since copy tracking was enabled.
The admin Users area supports paginated account search, role/status filters,
profile and recent activity review, prompt summaries, session invalidation,
account status changes, role changes, and permanent deletion. Deactivated or
suspended accounts cannot use authenticated APIs; status changes invalidate
their sessions. The final admin account cannot be demoted or deleted, and admins
cannot disable or delete their own account.
The admin Prompts area supports paginated content search, moderation and
archive/featured filters, prompt review and editing, moderation of shared
prompts, archive/restore, feature/unfeature, and confirmed permanent deletion.
Administrator edits create a new prompt version; edits to shared content return
it to pending review. Public prompt and collection links only expose approved
shared prompts. Newly shared prompts require admin approval before they appear
publicly, while existing links with no moderation state remain available.
Every admin prompt action is recorded in the owner's activity history. Prompt
management responses omit saved test outputs and private version snapshots.
The public `/discover` page lists featured community prompts and supports
search, category filtering, pagination, and copying. It is linked from both the
sign-in screen and signed-in library navigation. Only public, featured,
unarchived prompts approved for sharing appear in discovery.
The admin Collections area supports paginated search and visibility filters,
sanitized collection and included-prompt review, editing names and descriptions,
changing sharing visibility, and confirmed permanent deletion. Changing a
collection from public to private invalidates its existing share link.
Deleting a collection never deletes its prompts; administrator actions are
recorded in the collection owner's activity history.
The admin Activity area provides a protected, paginated platform activity view with search
across event metadata and account name/email, entity and action filters, and an
inclusive date range. Responses include only account name/email and event
metadata; passwords and internal entity/user IDs are excluded.
Password recovery uses one-time tokens stored as hashes and expires after one
hour. Token consumption is atomic, so concurrent reset requests cannot reuse
the same link. New reset links keep the raw token in the URL fragment, which is
not sent in HTTP requests; the frontend removes it from the address bar after
loading, and the server uses a no-referrer policy. Reset request and submission
routes are rate-limited. Recovery email is sent through Resend only after the
sender domain is verified and the service is configured.

The backend includes Express routes, HTTP-only cookie authentication, and prompt
CRUD operations. It supports a real MongoDB connection when `MONGODB_URI` is set.
Without that variable, development uses JSON storage at
`backend/.data/store.json`, which persists across backend restarts. This local
fallback is intended for single-process development; use MongoDB for deployment.
Prompt edits create immutable snapshots with version numbers, change notes,
creator IDs, and timestamps. Restoring an older version creates a new version.
Prompt test runs can also be saved to the prompt and are private to its owner.
Authenticated collection routes are available under `/api/collections`.
Authenticated profile reads and display-name updates are available at
`/api/auth/me`.
Authenticated password changes are available at `/api/auth/password`.
Password recovery uses `POST /api/auth/forgot-password` and
`POST /api/auth/reset-password`.
Public read-only data is available at
`/api/public/prompts/:shareId` and `/api/public/collections/:shareId`.
The frontend renders share links at `/share/prompt/:shareId` and
`/share/collection/:shareId`.
Featured public prompt discovery is available at `/discover` and
`GET /api/public/prompts/featured`, with optional `page`, `search`, and
`category` filters. The endpoint returns only approved, public, featured, and
unarchived prompt fields; saved tests and version history are never included.
Authenticated data export and import are available at `GET /api/export?format=json|csv|md|txt`
and `POST /api/import`. The import request includes `format`, `filename`, and
the file's text in `content`. JSON accepts either a prompt array or a PromptVault
backup object. CSV requires `title`, `content`, and `category` columns.
Markdown and TXT imports accept PromptVault's exported structure; a plain TXT
file is also accepted as one prompt.
The authenticated `GET /api/activity` endpoint returns up to 100 recent
activity entries for the current user.
The authenticated `PUT /api/auth/preferences` endpoint accepts
`{"theme":"light"}` or `{"theme":"dark"}` and returns the updated user profile.
Admin sign-in is available at `/admin` and uses `POST /api/admin/auth/login`.
The protected `GET /api/admin/auth/me` and `POST /api/admin/auth/logout`
endpoints verify and end admin sessions. Admin account bootstrap is described
below.
The admin-only `GET /api/admin/dashboard` endpoint provides current platform
counts and the latest 12 activity records. Dashboard statistics refresh
automatically once per minute.
Admin user-management endpoints are rooted at
`/api/admin/dashboard/users`: `GET` lists filtered users, `GET /:id` returns a
sanitized profile with prompts and recent activity, `PATCH /:id/status` and
`PATCH /:id/role` manage accounts, `POST /:id/reset-access` invalidates
sessions, and `DELETE /:id` transactionally removes an account and its owned
data.
Admin prompt-management endpoints are rooted at
`/api/admin/dashboard/prompts`: `GET` lists filtered prompts, `GET /:id` returns
prompt details, `PATCH /:id` edits prompt content and appends a version,
`PATCH /:id/moderation` approves or rejects public sharing,
`PATCH /:id/flags/:flag` archives/restores or features/unfeatures, and
`DELETE /:id` permanently deletes the prompt and removes it from collections.
Admin collection-management endpoints are rooted at
`/api/admin/dashboard/collections`: `GET` lists filtered collections,
`GET /:id` returns collection metadata and sanitized prompt summaries,
`PATCH /:id` edits the collection and sharing visibility, and `DELETE /:id`
deletes the collection while preserving its prompts.
The admin-only `GET /api/admin/dashboard/activity` endpoint lists platform
activity with optional `page`, `search`, `entityType`, `action`, `from`, and
`to` filters. Date filters use `YYYY-MM-DD`; the end date is inclusive.

## Run the frontend

```sh
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 4173
```

## Run the backend

```sh
cd backend
npm install
npm run dev
```

Use a `.env` file in the backend if you want to point to an actual MongoDB instance:

```env
PORT=5000
JWT_SECRET=replace_with_a_random_secret_of_at_least_32_characters
MONGODB_URI=mongodb://localhost:27017/promptvault
ADMIN_EMAIL=your-admin-account@example.com
ADMIN_BOOTSTRAP_SECRET=replace_with_a_private_random_secret_of_at_least_32_characters
```

To bootstrap the first administrator, configure both `ADMIN_EMAIL` and a
private, random `ADMIN_BOOTSTRAP_SECRET` of at least 32 characters in the backend
environment. Register the account normally, then sign in at `/admin` with its
email and password. The server promotes that account only when the email matches
`ADMIN_EMAIL` and the server-side bootstrap secret is configured. The secret is
never entered in the browser or sent by the frontend. Remove both bootstrap
variables after promotion; the stored admin role remains.
Admin roles must be provisioned by trusted database/environment operators and
cannot be self-assigned through the public registration or profile APIs.

If `MONGODB_URI` is omitted, users and prompts are saved in
`backend/.data/store.json`. The local data directory is excluded from Git.
The frontend is available at http://localhost:4173 and proxies `/api` requests
to the backend at http://localhost:5000. Browser code stores no API credentials;
MongoDB, JWT, bootstrap, and email secrets are configured only on the backend.

## Deploy to Render

The repository includes a Render Blueprint (`render.yaml`) that builds the
frontend and serves it from the Express backend on one web service. The
deployed frontend calls the API on the same origin.

1. Push this project to a GitHub repository.
2. Create a MongoDB Atlas cluster and database user. In Atlas Network Access,
   allow connections from Render. Render's outbound IPs can be dynamic; if you
   allow `0.0.0.0/0`, remember that this is broad network access and use a
   dedicated database user with a strong password.
3. In Render, create a new **Blueprint** and select the repository. Confirm the
   `promptvault` web service.
4. When prompted for `MONGODB_URI`, paste the Atlas connection URI with the
   database name `promptvault`. Keep the username, password, and URI private.
   Render generates `JWT_SECRET` and sets production mode from `render.yaml`.
5. Deploy. When the service is live, open its Render URL and verify
   `/api/health` returns `"status":"ok"` and `"mode":"mongodb"`.
6. Create an account and test prompt creation, refresh, and sign-in again to
   confirm data persists in MongoDB.

The health endpoint returns HTTP 503 with `"status":"error"` and
`"mode":"disconnected"` if a configured MongoDB connection is unavailable,
allowing the deployment platform to detect database outages. All API routes
also return HTTP 503 during a MongoDB outage instead of silently switching to
the development JSON store; the health endpoint remains available.
Production startup intentionally fails if `MONGODB_URI` is missing or
`JWT_SECRET` is shorter than 32 characters. Do not use the local JSON store for
a deployment: it is single-process development storage and may not persist
across host restarts or redeployments. Shared prompt and collection URLs use the
deployed service's own domain.

User passwords must be at least 12 characters and no more than 72 UTF-8 bytes.
Configure secrets in the Render service's private Environment settings, never
in source files or `VITE_*` frontend variables. The optional `CORS_ORIGINS`
backend variable accepts a comma-separated allowlist only when the frontend is
hosted separately. A split frontend and API must still share the same site for
the strict session cookies to be sent; keep both on the same origin when possible.

### Enable password-reset email

Email recovery requires a Resend account and a sender domain verified with
Resend. In Render's **Environment** settings, add `RESEND_API_KEY` and
`RESEND_FROM` using the verified sender address, for example
`PromptVault <no-reply@yourdomain.com>`. Render's `RENDER_EXTERNAL_URL` is used
to construct reset links. Keep the API key private. Reset requests always use
the same public response to prevent account discovery; email delivery failures
are reported in the backend logs. Login and other app features continue to
work without email settings.
