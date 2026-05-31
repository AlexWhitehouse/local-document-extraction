# Subscription Changes, Cancellation, And Unpaid State

Category: enhancement
Type: AFK
Status: ready-for-agent

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Implement app-owned Pro/Max subscription changes, subscription cancellation, unpaid subscription behavior, and API access suspension. Upgrades should create a prorated payment path and activate only after successful payment. Downgrades and cancellation should schedule the next-period entitlement. Failed renewal payments should move the Workspace into Unpaid billing state and operate under Free limits until payment succeeds.

## Acceptance criteria

- [ ] Self-service plan changes are initiated through the application, not unrestricted Customer Portal switching.
- [ ] Pro -> Max creates a prorated upgrade invoice or equivalent payment path for the remaining Billing period.
- [ ] Max entitlements from Pro -> Max activate only after successful payment.
- [ ] Mid-period upgrades grant only additional Included Credits needed to reach the new plan allowance.
- [ ] Existing current-period page usage carries forward after upgrade and is evaluated against the new Plan page limit.
- [ ] A Workspace blocked at its current Plan page limit can complete an upgrade and continue after payment.
- [ ] Max -> Pro and paid -> Free downgrades take effect at the next Billing period.
- [ ] Subscription cancellation schedules a downgrade to Free at the next Billing period.
- [ ] Cancellation does not refund unused paid time or unused Included Credits.
- [ ] After a paid subscription ends, future Free Billing periods keep the latest Stripe Billing period anchor.
- [ ] Renewal payment failure creates or preserves Unpaid billing state without granting new Included Credits.
- [ ] Unpaid Workspaces operate under Free limits for new actions until payment succeeds.
- [ ] Buying Credit packs while unpaid is allowed but does not restore paid subscription entitlement.
- [ ] API access entitlement is inactive in Unpaid billing state.
- [ ] Existing Workspace API keys are preserved but product API requests using them are rejected with entitlement errors until entitlement returns.
- [ ] Tests cover upgrade, downgrade, cancellation, unpaid invoice events, Included Credit grants, scheduled entitlement changes, API access suspension, and owner Billing page state.
- [ ] `npm run typecheck --prefix backend` and `npm run build --prefix frontend` pass.

## Blocked by

- .scratch/workspace-billing/issues/07-pro-max-subscription-start.md

