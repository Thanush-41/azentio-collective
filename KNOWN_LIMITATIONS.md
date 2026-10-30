# Known limitations

- **Identity**: no Azentio Entra ID or client SSO. Sign-in is the hosting platform's identity; demo client tenants are auto-provisioned and staff roles come from `PORTAL_STAFF_EMAILS` (or any signed-in user in non-production). Invitations are accepted on next sign-in; no email is sent.
- **Not built**: attachments with private storage controls and support-ticket integration. Experiments/teams, release notes, knowledge items, client resources, bookmarks/saved searches and comments exist in minimal form (no editing/deletion of comments, no team-space content beyond membership).
- **AIRA** is a deterministic keyword-matched synthesis over approved theme evidence, labelled `deterministic_fallback`. No LLM is called.
- **Theme matching** is keyword-based; moderators author themes and link approved publications manually.
- **Rate limiting** is a fixed-window counter in D1 keyed by client IP header; idempotency keys cover observation creation and the public forms.
- **Testing**: Vitest (39) and Playwright (33) pass locally. CI is not configured; visual QA is screenshot capture plus overflow assertions, not pixel-diff regression.
- **Deployment / submission**: no public URL, CI, architecture diagram, walkthrough video, or commit history yet. A public site needs authentication enforced only on portal routes and APIs (or separate public and portal deployments).
- **Withdrawal** cannot recall content already read or copied and makes no model-untraining claim. Federated learning is out of scope.
