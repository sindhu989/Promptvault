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

The backend includes Express routes, JWT authentication, and prompt CRUD
operations. It supports a real MongoDB connection when `MONGODB_URI` is set.
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
Public read-only data is available at
`/api/public/prompts/:shareId` and `/api/public/collections/:shareId`.
The frontend renders share links at `/share/prompt/:shareId` and
`/share/collection/:shareId`.

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
```

If `MONGODB_URI` is omitted, users and prompts are saved in
`backend/.data/store.json`. The local data directory is excluded from Git.
The frontend is available at http://localhost:4173 and the backend at
http://localhost:5000.

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

Production startup intentionally fails if `MONGODB_URI` is missing or
`JWT_SECRET` is shorter than 32 characters. Do not use the local JSON store for
a deployment: it is single-process development storage and may not persist
across host restarts or redeployments. Shared prompt and collection URLs use the
deployed service's own domain.
