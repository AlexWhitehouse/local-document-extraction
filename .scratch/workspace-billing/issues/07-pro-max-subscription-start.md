# Pro/Max Subscription Start

Category: enhancement
Type: AFK
Status: ready-for-agent

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Add owner-initiated self-service subscription starts for Pro and Max through Stripe Checkout. A Free Workspace owner should be able to start Pro or Max, pay the first subscription invoice, and have paid entitlements and Included Credits activate only from successful Stripe payment/subscription events. Billing periods should follow Stripe's subscription billing cycle after subscription starts.

## Acceptance criteria

- [ ] Pro and Max subscription starts can be initiated only by the Workspace owner.
- [ ] Workspace API keys cannot start subscriptions.
- [ ] Subscription Checkout uses configured recurring Stripe Price IDs, Stripe Customer mapping, Workspace metadata, automatic tax where supported, and no hardcoded `payment_method_types`.
- [ ] Free -> Pro activates Pro entitlement only after the first subscription invoice is paid.
- [ ] Free -> Max activates Max entitlement only after the first subscription invoice is paid.
- [ ] Free -> Pro grants 200 Included Credits for the current Billing period after payment.
- [ ] Free -> Max grants 1,000 Included Credits for the current Billing period after payment.
- [ ] Paid non-enterprise Billing periods follow the Stripe subscription billing cycle after subscription start.
- [ ] Included Credits expire at the end of the Billing period that granted them.
- [ ] Subscription-related Stripe events are processed idempotently.
- [ ] Owner Billing page shows active Pro/Max entitlement, Included Credit renewal, current-period usage/capacity, and subscription status after payment.
- [ ] Tests cover Checkout start authorization, Stripe request shape, invoice-paid entitlement activation, Included Credit grant idempotency, Billing period anchor update, and owner UI state.
- [ ] `npm run typecheck --prefix backend` and `npm run build --prefix frontend` pass.

## Blocked by

- .scratch/workspace-billing/issues/05-stripe-dashboard-test-mode-catalog-setup.md
- .scratch/workspace-billing/issues/06-stripe-credit-pack-purchases.md

