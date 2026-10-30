# Known limitations

- **Identity**: no Azentio Entra ID or client SSO. Off Sites, accounts are self-service email + password (no email verification, no password reset, no MFA); on Sites the platform identity is used; demo client tenants are auto-provisioned and staff roles come from `PORTAL_STAFF_EMAILS` (or any signed-in user in non-production). Invitations are accepted on next sign-in; no email is sent.
- **Not built**: attachments with private storage controls and support-ticket integration. Experiments/teams, release notes, knowledge items, client resources, bookmarks/saved searches and comments exist in minimal form (no editing/deletion of comments, no team-space content beyond membership).
- **AIRA** is a deterministic keyword-matched synthesis over approved theme evidence, labelled `deterministic_fallback`. No LLM is called.
- **Theme matching** is keyword-based; moderators author themes and link approved publications manually.
- **Rate limiting** is a fixed-window counter in D1 keyed by client IP header; idempotency keys cover observation creation and the public forms.
- **Testing**: Vitest (39) and Playwright (33) pass locally. CI (`.github/workflows/ci.yml`: lint, unit/acceptance, build, Playwright) passed on `main` — https://github.com/Thanush-41/azentio-collective/actions/runs/41022644530; visual QA is screenshot capture plus overflow assertions, not pixel-diff regression.
- **Deployment / submission**: not yet deployed (no public URL, so no smoke test against a deployed database), no walkthrough video, and no multi-author commit history yet. A public site needs authentication enforced only on portal routes and APIs (or separate public and portal deployments).
- **Withdrawal** cannot recall content already read or copied and makes no model-untraining claim. Federated learning is out of scope.
