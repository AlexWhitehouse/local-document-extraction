# PRD: Workspace Billing Production Readiness

Status: ready-for-agent

## Problem Statement

Workspace billing has been implemented and has strong automated coverage for the main owner, Application admin, Stripe webhook, Billing ledger, and Billing reconciliation flows. However, the system is not yet fully ready for live billing deployment.

From the user's perspective, production billing must not silently miss Stripe lifecycle events, activate or retain the wrong Workspace billing entitlement after a Stripe-side change, lose visibility into payment failures that require customer action, or deploy with the wrong Stripe secrets. The app also needs a reliable operator path for live secrets, live webhook configuration, restricted Stripe API key permissions, and final Stripe test-mode verification before accepting real payments.

The remaining work is a hardening pass over Stripe billing event coverage, webhook processing semantics, production deploy configuration, and operational verification. It should preserve the existing Workspace billing product rules and focus on closing gaps that could cause live billing drift, confusing owner-facing payment state, or unsafe production deployment.

## Solution

Add a production-readiness layer around the existing Workspace billing implementation.

The Stripe billing event handler should process every Stripe event type required by the current Workspace billing model. It should continue to activate paid entitlements only after successful payment events, but it must also track negative and lifecycle events that affect whether a Workspace is paid, unpaid, canceled, awaiting customer action, blocked by invoice finalization, or moving through a scheduled Plan downgrade.

The handler should treat Plan downgrade invoices as first-class paid subscription invoices. A paid invoice whose subscription metadata says the billing action is a Plan downgrade should activate the lower paid plan for the new Billing period, update the Stripe subscription references, grant the lower plan's Included Credits for that period, and leave Purchased Credits intact.

The handler should process subscription lifecycle events so the app remains correct when Stripe changes are made outside the owner-facing app flow. Stripe-side cancellation, cancel-at-period-end reversal, subscription deletion, subscription pause/resume, or plan changes should not leave stale Workspace billing state. Lifecycle events that cannot be confidently mapped to the app's Workspace billing rules should record Billing reconciliation drift for Application admin review rather than applying an unsafe state transition.

The handler should process invoice events that indicate customer action or invoice finalization failure. Invoices requiring payment authentication, lacking required tax/location inputs, or failing finalization should be visible in Workspace billing state and Application admin billing review, with hosted invoice/payment URLs preserved when Stripe provides them. These events should not grant Credits or paid entitlement.

The handler should process delayed-payment Checkout outcomes if delayed payment methods are enabled in Stripe Dashboard. Successful delayed Credit pack payments should grant Purchased Credits exactly once. Failed delayed payments should leave the Credit pack ungranted and make the failed payment visible enough for owner/admin follow-up.

Webhook persistence should distinguish handled, ignored, and failed Stripe billing events. Unknown event types or events that are not relevant to Workspace billing should not be recorded in a way that blocks future handling after code is updated. Failed events should leave enough durable, non-secret detail for Application admins or operators to diagnose whether Stripe will retry, whether metadata is incomplete, or whether manual reconciliation is required.

Production deployment should reliably load production Stripe secrets from the operator-managed secrets file or Cloudflare Worker secrets. The deploy command should pass the production secrets file, the Worker configuration should declare required secrets where practical, and documentation should make it clear that development secrets and production secrets are separate. The secrets file must remain ignored by git and must never be printed, committed, or copied into docs.

Before live launch, an operator should be able to run a repeatable Stripe test-mode verification pass that proves every owner and Application admin billing flow works end to end, or records the exact missing prerequisite when a manual Stripe test cannot be run.

## Production Launch Blockers

These entries block live billing deployment. The PRD is ready for implementation, but production launch is not complete until every blocker is closed or explicitly accepted by the product operator with a documented rationale.

- [ ] Stripe account live-readiness is confirmed by an operator, including account activation, Dashboard team access, strong 2FA/passkeys, business profile, payout readiness, statement descriptor, customer support contact, tax/VAT/GST approach, and any Stripe-requested compliance information.
- [ ] Stripe test mode and live mode are separated end to end. The live Worker must use live-mode `rk_live_...` or approved server-side `sk_live_...` credentials, live webhook signing secrets, and live-mode Product/Price IDs. The current checked-in `STRIPE_PRO_MONTHLY_PRICE_ID` and `STRIPE_MAX_MONTHLY_PRICE_ID` values match the earlier test-mode setup notes and must not be used for production unless the operator proves they are live-mode resources.
- [ ] The live Stripe API key is a restricted API key unless Stripe permissions make that impossible. The permission set must be documented from observed API calls and include only the operations required by current code: Customer create/read/update, Checkout Session create/read/list, Subscription read/update/delete or cancel, Invoice create/read/list/finalize, Invoice Item create, and any read permissions used by Billing reconciliation. If a secret key is temporarily used, the exception, owner, expiry date, and rotation plan must be documented.
- [ ] Stripe API versioning is aligned. Outbound REST calls must keep using the intended pinned Stripe version, and the live webhook endpoint's event payload API version must be pinned or verified against the payload fields consumed by the Worker before launch.
- [ ] The live webhook endpoint is configured as an account-scoped HTTPS endpoint for `https://extract.t3m.uk/v1/billing/stripe/webhook`. It must not be an organization-wide endpoint, must not listen to connected-account events, and must not subscribe to all events.
- [ ] The exact live Stripe webhook event allowlist is documented and matched by code and tests. Required or explicitly reviewed events are `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `invoice.finalized`, `invoice.finalization_failed`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.voided`, `invoice.marked_uncollectible`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, and `customer.subscription.resumed`. If `invoice.created` is subscribed for invoice-finalization behavior, it must be intentionally handled or ignored with a fast 2xx response; otherwise it must be omitted from the live endpoint.
- [ ] Webhook security is production-grade. The handler must verify the raw request body, reject invalid signatures, enforce a timestamp tolerance to mitigate replay attacks, compare signatures in constant time, and document the signing-secret rotation procedure, including how to handle Stripe's temporary two-secret rotation window.
- [ ] A Stripe webhook IP allowlisting decision is recorded. If Cloudflare Worker routing makes Stripe source-IP allowlisting impractical for this endpoint, the exception must be documented and compensated with strict signature verification, narrow event subscription, and observability.
- [ ] Webhook persistence distinguishes `processed`, `ignored`, and `failed` outcomes. Unknown or irrelevant events must be stored, if stored at all, as ignored/non-business events so that future support for those event types is not blocked by old dedupe rows.
- [ ] Webhook failure semantics are explicit. Transient or fixable failures must record non-secret diagnostics and return non-2xx so Stripe retries. Permanent unprocessable events must record durable failed diagnostics and have an Application admin/operator review path. No raw Stripe payloads, API keys, webhook secrets, payment method details, or unnecessary PII may be stored.
- [ ] Webhook processing is idempotent, order-independent, and delayed-event-safe. Duplicate Stripe deliveries, distinct duplicate business-object events, delayed Checkout payments, out-of-order subscription events, and manual Stripe event replays must not duplicate Credits, entitlements, or audit entries.
- [ ] Webhook execution has a bounded production processing model. Either the handler remains synchronous with tests proving it stays within Stripe/Worker response limits under realistic event bursts, or it validates/signs/persists minimal event work and hands processing to a Queue or equivalent retryable background path without storing raw sensitive payload archives.
- [ ] Subscription lifecycle handling is complete for Stripe-side changes outside the app flow. Safe transitions must update Workspace billing state; ambiguous dashboard-side subscription creation, plan change, pause/resume, cancellation reversal, deletion, or missing metadata must record Billing reconciliation drift rather than applying unsafe entitlement changes.
- [ ] Invoice lifecycle handling is complete for negative and terminal states. Payment action required, finalization failed, payment failed, voided, marked uncollectible, and tax/location finalization failures must be owner/admin visible, must preserve hosted invoice/payment URLs when Stripe provides them, and must never grant paid entitlement or Credits.
- [ ] Plan downgrade invoices are first-class paid subscription invoices. A paid downgrade invoice must activate the lower paid plan for the new period, update Stripe subscription references, grant the lower plan's Included Credits exactly once, preserve Purchased Credits, and clear or update scheduled entitlement state deterministically.
- [ ] Billing reconciliation is live-operational. It must cover missed delayed-payment outcomes, subscription lifecycle drift, invoice terminal states, and missed paid invoices without destructive ledger rewrites. It must surface unresolved drift in the Application admin billing view.
- [ ] A production Cron Trigger is configured and verified for the Worker's `scheduled()` handler. The cadence must be documented in `wrangler.jsonc` or an operator-runbook Dashboard step, and the launch checklist must prove scheduled Billing reconciliation plus Enterprise invoice generation actually run in production.
- [ ] Scheduled billing work is failure-isolated. One Workspace's reconciliation or Enterprise invoice-generation failure must not permanently prevent other Workspaces from being checked, and failures must be visible in logs, reconciliation drift, or admin diagnostics.
- [ ] Cloudflare Worker secrets are declared and validated. `wrangler.jsonc` should use the current `secrets.required` configuration where practical for `BETTER_AUTH_SECRET`, `AI_GATEWAY_TOKEN`, `GOOGLE_CLIENT_SECRET` when Google sign-in is enabled, `STRIPE_API_KEY`, and `STRIPE_WEBHOOK_SECRET`. `wrangler types` must be regenerated after changing required secrets or bindings.
- [ ] The production deploy path is single and repeatable. The code, README, and package scripts must agree whether production secrets come from Cloudflare-stored Worker secrets, `wrangler deploy --secrets-file ../.vars`, or both. The chosen production secrets file path must remain gitignored, must be checked for presence/shape before deploy, and must never print values.
- [ ] Cloudflare Worker configuration is production-current. Before launch, validate the Wrangler schema, review/update `compatibility_date` for the launch date, keep `nodejs_compat`, keep observability enabled with an intentional sampling setting, confirm all bindings exist remotely, and verify `workers_dev = false` plus the custom domain route.
- [ ] Remote Cloudflare state is ready. D1 remote migrations, Durable Object migrations, R2 bucket, Queue producer/consumer, Workflow binding, Analytics Engine dataset, Email binding, assets build, and custom domain must be verified in the production account before billing traffic is enabled.
- [ ] Stripe and Worker observability are ready before live traffic. Logs must include structured non-secret fields such as Stripe event ID, event type, processing outcome, Workspace ID when known, related Stripe object ID, duration, and retry/error classification. Operators must know where to inspect Stripe event deliveries, Cloudflare Worker errors, scheduled runs, and Billing reconciliation drift.
- [ ] A live billing rollback and pause path exists. Operators must be able to stop new Checkout creation, disable or narrow the Stripe live webhook endpoint, roll back the Worker version, rotate compromised secrets, and run reconciliation after recovery without losing already-paid entitlements.
- [ ] Frontend and admin surfaces are launch-ready. Owner billing pages and Application admin billing views must show customer-action, finalization-failure, payment-failed, delayed-payment-failed, unpaid, suspended, drift, and failed-event diagnostic states without exposing secrets or raw Stripe payloads.
- [ ] Automated verification is complete. Backend billing/webhook/reconciliation tests, Worker configuration tests, frontend Billing page tests, Application admin billing tests, backend typecheck, and frontend production build must all pass before production deployment.
- [ ] Manual Stripe test-mode verification is complete or explicitly blocked. The operator must run the final test-mode pass with the exact event allowlist using Stripe CLI or Dashboard flows, including duplicate replay, delayed payment success/failure, failed renewal, payment recovery, subscription start/upgrade/downgrade/cancel/reversal/deletion, payment-required Plan override, Enterprise annual upfront, Enterprise ramp-up, and Enterprise overage flows.
- [ ] Live smoke testing is explicitly gated. Health checks and non-payment billing reads may run immediately after deploy; any real live payment smoke test must use an operator-approved low-risk path and must happen only after Stripe account readiness, live prices, live webhook delivery, and rollback path are confirmed.
- [ ] Manual business operations for out-of-scope billing events are accepted. Refunds, disputes, chargebacks, fraud reviews, accounting exports, revenue recognition, and tax registrations can remain outside this implementation only if the operator documents the Stripe Dashboard/manual support path before launch.

## User Stories

1. As a Workspace owner, I want live billing deployment to use production Stripe secrets, so that real payments are separated from Stripe test mode.
2. As a Workspace owner, I want a paid Plan downgrade invoice to activate the lower paid plan for the new Billing period, so that my Workspace does not fall back to Free after paying.
3. As a Workspace owner, I want Purchased Credits preserved across Plan downgrades, so that prepaid usage is not lost.
4. As a Workspace owner, I want Included Credits granted exactly once after a paid Plan downgrade invoice, so that the lower plan allowance is available without duplication.
5. As a Workspace owner, I want Subscription cancellation to be reflected after Stripe ends the subscription, so that the Billing page does not show stale paid subscription state.
6. As a Workspace owner, I want cancel-at-period-end reversal to be reflected if it happens in Stripe, so that my Workspace does not incorrectly downgrade.
7. As a Workspace owner, I want externally canceled Stripe subscriptions to stop paid entitlement, so that product access matches payment state.
8. As a Workspace owner, I want Stripe-side subscription deletion to fall back to the correct Workspace billing entitlement, so that access is deterministic.
9. As a Workspace owner, I want invoice payment authentication requirements to be visible, so that I know when I must complete payment action.
10. As a Workspace owner, I want invoice finalization failures to be visible, so that tax or billing address problems can be fixed.
11. As a Workspace owner, I want hosted invoice or payment URLs retained when Stripe provides them, so that I can complete payment from the Billing page.
12. As a Workspace owner, I want delayed Credit pack payment success to grant Purchased Credits, so that delayed payment methods work if enabled.
13. As a Workspace owner, I want delayed Credit pack payment failure not to grant Credits, so that unpaid purchases do not increase balance.
14. As a Workspace owner, I want failed delayed payments to appear as failed billing activity where appropriate, so that I can retry intentionally.
15. As a Workspace owner, I want failed renewal invoices to keep the Workspace in Unpaid billing state, so that new paid usage is blocked until payment succeeds.
16. As a Workspace owner, I want recovered renewal payments to restore paid entitlement and Included Credits exactly once, so that Smart Retry recovery works.
17. As a Workspace owner, I want payment-required Plan override invoices to handle customer-action and finalization-failure states, so that temporary access does not activate before payment.
18. As a Workspace owner, I want Enterprise annual upfront invoices to handle customer-action and finalization-failure states, so that Enterprise entitlement remains payment-gated.
19. As a Workspace owner, I want Enterprise ramp-up and overage invoice failures to suspend or keep suspended Enterprise entitlement, so that overdue Enterprise usage is not free.
20. As an Application admin, I want subscription lifecycle drift recorded when Stripe state cannot be safely applied, so that I can review and repair ambiguous billing state.
21. As an Application admin, I want failed Stripe billing events recorded with non-secret diagnostic detail, so that I can understand production webhook issues.
22. As an Application admin, I want ignored Stripe events distinguished from processed events, so that future code changes can safely add support for new event types.
23. As an Application admin, I want incomplete Stripe metadata detected and surfaced, so that Stripe Dashboard misconfiguration is caught quickly.
24. As an Application admin, I want Billing reconciliation to detect missed delayed-payment or subscription lifecycle outcomes, so that webhook outages do not permanently hide drift.
25. As an Application admin, I want Billing reconciliation to remain non-destructive, so that it records drift instead of rewriting the Billing ledger unsafely.
26. As a backend maintainer, I want Stripe webhook event coverage to match the active Workspace billing flows, so that the webhook subscription can be narrowly scoped and complete.
27. As a backend maintainer, I want Plan downgrade invoice handling to reuse the same deep subscription invoice module as start, upgrade, and renewal invoices, so that payment-gated entitlement activation stays consistent.
28. As a backend maintainer, I want webhook persistence to store durable processing states, so that duplicate Stripe delivery, failed processing, ignored events, and manual replay are understandable.
29. As a backend maintainer, I want webhook failures to return non-2xx when retry is appropriate, so that Stripe can retry transient or fixable failures.
30. As a backend maintainer, I want irrelevant Stripe events to return 2xx without changing Workspace billing state, so that the endpoint is robust when Stripe sends harmless events.
31. As a backend maintainer, I want unknown future Stripe events not to be marked as successfully processed business events, so that adding support later is not blocked by old dedupe rows.
32. As a backend maintainer, I want all Stripe API calls to keep using idempotency keys, so that retries do not create duplicate customers, invoices, sessions, or subscription changes.
33. As a backend maintainer, I want all Stripe API requests to avoid hardcoded payment method types, so that dynamic payment methods remain enabled.
34. As a backend maintainer, I want the Stripe restricted API key permissions documented, so that the live key can be least-privilege.
35. As a backend maintainer, I want live Stripe Price IDs confirmed separately from Stripe test mode IDs, so that production Checkout points at live Prices.
36. As a backend maintainer, I want Worker required secrets declared where practical, so that deploy fails before traffic if production secrets are missing.
37. As a backend maintainer, I want production deploy to pass the production secrets file, so that operators do not need a separate manual secret upload step for ordinary deploys.
38. As a backend maintainer, I want the secrets file path documented without secret values, so that future deploys are repeatable.
39. As a backend maintainer, I want local development to keep using development Stripe secrets, so that test work cannot mutate live Stripe data.
40. As a backend maintainer, I want the webhook endpoint URL and subscribed event list documented for live mode, so that Stripe Dashboard setup is exact.
41. As a backend maintainer, I want a final Stripe test-mode verification checklist, so that production launch is gated by real Stripe behavior where possible.
42. As a backend maintainer, I want automated tests for every supported Stripe event type, so that future billing changes do not regress lifecycle coverage.
43. As a backend maintainer, I want frontend Billing page tests for new invoice/payment states, so that owner-facing messaging stays actionable.
44. As a backend maintainer, I want Application admin billing view tests for reconciliation drift and failed event diagnostics, so that support can diagnose production issues.
45. As a product operator, I want a clear go-live checklist, so that live billing launch has known prerequisites and rollback considerations.
46. As a product operator, I want no raw Stripe webhook payload archives committed, so that billing data and customer details stay out of source control.
47. As a product operator, I want no Stripe API keys, webhook secrets, or production secrets committed, so that secret exposure risk is minimized.
48. As a product operator, I want Cloudflare deploy output not to print secret values, so that logs remain safe to share.
49. As a product operator, I want a complete production launch blocker checklist, so that live billing cannot be enabled until Stripe, Worker, webhook, reconciliation, observability, and rollback prerequisites are closed.
50. As a product operator, I want the production Cron Trigger for scheduled billing work verified, so that reconciliation and Enterprise invoice generation do not silently fail to run after deploy.
51. As a backend maintainer, I want webhook signature verification to enforce timestamp tolerance and support signing-secret rotation, so that replay attacks and routine secret rolls are handled safely.
52. As a backend maintainer, I want the live webhook endpoint event API version pinned or verified, so that webhook payload shape does not drift from the fields consumed by the Worker.
53. As a backend maintainer, I want invoice voided and marked-uncollectible events handled or reconciled, so that terminal unpaid invoices do not leave stale owner-facing billing state.
54. As a backend maintainer, I want scheduled billing jobs to isolate per-Workspace failures, so that one broken Workspace does not prevent all billing reconciliation or Enterprise invoice generation.
55. As a backend maintainer, I want Cloudflare required secrets declared in Worker configuration where supported, so that deploy fails before traffic when a required production secret is absent.
56. As a backend maintainer, I want structured, non-secret billing observability, so that live webhook failures can be diagnosed without exposing customer/payment data.

## Implementation Decisions

- Modify the Stripe billing event processing module to explicitly route all supported event types through named handlers. Supported live event types should include Checkout completion, delayed Checkout success/failure, invoice finalized, invoice paid, invoice payment succeeded, invoice payment failed, invoice payment action required, invoice finalization failed, subscription updated, subscription deleted, and any subscription pause/resume events that can affect Workspace billing state.
- Treat `invoice.voided` and `invoice.marked_uncollectible` as supported negative/terminal invoice events for known Workspace billing invoices. They should update visible invoice state or record drift without granting Credits or paid entitlement.
- Treat `customer.subscription.created` as a dashboard-side drift signal unless it can be confidently mapped to an app-owned Workspace billing flow. Do not grant entitlement from a dashboard-created subscription unless a paid invoice handler validates the Workspace metadata and plan/period.
- Expand the subscription invoice classifier so Plan downgrade invoices are handled alongside subscription start, Plan upgrade, and renewal invoices. The classifier should return a typed billing action instead of comparing string literals in multiple places.
- Extract or deepen a subscription invoice application module that accepts a paid Stripe invoice, resolves Workspace, Plan, Billing period, subscription item, customer, hosted invoice URL, and Included Credit grant, then updates Workspace billing control data and the Billing ledger through a narrow interface.
- Add a negative invoice state module that applies non-granting invoice outcomes such as payment failed, payment action required, and finalization failed. It should update invoice status and owner/admin visibility without granting Credits or paid entitlement.
- Add a subscription lifecycle module for Stripe subscription updated/deleted events. It should apply safe app-owned transitions and record Billing reconciliation drift for ambiguous or dashboard-side changes that cannot be safely mapped.
- Extend delayed Checkout handling for Credit pack purchases. Delayed success should share idempotency behavior with paid Checkout and paid invoice processing. Delayed failure should record failed payment state without granting Purchased Credits.
- Change Stripe billing event persistence so the system can distinguish processed, ignored, and failed outcomes. If the existing schema is too narrow, add a compatible migration and keep old processed rows valid.
- Record failed Stripe billing event diagnostics without storing raw Stripe payloads, secrets, payment method details, or sensitive customer data.
- Preserve Stripe signature verification and raw request body handling for every webhook event. Signature verification should enforce a timestamp tolerance, use constant-time comparison, ignore non-`v1` signature schemes, and have an operator-documented rotation process for the temporary two-secret window during Stripe endpoint secret rolls.
- Keep Stripe event handling idempotent. Duplicate deliveries must not duplicate Included Credits, Purchased Credits, invoice state changes, or Application admin billing audit entries.
- Make webhook handling order-independent. A paid invoice arriving before a subscription update, a subscription deletion arriving before an invoice terminal event, or a delayed Checkout success arriving after reconciliation should still converge through idempotent handlers and/or drift records.
- Decide and document the webhook execution model before implementation is marked complete: bounded synchronous processing that returns retryable non-2xx on fixable failures, or a Queue-backed background model with durable minimal event metadata and independent retry/diagnostic semantics.
- Keep Billing reconciliation as a non-destructive scheduled check. It may repair clearly paid missing objects only through existing idempotent grant/activation paths and should record manual-review drift for ambiguous subscription lifecycle mismatches.
- Configure and verify a production Cron Trigger for the `scheduled()` handler so Billing reconciliation and Enterprise invoice generation run outside tests. If this remains Dashboard-managed rather than checked into `wrangler.jsonc`, the operator runbook must include an explicit verification step.
- Isolate scheduled billing failures by Workspace and by task. Enterprise ramp-up invoice generation, Enterprise annual overage generation, and Billing reconciliation should leave observable failure records without preventing unrelated Workspaces from being processed.
- Declare required Worker secrets where practical using Wrangler's `secrets.required` configuration. At minimum, production billing depends on the Stripe restricted API key and Stripe webhook signing secret. Existing authentication, AI Gateway, and optional Google OAuth secrets should remain part of production deploy validation.
- Keep production secrets in the operator-managed secrets file or Cloudflare Worker secrets. Development secrets stay in the local development secrets file.
- Align deploy documentation and scripts so there is one production secret-loading path. If `wrangler deploy --secrets-file ../.vars` remains the deployment mechanism, document the repo-root `.vars` path, required key names, file format, and gitignore expectation without showing values.
- Update operational documentation with the live webhook destination, required subscribed event types, production secrets file deploy behavior, live/test Stripe resource separation, and restricted API key permission guidance.
- Document the minimum Stripe restricted API key permissions needed by current billing code: Customers create/read/update, Checkout Sessions create/list/read as needed, Subscriptions read/update/delete or cancel, Invoices create/read/list/finalize, Invoice Items create, and any additional read scopes required for Billing reconciliation. Validate the permission set in test mode with Stripe request logs before creating the equivalent live key.
- Confirm whether Stripe API-key IP restrictions can be safely used with the Cloudflare Worker deployment. If not, document the exception and compensating controls.
- Ensure the live Stripe webhook endpoint uses the same event payload shape the code was tested against. If the account default event API version differs from the code's pinned outbound request version, the live endpoint should be pinned or test evidence should show compatibility.
- Keep the webhook endpoint scoped to account events for this app. Do not configure Connect webhooks unless the product adds Stripe Connect.
- Keep Worker configuration production-current: validate against the local Wrangler schema, review `compatibility_date` at launch, regenerate Worker types after binding/secret changes, keep `nodejs_compat`, and keep logs/observability enabled with an intentional sampling setting.
- Add structured non-secret billing logs for webhook receipt, processing outcome, failed event diagnostics, scheduled reconciliation runs, and Stripe API failure classes. Logs must not include raw payloads, secret values, card/payment method details, or unnecessary customer PII.
- Add a launch rollback/pause runbook. It should cover stopping new Checkout creation, disabling or narrowing the Stripe live webhook endpoint, rolling back the Worker version, rotating compromised keys/secrets, and running reconciliation after service recovery.
- Do not change Workspace billing product semantics, plan prices, Credit pack sizes, Enterprise pricing rules, Billing ledger authority, or owner/Application admin roles as part of this production-readiness work.

## Testing Decisions

- Tests should assert externally visible behavior through Worker routes, scheduled handlers, Billing ledger summaries, Owner billing activity, Application admin billing state, and frontend user-visible states. Avoid tests that only assert internal helper calls.
- Add backend webhook tests for Plan downgrade paid invoices. They should prove the lower paid plan activates for the new Billing period, Included Credits are granted once, Purchased Credits are preserved, and duplicate delivery is idempotent.
- Add backend webhook tests for subscription updated/deleted events. Safe cases should update billing state. Ambiguous cases should record Billing reconciliation drift without granting entitlement.
- Add backend webhook tests for invoice payment action required and invoice finalization failed. They should prove invoice status and hosted URLs are persisted and no Credits are granted.
- Add backend webhook tests for invoice voided and marked-uncollectible states for known Workspace billing invoices. They should prove terminal unpaid state is visible or drift is recorded and no Credits are granted.
- Add backend webhook tests for delayed Checkout success and failure for Credit packs. Success should grant Purchased Credits once. Failure should not grant Credits.
- Add backend tests for ignored and failed Stripe billing event persistence. Unknown events should not mutate Workspace billing state. Failed relevant events should leave durable, non-secret diagnostics and allow Stripe retry behavior.
- Add backend tests for webhook signature timestamp tolerance, invalid signatures, malformed signature headers, ignored non-`v1` signature schemes, and signing-secret rotation behavior or the documented rotation fallback.
- Add backend tests for duplicate deliveries, distinct duplicate business-object events, delayed delivery, out-of-order delivery, and manual replay.
- Add Billing reconciliation tests for missed paid Plan downgrade invoices, ambiguous Stripe subscription changes, and missed delayed Checkout payment outcomes.
- Add Billing reconciliation tests for missed subscription lifecycle events, invoice voided/marked-uncollectible states, and failed webhook events that later become repairable.
- Add Worker configuration tests for required secrets, Cron Trigger configuration or runbook documentation, current compatibility-date review, observability, and documentation. They should verify secret names are documented without secret values.
- Add package/deploy script tests or configuration checks if the repo already has a Worker configuration test pattern that can assert the production deploy command includes the production secrets file.
- Add frontend Billing page tests for owner-visible payment action required, invoice finalization failure, delayed payment failure, and post-downgrade paid entitlement states.
- Add Application admin billing view tests for failed Stripe billing event diagnostics and subscription lifecycle drift records.
- Add Application admin billing view tests for scheduled reconciliation status, open drift records, failed-event diagnostics, and terminal unpaid invoice states.
- Run the existing focused billing test suite, backend typecheck, frontend billing/admin tests, and frontend production build before marking the PRD complete.
- Run a Stripe test-mode manual verification pass with Stripe CLI forwarding or a test webhook endpoint. Use the exact intended event allowlist, and cover Credit pack payment, delayed payment if enabled, subscription start, Plan upgrade, Plan downgrade, Subscription cancellation, cancel-at-period-end reversal, subscription deletion, subscription pause/resume where applicable, failed renewal, payment recovery, payment-required Plan override, Enterprise annual upfront, Enterprise overage, and Enterprise ramp-up invoice flows.
- Run a production-deploy dry run or equivalent preflight that validates remote D1 migrations, Durable Object migrations, required secrets, live Stripe Price IDs, webhook endpoint setup, Cron Trigger setup, custom domain health, and frontend asset build without printing secrets.
- If a Stripe test-mode manual flow cannot be run, record the exact missing prerequisite and rely on automated request/webhook behavior tests for that flow until the prerequisite is available.

## Out of Scope

- Changing Free, Pro, Max, Enterprise ramp-up, or Enterprise annual pricing.
- Adding new billing plans, new currencies, coupons, trials, refunds, discounts, promotions, or Stripe Customer Portal features.
- Adding Stripe Connect.
- Changing the Billing ledger Durable Object authority model.
- Reworking Workspace product data storage or extraction job lifecycle.
- Changing who has Workspace billing authority.
- Launching live billing, creating live Stripe Dashboard resources, or entering production secrets into chat or source control.
- Handling disputes, chargebacks, fraud workflows, revenue recognition, accounting exports, or tax registration setup beyond surfacing invoice/tax finalization failures needed for product correctness.

## Reference Basis

- [Stripe go-live guidance](https://docs.stripe.com/get-started/checklist/go-live) requires live/test separation, production webhooks, duplicate/delayed/out-of-order webhook handling, API version review, secure keys, and non-sensitive logging.
- [Stripe webhook guidance](https://docs.stripe.com/webhooks) requires HTTPS live endpoints, raw-body signature verification, event-type allowlisting, duplicate-event handling, replay-timestamp tolerance, and awareness that Stripe retries failed live event deliveries for up to three days.
- [Stripe subscription webhook guidance](https://docs.stripe.com/billing/subscriptions/webhooks) calls out `invoice.payment_action_required`, `invoice.payment_failed`, `invoice.finalization_failed`, and the risk that invoice finalization failures can leave subscriptions active while payment cannot be collected.
- [Stripe Checkout fulfillment guidance](https://docs.stripe.com/checkout/fulfillment) requires asynchronous delayed-payment events such as `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed` when delayed payment methods are enabled.
- [Stripe key guidance](https://docs.stripe.com/keys) recommends restricted API keys, live/sandbox separation, secure server-side storage, rotation, and optional IP restrictions where infrastructure supports them.
- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) recommend current `compatibility_date`, `nodejs_compat`, generated `wrangler types`, secrets outside source, deliberate environment configuration, observability before production, and Queues/Workflows for retryable background work.
- [Cloudflare Workers secrets guidance](https://developers.cloudflare.com/workers/configuration/secrets/) supports `secrets.required` for deploy validation and `wrangler deploy --secrets-file` for uploading secrets alongside code without committing values.
- [Cloudflare Cron Trigger guidance](https://developers.cloudflare.com/workers/configuration/cron-triggers/) requires an actual Cron Trigger configuration or Dashboard setup for a Worker's `scheduled()` handler to run in production.

## Further Notes

- The production webhook destination remains the live Worker URL for the Stripe billing webhook path.
- The current deployment command should pass the production secrets file, but operators should still confirm the file exists, is dotenv-formatted, contains live values, and remains ignored by git before running a production deploy.
- Stripe Dashboard live mode should subscribe only to the event types supported by this production-readiness work.
- Stripe test mode and live mode resources must remain separate. Test mode webhook signing secrets and API keys must not be reused for live mode.
- A live launch should include a final operator checklist covering Cloudflare secrets, D1 remote migrations, Durable Object migrations, production Cron Trigger setup, frontend build, Worker deploy, Stripe webhook endpoint, Stripe restricted API key permissions, live Price IDs, a smoke test of the health endpoint, and a billing smoke test using a low-risk live payment path only when the business is ready.
