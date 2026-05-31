# Enterprise Annual Commitment And Overage

Category: enhancement
Type: AFK
Status: ready-for-agent

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Add Enterprise annual commitments and monthly overage billing. Application admins should be able to create annual deal terms using standard defaults or custom monthly allowance/per-page price. The yearly cost is derived automatically. Enterprise annual entitlement activates only after the upfront invoice is paid. Monthly overage invoices are generated from Billing ledger usage above the monthly minimum allowance.

## Acceptance criteria

- [ ] Application admins can create Enterprise annual commitments with monthly minimum allowance, per-page price, billing cycle start date, collection method, and reason.
- [ ] Standard defaults are available: 60,000/month at £0.09 and £64,800/year; 100,000/month at £0.08 and £96,000/year; 200,000/month at £0.07 and £168,000/year.
- [ ] Application admins can enter custom monthly allowance and per-page price.
- [ ] Yearly cost is derived automatically from monthly allowance times 12 times per-page price.
- [ ] Annual commitment upfront invoice is visible and payable by the Workspace owner.
- [ ] Annual entitlement activates only after the upfront invoice is paid.
- [ ] Application admins cannot manually activate unpaid Enterprise annual commitments; no-cost access uses No-billing mode.
- [ ] Enterprise annual usage up to the monthly minimum allowance has no additional monthly charge.
- [ ] Unused monthly minimum allowance does not roll over.
- [ ] Enterprise overage above the monthly minimum allowance is invoiced monthly in arrears at the commitment per-page price.
- [ ] Overage invoices are generated automatically after each monthly invoice period closes from Billing ledger usage.
- [ ] Overage invoices finalize automatically unless Enterprise invoice review mode is enabled.
- [ ] Overdue overage invoices suspend Enterprise entitlement until paid.
- [ ] Enterprise annual commitments can start after ramp-up or without ramp-up.
- [ ] Active Enterprise entitlement supersedes self-service subscription entitlement without double billing.
- [ ] Tests cover default/custom terms, derived yearly cost, upfront invoice activation, allowance/no-rollover behavior, overage calculation, invoice generation, overdue suspension, and fallback.
- [ ] `npm run typecheck --prefix backend` and `npm run build --prefix frontend` pass.

## Blocked by

- .scratch/workspace-billing/issues/12-enterprise-ramp-up-billing.md

