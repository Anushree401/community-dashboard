# Community Engagement Hub (CEH)

Local development and demo-testing guide.

## 1. Project location

```bash
cd "/media/anushreebalaji/skynet/Psnal/SIDE GIGS/PROJECTS/CEH/community-engine"
```

## 2. Start the backend

The Python virtual environment used for this project is at `~/ceh_venv`. Activate it first:

```bash
source ~/ceh_venv/bin/activate
cd "/media/anushreebalaji/skynet/Psnal/SIDE GIGS/PROJECTS/CEH/community-engine/backend"
```

Check that the backend `.env` exists and points to your **local development PostgreSQL database**. Do not commit `.env` or share its secrets.

Start the API:

```bash
npm run dev
node node_modules/ts
x/dist/cli.mjs watch src/server.ts # for me
```

Keep this terminal open. Use the API URL and port configured in `backend/.env` (commonly `http://localhost:3000`, but check your configuration). If the project exposes health routes, you can try `/health` and `/health/db` on that same origin.

### Backend validation commands

Run these from `backend/` in a separate terminal, with the virtual environment activated if needed:

```bash
npm run typecheck
npm test
npm run test:auth
```

These are validation commands, not server-start commands.

## 3. Start the frontend

Open a **second terminal**:

```bash
source ~/ceh_venv/bin/activate
cd "/media/anushreebalaji/skynet/Psnal/SIDE GIGS/PROJECTS/CEH/community-engine/frontend"
npm run dev
```

Keep this terminal open. Vite prints the local frontend URL, typically `http://localhost:5173`. Open the URL printed in the terminal.

If the frontend cannot reach the API, check its API base URL / Vite environment configuration and the backend port. Do not put private secrets in frontend environment variables.

## 4. Development demo accounts

The following are the planned local demo credentials for manual UI testing. They are **not created merely by writing this README**. They will work only after the corresponding seed script has been implemented and run successfully, or if you register the accounts manually.

| Role            | Email / login           | Password                |
| --------------- | ----------------------- | ----------------------- |
| Community admin | `admin@ceh.local`     | `CEH_Admin_2026!`     |
| Moderator       | `moderator@ceh.local` | `CEH_Moderator_2026!` |
| Member          | `member@ceh.local`    | `CEH_Member_2026!`    |
| Second member   | `member2@ceh.local`   | `CEH_Member2_2026!`   |

Use these credentials only in a local development database. Do not reuse them for real accounts or deploy them to production. If the application expects an email rather than a username, enter the email shown above.

## 5. Planned demo data

The development seed should create:

- Four users with valid password hashes compatible with the existing authentication routes.
- One public community and one private community.
- Correct active memberships and roles for permission testing.
- A few topics, published posts, comments, and reactions.
- Published and draft announcements.
- Activity records, point transactions, and badges where supported by the current Prisma schema.

**Seed status:** these records and accounts are not guaranteed to exist yet. The seed script still needs to be implemented and verified against `prisma/schema.prisma` before the credentials can be used.

## 6. Resetting and seeding the database

**Destructive operation:** a database reset removes existing data. Never run a reset against production or a database containing data you need.

Before resetting, verify `backend/.env` points to the intended local development database. The current Prisma schema uses PostgreSQL, and Prisma 7 may have datasource configuration in `prisma.config.ts`; follow the configuration already present in this repository.

Once a project-specific seed script has been added and reviewed, the intended workflow should be documented here with the exact commands. Do not run `prisma migrate reset` or any database-wide deletion command until the database target, migrations, and seed implementation have been confirmed.

## 7. Manual smoke-test checklist

After the demo seed is implemented and both servers are running:

1. Log in as the admin and confirm the public/private communities and admin-only controls are visible as expected.
2. Log in as the moderator and verify moderation permissions without assuming full admin privileges.
3. Log in as a member and verify regular member access.
4. Register a new account through the UI and confirm that login works with the newly registered credentials.
5. Join a public community; verify membership status and role.
6. Create a post, comment on it, and react to another user's post.
7. Verify the activity feed, points, leaderboard, and analytics reflect persisted data.
8. Create/publish an announcement as an authorized user; verify it appears for members.
9. Confirm a regular member cannot use admin/moderator endpoints.
10. Log out and log back in to verify session behavior.

Record actual outcomes after running the tests; do not mark a test passed just because the page loads.

## 8. Useful commands

From the project root:

```bash
# Backend (terminal 1)
source ~/ceh_venv/bin/activate
cd backend
npm run dev

# Frontend (terminal 2)
source ~/ceh_venv/bin/activate
cd frontend
npm run dev
```

To list backend npm scripts:

```bash
cd backend
npm run
```

To inspect Prisma configuration files:

```bash
ls -la prisma
test -f prisma.config.ts && sed -n '1,220p' prisma.config.ts
```

## 9. Secrets and repository hygiene

- Never commit `.env`, database passwords, real user credentials, or session tokens.
- Keep all demo accounts local-only.
- Do not enable public registration of predictable demo accounts in a production deployment.
- If these demo credentials are ever used outside a disposable local database, change their passwords immediately.
