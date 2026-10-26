# Maleficent Chat 3.6.9

## Changes in this repair
- Added Express 4 async-route error forwarding so rejected GET/API handlers produce a logged server error and a consistent JSON response instead of a stalled request.
- Added explicit root-page serving and clear JSON 404 responses for unknown `/api/*` endpoints.
- Preserved room age limits when loading rooms from PostgreSQL into application state.
- Retained the existing interface and PostgreSQL-backed data model.

## Deployment
1. Back up your PostgreSQL database before replacing the deployed files.
2. Upload this ZIP to the repository/deployment workflow you already use.
3. Configure `DATABASE_URL` and a long random `SESSION_SECRET` in the hosting environment.
4. Set `OWNER_PASSWORD` to a strong password before the first startup if initializing the permanent Developer account for the first time. Do not share credentials or put them in source files.
5. Deploy and check the service logs if an API request still fails. The logs now include the HTTP method, URL, and server-side error; client responses intentionally avoid exposing stack traces.

## Important
This is a targeted reliability repair, not a claim that every requested feature has been fully implemented or end-to-end tested. Database connectivity and live deployment behavior must be verified in the hosting environment.
