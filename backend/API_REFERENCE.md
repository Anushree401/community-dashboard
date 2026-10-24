# Community Engagement Hub — API Reference

This document summarizes the known endpoints and request conventions. Check the route implementations and validation schemas under `src/` for the complete, authoritative API contract.

## Base URL

```text
http://localhost:3000
```

The actual port depends on the application configuration.

## Common Headers

| Header | Value | Usage |
|---|---|---|
| Accept | `application/json` | Recommended for JSON responses |
| Content-Type | `application/json` | Requests with a JSON body |
| Authorization | `Bearer <session-token>` | Protected endpoints |

Never include real tokens or credentials in documentation.

## Common HTTP Status Codes

| Status | Meaning |
|---|---|
| 200 | Request successful |
| 201 | Resource created |
| 204 | Successful response without a body |
| 400 | Invalid request |
| 401 | Missing or invalid authentication |
| 403 | Insufficient permissions |
| 404 | Resource not found |
| 409 | Conflict |
| 429 | Rate limit exceeded |
| 500 | Unexpected server error |

Actual status codes and error response formats are endpoint-specific.

## 1. Health

| Method | Endpoint | Request |
|---|---|---|
| GET | `/health` | No body |
| GET | `/health/db` | No body |

These endpoints are intended for application and database health checks. Check `src/app.ts` for exact response schemas.

## 2. Authentication

Base path: `/api/auth`

| Method | Endpoint | Request |
|---|---|---|
| POST | `/api/auth/register` | JSON registration fields |
| POST | `/api/auth/login` | JSON login fields |

Registration accepts `email`, `password`, and `displayName`.

A successful registration returns HTTP 201 with `user`, `token`, `tokenType`, and `expiresAt`.

Invalid registration data returns HTTP 400 with an error and field-level details. Duplicate unique values can return HTTP 409.

Authentication endpoints are rate-limited. Check `src/auth/` for login responses, verification endpoints, and other session operations.

## 3. Communities

Base path: `/api/communities`

This module manages communities, memberships, invitations, and roles.

Consult the community router and its validation schemas for the exact endpoint paths, request fields, authorization requirements, and response formats.

## 4. Posts, Comments, and Reactions

Base path: `/api/posts`

This module manages community posts, comments, and reactions.

Consult the post router and its validation schemas for the exact endpoint paths, allowed operations, required fields, and response formats.

## 5. Announcements

Base path: `/api/announcements`

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/announcements/:announcementId/read` | Mark a published announcement as read |

The read operation requires authentication and active community access. Only published announcements can be marked as read.

A successful response includes:

```json
{
  "read": true,
  "announcementId": "<announcement-uuid>"
}
```

Consult the announcement router for listing, creation, publishing, updating, and archiving operations.

## 6. Notifications

Base path: `/api/notifications`

| Method | Endpoint | Query parameters |
|---|---|---|
| GET | `/api/notifications` | `page`, `limit` |

The router requires authentication.

Pagination defaults to `page=1` and `limit=20`. The limit must be between 1 and 100.

Example:

```bash
curl -X GET "http://localhost:3000/api/notifications?page=1&limit=20" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer <session-token>"
```

Consult the notification router for the exact response schema and additional operations.

## 7. Activities

Base path: `/api/activities`

All routes require authentication.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/activities/community/:communityId` | Retrieve a community activity feed |
| GET | `/api/activities/me?communityId=<uuid>` | Retrieve personal activity history |
| POST | `/api/activities` | Create an activity |

### Pagination

Feed pagination defaults to page 1 and limit 20. The limit must be between 1 and 100.

### Create an activity

Required JSON fields: `communityId` and `eventType`.

Optional fields: `postId`, `commentId`, and `metadata`.

A request cannot specify both `postId` and `commentId`. A referenced post or comment must belong to the specified community.

Example:

```bash
curl -X POST "http://localhost:3000/api/activities" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <session-token>" \
  -d '{
    "communityId": "<community-uuid>",
    "eventType": "LOGIN",
    "metadata": {
      "source": "manual-test"
    }
  }'
```

Replace the example event type and UUID with values supported by the application.

## 8. Gamification

Base path: `/api/gamification`

All routes require authentication.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/gamification/community/:communityId/points` | Retrieve community points |
| GET | `/api/gamification/community/:communityId/points/history` | Retrieve points history |
| POST | `/api/gamification/community/:communityId/points/award` | Award points |
| GET | `/api/gamification/community/:communityId/leaderboard` | Retrieve the leaderboard |
| GET | `/api/gamification/badges` | Retrieve badge definitions |
| GET | `/api/gamification/community/:communityId/badges` | Retrieve community badges |
| POST | `/api/gamification/community/:communityId/badges/award` | Award a badge |

Award operations require appropriate permissions. The recipient must have active community membership.

Duplicate point idempotency keys or duplicate badge awards can return HTTP 409. Consult the gamification schemas for exact request and response fields.

## 9. Analytics

Base path: `/api/analytics`

Analytics routes require authentication, active community membership, and the `COMMUNITY_ADMIN` or `MODERATOR` role.

| Method | Endpoint | Query parameters |
|---|---|---|
| GET | `/api/analytics/community/:communityId/overview` | None |
| GET | `/api/analytics/community/:communityId/membership-growth` | `days`, default 30 |
| GET | `/api/analytics/community/:communityId/engagement` | `days`, default 30 |
| GET | `/api/analytics/community/:communityId/top-posts` | `limit`, default 10 |

The `days` parameter must be between 1 and 365. The `limit` parameter must be between 1 and 50.

The overview reports community metrics. Membership growth reports daily membership additions. Engagement reports daily post, comment, and reaction counts. Top posts are ranked by reaction count and then comment count.

## 10. Finding the Exact Routes

To inspect route declarations in the source code, run:

```bash
grep -RInE '\.(get|post|put|patch|delete)\(' src \
  --include='*.ts' \
  --exclude='*.test.ts'
```

For each endpoint, verify:

- HTTP method and full path
- Authentication and authorization requirements
- Required headers
- Path and query parameters
- Request body and validation constraints
- Success response schema
- Error responses and status codes

The source implementation is authoritative if it differs from this document.
