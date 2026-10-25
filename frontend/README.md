# Gather — Community Engagement Hub Frontend

A React 19 + TypeScript + Vite frontend starter for the Community Engagement Hub.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

## Current state

This starter includes a responsive dashboard UI with illustrative preview data, navigation for the core product areas, a working post composer, local like interactions, and search. It is a frontend scaffold: community lists, posts, announcements, gamification, and analytics are not yet wired to the backend.

## Backend integration

Set `VITE_API_BASE_URL` in `.env` to the Express backend origin. `src/lib/api.ts` provides a small typed fetch wrapper and supports bearer tokens. Connect authentication and the individual page data to the backend routes before using real user data.

The app should use the Express API for product data and authentication. Supabase is currently retained in `package.json` from the initial setup but is not used by this scaffold; remove it if no separate Supabase feature is planned.

## Build

```bash
npm run build
npm run preview
```

## Notes

- All displayed metrics and example community content are illustrative.
- The activity and some secondary navigation views are scaffold placeholders.
- Do not store secrets in `VITE_*` variables; Vite exposes these values to the browser.
