# Azentio Collective

A working hackathon MVP for the Azentio.ai Special Challenge: public discovery, tenant-private client collaboration, governed cross-client learning, approved-only AIRA synthesis, and an evidence-linked product-improvement loop.

## What is implemented

- Public landing page, product catalogue, demo enquiry, and hackathon interest registration
- Five synthetic demo memberships: two isolated client tenants, learning moderator, product owner, and employee
- Server-resolved opaque demo sessions; protected APIs do not trust a browser-supplied tenant ID
- Client dashboard, entitled synthetic sandbox, private drafts, explicit sharing intent, consent, submission, status, and withdrawal
- Moderator queue with private source vs. separately stored de-identified shared copy
- Approved-only learning feed and deterministic AIRA response with real publication references
- Three-distinct-organisation aggregation threshold and immediate suppression after withdrawal
- Evidence-linked improvement creation with owner, priority, status, and audit records
- Durable D1 records for sessions, organisations, observations, publications, moderation, enquiries, notifications, improvements, and audit events

## Architecture

```text
Browser
  ├─ public routes ──────────────> persisted enquiries / registrations (D1)
  └─ authenticated demo session
       ├─ client tenant A/B ─────> private observations (D1, org scoped)
       ├─ moderator ─────────────> reviewed shared_publications
       └─ product owner ─────────> evidence-linked improvement_ideas

approved shared_publications only
  └─> threshold check (>= 3 distinct organisations)
       └─> collective theme + grounded AIRA response

withdrawal
  └─> source + publication invalidated synchronously
       └─> shared query recalculates and suppresses small cohorts
```

Private `observations` and approved `shared_publications` are separate tables. Shared API payloads omit source IDs, organisation IDs, author identity, attachments, and reviewer notes.

## Routes

| Experience | Routes |
| --- | --- |
| Public | `/`, `/products`, `/connect`, `/hackathon/register` |
| Demo identity | `/login` |
| Client | `/client/dashboard`, `/client/sandbox`, `/client/observations`, `/client/learning` |
| Moderator | `/moderation` |
| Shared learning | `/learning` |
| Employee / product owner | `/employee/dashboard`, `/employee/playground`, `/employee/ideas` |

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run db:generate
npm run build
for f in drizzle/0000_heavy_zuras.sql drizzle/0001_portal_security.sql; do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file "$f"
done
npm run dev
npm test        # Vitest: domain rules + DB-backed acceptance tests (in-memory SQLite with the real migrations)
npm run lint
```

Open `http://127.0.0.1:5173/signin-with-chatgpt?return_to=/login` for the local simulated sign-in. Hosted identity is supplied by Sites.

## Judge walkthrough

1. Sign in, then choose **Meridian Bank · client admin**. Create an observation with `propose_community`, tick processing consent, and submit. Open **Consent history** on the record.
2. Switch to **Learning moderator**. Review the private source (privacy-scan flags must be acknowledged), edit the safe copy, optionally link a theme, and publish — or ask for clarification / reject. The client is notified (bell icon) and can edit and resubmit clarified records.
3. Click **Load 3-org scenario**, then open **Collective learning**. Use the filters and ask AIRA a question; references are validated against the retrieved publications. Below three organisations (per theme, per filter set) the answer is "insufficient evidence".
4. Switch to **Product owner**, create an improvement from the approved theme, move it through its statuses with internal notes and client-visible updates.
5. Switch to **Northstar Finance** to confirm tenant isolation, report a publication (it is temporarily unpublished), or withdraw one of your own (consent revoked, retrieval excluded immediately).
6. Reloading the scenario never revives withdrawn records; it creates fresh synthetic records.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for diagrams. CI runs lint, unit/acceptance tests, build and Playwright on every push (`.github/workflows/ci.yml`).

## Access model

- `profiles`, `memberships`, `invitations` back every session. `/api/session` accepts **only a membership id**; the server checks that the membership belongs to the authenticated user and is active, then derives role and organisation from the membership row. Revoking a membership ends access on the next request.
- **Identity**: our own email + password accounts. Email ownership is proven with an emailed single-use 6-digit code (15-minute expiry, 5 attempts, older codes invalidated) sent through Resend when `RESEND_API_KEY` and `MAIL_FROM` are set. Without a provider the UI says so and an operator can run `node scripts/verify-email.mjs <email>` (with the Turso variables). Delivery is reported as "accepted by provider", never "delivered".
- **Platform identity headers** (`oai-authenticated-*`) are trusted **only** when `TRUST_PLATFORM_IDENTITY=1` (OpenAI Sites). They are ignored everywhere else, so they cannot be forged on Vercel/Cloudflare.
- **Deny by default**: a new account has no workspaces. Staff roles (moderator, product owner, employee, content publisher) go only to emails in `PORTAL_STAFF_EMAILS` **and** verified; those staff also get the synthetic demo tenants so they can demonstrate isolation. `DEMO_OPEN_CLIENT_TENANTS=1` (off in production) opens demo tenants to every account. Outside production, `DEMO_OPEN_STAFF` defaults on for local development.
- **Client invitations** are single-use, expire after 7 days, store only a token hash, and are accepted via `/accept-invite?token=…` by the signed-in account whose email matches. Admins see the link once (no email is sent automatically), and can revoke pending invitations. Client admins can only grant client roles.
- Roles: `client_admin`, `client_member`, `moderator`, `product_owner`, `employee`, `content_publisher`.
- Visibility: `private` = author only; `organization` and `propose_community` = members of the owning organisation; only `submitted` + `propose_community` enters moderation.
- Consents (`processing`, `community_sharing`, `attribution`, `model_training`) are append-only rows with policy version, actor and timestamp. Training is off by default and not offered. Attribution is shown on a shared copy only when the author consented **and** the moderator opts in.
- **Shared metadata** (offering, industry, region, period) comes from controlled lists and a period pattern, and the moderator confirms each value at publication; free text cannot reach the shared copy.
- **Withdrawal** invalidates retrieval immediately, deletes comments/bookmarks on the publication, alerts product owners, and improvements recompute their evidence on every read (withdrawn evidence never shows; ideas below three organisations are hidden from clients).
- Entitlements (`products`, `entitlements`) are checked server-side on every sandbox run.
- Workflow transitions live in `lib/domain/workflow.ts`; anything not in the map is rejected with 409 and every success is audited. Improvement statuses: Proposed, Under review, Planned, In progress, Released, Not proceeding.

## Employee, client and governance features

Knowledge library (owner, review date, search, useful/needs-update feedback), hackathon team spaces (members, progress, submission link, team experiments with a lifecycle), experiments with structured feedback, saved searches (open/rename/delete), a moderator/product-owner audit trail, in-portal client support requests with staff replies, release notes/broadcasts/client resources by audience, and recordings. Recording links are never returned in lists; `/api/media/<id>` re-checks the audience on every request before redirecting. A confidential recording must still be hosted somewhere that enforces access itself (the redirect target is revealed to permitted users only).

**Adding a video:** upload it to Google Drive and share it as "Anyone with the link", then sign in as a content publisher → Publish content → kind `recording`, audience `public` (shows on `/media` and `/live`), `client` or `employee`, and paste the Drive link (YouTube, Vimeo and direct .mp4 links also embed). The page shows a "Play recording" button that embeds the player after the audience check.

`GET /api/version` returns the deployed Git commit, so a deployment can be matched to a release.

## Test evidence

`npm test` runs 56 tests: unit tests for workflow, privacy scan, validation, RBAC and AIRA, plus acceptance tests against a real SQLite database built from the generated migrations (tenant isolation by id, privilege escalation → 403, consent history, draft-cannot-publish, payload leak check, threshold, withdrawal vs. re-seeding, report/restore, versioned republish, entitlement bypass, improvement audiences, rate limiting). `npm run test:e2e` runs 50 Playwright tests against the running app and a fresh local D1: the full learning loop, forged-membership/escalation/entitlement/validation checks over HTTP, admin screens (entitlements, themes, content, support access, lab), and mobile/tablet/desktop overflow checks with full-page screenshots in `e2e/screenshots/`.

## Security model and demo limitations

This is a synthetic hackathon environment. It does **not** claim production Entra ID, invitation email delivery, real client data, a production AI model, federated learning, secure aggregation, regulatory certification, or customer-system integrations. AIRA is a deterministic, clearly labelled (`deterministic_fallback`) approved-evidence synthesis. Withdrawal blocks future shared retrieval immediately; it cannot recall material already viewed or copied and does not claim model untraining. See `KNOWN_LIMITATIONS.md`.

## Deployment

**Vercel + Turso:** create a Turso database (Vercel dashboard → Storage → Turso, or `turso db create`), set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and `PORTAL_STAFF_EMAILS` on the Vercel project, run `node scripts/migrate-libsql.mjs` with the same Turso variables, then `vercel deploy --prod`. `db/index.ts` uses libSQL whenever `TURSO_DATABASE_URL` is set; `vercel.json` builds with plain `next build`.

Live: https://azentio-collective.vercel.app. Smoke test: `BASE_URL=https://azentio-collective.vercel.app node scripts/smoke-deployed.mjs` (add `STAFF_EMAIL` / `STAFF_PASSWORD` for the moderation → learning → improvement → withdrawal flow).

**Cloudflare (free plan: Workers + D1):** `npx wrangler login`, then `PORTAL_STAFF_EMAILS=you@example.com scripts/deploy-cloudflare.sh`. It builds, creates the D1 database, applies every migration remotely and deploys. Users create an account at `/signin` (email + password, PBKDF2); staff roles go only to emails in `PORTAL_STAFF_EMAILS`.

**OpenAI Sites:** the original target, below.


The project is configured for private OpenAI Sites hosting in `.openai/hosting.json`, with D1 bound as `DB`. Publishing applies committed migrations before the Worker is deployed.
