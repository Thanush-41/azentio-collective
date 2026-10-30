# Known limitations

- **Identity**: no Azentio Entra ID or client SSO. Sign-in is the hosting platform's identity; demo client tenants are auto-provisioned and staff roles come from `PORTAL_STAFF_EMAILS` (or any signed-in user in non-production). Invitations are accepted on next sign-in; no email is sent.
- **Not yet built**: moderator/support access authorisation records, content-publisher permissions, a full entitlement admin UI (API exists for product owners), employee broadcasts/recordings, experiment submissions, hackathon team spaces, release notes, saved searches/bookmarks, comments, attachments, support-ticket integration.
- **AIRA** is a deterministic keyword-matched synthesis over approved theme evidence, labelled `deterministic_fallback`. No LLM is called.
- **Theme creation** is seeded (`THM-SEASONALITY`); moderators link publications to existing themes but there is no theme-authoring UI.
- **Rate limiting** is a fixed-window counter in D1 keyed by client IP header; idempotency keys cover observation creation and the public forms.
- **Testing**: Vitest unit + DB-backed acceptance tests pass. HTTP-level/Playwright tests, cookie/session route tests and responsive visual QA are outstanding.
- **Deployment / submission**: no public URL, CI, architecture diagram, walkthrough video, or commit history yet. A public site needs authentication enforced only on portal routes and APIs (or separate public and portal deployments).
- **Withdrawal** cannot recall content already read or copied and makes no model-untraining claim. Federated learning is out of scope.
