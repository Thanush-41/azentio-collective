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

## Access model

- `profiles`, `memberships`, `invitations` back every session. `/api/session` accepts **only a membership id**; the server checks that the membership belongs to the authenticated user and is active, then derives role and organisation from the membership row. Revoking a membership ends access on the next request.
- Roles: `client_admin`, `client_member`, `moderator`, `product_owner`, `employee`. Client administrators can invite/revoke only client roles.
- Staff roles are granted to emails in `PORTAL_STAFF_EMAILS` (comma separated). In non-production builds they are granted to every signed-in user for local demos (`DEMO_OPEN_STAFF=0` disables). Demo client tenants are provisioned to signed-in users unless `DEMO_OPEN_CLIENT_TENANTS=0`.
- Visibility: `private` = author only; `organization` and `propose_community` = members of the owning organisation; only `submitted` + `propose_community` enters moderation.
- Consents (`processing`, `community_sharing`, `attribution`, `model_training`) are append-only rows with policy version, actor and timestamp. Training is off by default and not offered.
- Entitlements (`products`, `entitlements`) are checked server-side on every sandbox run.
- Workflow transitions live in `lib/domain/workflow.ts`; anything not in the map is rejected with 409 and every success is audited.

## Test evidence

`npm test` runs 39 tests: unit tests for workflow, privacy scan, validation, RBAC and AIRA, plus acceptance tests against a real SQLite database built from the generated migrations (tenant isolation by id, privilege escalation → 403, consent history, draft-cannot-publish, payload leak check, threshold, withdrawal vs. re-seeding, report/restore, versioned republish, entitlement bypass, improvement audiences, rate limiting). `npm run test:e2e` runs 33 Playwright tests against the running app and a fresh local D1: the full learning loop, forged-membership/escalation/entitlement/validation checks over HTTP, admin screens (entitlements, themes, content, support access, lab), and mobile/tablet/desktop overflow checks with full-page screenshots in `e2e/screenshots/`.

## Security model and demo limitations

This is a synthetic hackathon environment. It does **not** claim production Entra ID, invitation email delivery, real client data, a production AI model, federated learning, secure aggregation, regulatory certification, or customer-system integrations. AIRA is a deterministic, clearly labelled (`deterministic_fallback`) approved-evidence synthesis. Withdrawal blocks future shared retrieval immediately; it cannot recall material already viewed or copied and does not claim model untraining. See `KNOWN_LIMITATIONS.md`.

## Deployment

The project is configured for private OpenAI Sites hosting in `.openai/hosting.json`, with D1 bound as `DB`. Publishing applies committed migrations before the Worker is deployed.
