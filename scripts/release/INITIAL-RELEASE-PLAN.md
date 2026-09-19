# Initial paid release: execution order and outstanding gates

Prepared 2026-09-19. Not an approval or an executable deployment command.
Approved product scope: JPY1,980/month inclusive, first-trial 14 days with card
required, period-end cancellation, one verified owner master account. Preserve
legacy data; do not import old sandbox subscriptions. LINE notifications and
LINE cancellation are excluded from this release.

## Configuration profile

```sh
node scripts/check-release-env.cjs --target production --profile initial-saas
```

Use staging instead of production when checking the test environment. This
profile requires both LINE_BOOKING_NOTIFICATIONS_ENABLED and
LINE_BOOKING_CANCELLATION_ENABLED to equal `false`. It does not require the
excluded LINE credentials. It retains all origin, Supabase key/target and Stripe
checks. Existing LINE URLs, if present, are still checked. The default full-line
profile is unchanged. Passing this check does not disable UI routes, prove remote
credentials work or grant permission to publish.

## Current evidence

| Area | Verified | Remaining |
| --- | --- | --- |
| Recovery | Synthetic ordinary-role DB/Auth/private photo restore; encrypted local restore and photo corruption/missing-reference detection | Actual approved capture, closed restore and cutover consistency controls |
| Stripe | Live account enabled; monthly JPY1,980 price exists | Inclusive price treatment, portal, webhook and secret storage |
| Public documents | Three staging legal pages return 200 | Three production legal URLs returned 404; publish approved pages before offering purchase |
| Environment | Vercel CLI authenticated by owner on 2026-09-20; production variable names read directly | Values not inspected; server price/portal IDs and both explicit LINE flags absent; verify actual targets |
| Automation | Release branch tests; main remains protected by release decision | Main push also deploys app; do not merge merely to run backup |

## Order after the concrete production plan is approved

1. Record exact app/code revisions, source and recovery targets, previous
   settings, maintenance/consistency controls and failure recovery procedure.
   Resolve the protected backup execution path without accidentally deploying
   the new application. This path is still an outstanding gate.
2. Apply the rehearsed maintenance controls. Capture the approved data scope,
   decrypt/restore in the closed target, and verify DB/photo references and
   byte hashes. A completed upload alone does not pass this gate. Do not expose
   customer/Auth data in ordinary staging or CI artifacts.
3. Keep purchases closed. Publish the approved legal pages with a compatible
   maintenance deployment and verify production URLs. Do not promote a build
   containing staging public configuration.
4. Configure Live Stripe using stripe-live-plan.json. Re-read the live state
   before creating anything, to avoid duplicates. Store the new webhook secret
   directly in the production secret store. Customer charging is outside scope.
5. Record and apply environment changes for production only: verify Live secret,
   add STRIPE_PRO_PLAN_ID and STRIPE_BILLING_PORTAL_CONFIGURATION_ID, replace
   STRIPE_WEBHOOK_SECRET with the matching new endpoint secret, and set both
   excluded LINE flags false. Preserve the legacy public price variable until
   the old app is no longer needed. Do not remove Preview targets blindly:
   the independent staging project has its own configuration to verify.
6. Harden photo storage and apply the approved cutover SQL, with preservation
   assertions. Build/deploy the reviewed code with production configuration.
7. Verify authenticated/foreign/anonymous access, master identity, webhook
   reconciliation, portal settings and final checkout terms. No real charge
   is implicitly authorized. Reopen only after acceptance checks pass.

## Three outstanding release gates

1. Approved, executable capture/recovery path and sufficient cutover consistency
   controls (global source quiescence is not yet established).
2. Production-specific config and public-page rollout, including a way to store
   Stripe secrets without exposing them in chat. Owner-approved Vercel CLI device
   authentication now works. Bulk production-secret export was rejected by
   automatic approval review and was not performed; metadata inspection alone
   does not verify secret values, account mode or connectivity.
3. Final acceptance evidence and owner approval for the exact revision/actions.

Keep these gates explicit. Do not repeatedly add unrelated features or routine
backup scheduling/notification work as new conditions for a supervised initial
release. Do not treat this document or a generic request to continue as the final
production approval.

## Read-only production inspection, 2026-09-20 JST

The public domain currently resolves to READY deployment
`dpl_3VYfk8mfLmxuqcaw6tQk1B4i26bF`, revision
`2945fc2b44e0bc7f17bca5e3ef13334c7a202dd2`. Do not assume the latest main
commit is the currently serving application. No production deployment was made.

`preflight-report.sql` returns one JSON result in a read-only transaction.
The six migration prerequisite error counts were all zero, and no new release
tables were already initialized. Preservation counts: 8 Auth users, 5 customers,
16 medical records, 15 photo references, 16 Storage objects and 2 legacy
subscriptions. The one photo bucket remains public without MIME/size limits;
hardening remains an approved-cutover action. These counts are an observation,
not a backup or evidence that writes have stopped.
