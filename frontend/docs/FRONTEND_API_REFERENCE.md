# Frontend API Integration Notes

This is an integration plan, not a claim that the frontend is already connected.

## Configuration

- `VITE_API_BASE_URL`: origin of the Express API, for example `http://localhost:3000`.
- `src/lib/api.ts`: JSON fetch wrapper with optional bearer token support.

## Backend modules to connect

| Frontend area | Backend base path | Initial integration |
|---|---|---|
| Authentication | `/api/auth` | Registration, login, session state |
| Communities | `/api/communities` | Community list, details, membership |
| Posts & discussions | `/api/posts` | Feed, create post, comments, reactions |
| Announcements | `/api/announcements` | Community announcements and read tracking |
| Notifications | `/api/notifications` | Paginated notification list |
| Activity | `/api/activities` | Community feed and personal activity |
| Gamification | `/api/gamification` | Points, badges, leaderboard |
| Analytics | `/api/analytics` | Overview, growth, engagement, top posts |

Confirm each endpoint's exact path, method, request schema, response schema, and permissions against the backend source before implementing calls.

## Suggested connection order

1. Implement auth and a single shared session/token state.
2. Connect community list and membership context.
3. Replace illustrative dashboard metrics and posts with API responses.
4. Connect post creation, comments, and reactions.
5. Add announcements and notifications.
6. Connect activity, gamification, and analytics.
7. Add loading, empty, validation, unauthorized, and server-error states.

## Security

- Never ship secrets in `VITE_*` environment variables.
- Never assume hiding a button enforces authorization; the backend must enforce permissions.
- Do not store a long-lived token in local storage without evaluating the application's threat model.
