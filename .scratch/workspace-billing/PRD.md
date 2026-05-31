# PRD: Workspace Billing

Status: ready-for-agent

## Problem Statement

Document Extraction currently has Workspaces, Templates, Workspace memberships, Workspace API keys, Source file page counts, and durable Extraction job lifecycle rules, but it does not have a billing system. From the user's perspective, the product cannot safely charge for document extraction, enforce commercial plan limits, sell prepaid usage, or support Enterprise deals.

The product needs billing to be Workspace-scoped, owner-managed, Stripe-backed, and scalable. Billing must support prepaid Credits for non-enterprise plans, monthly plan entitlements, hard monthly page limits, plan/resource overage blocking, owner-only self-service billing, Application admin commercial controls, and invoice-based Enterprise billing. The system also needs accurate accounting under concurrent uploads: no Extraction job should be accepted unless the Workspace has the required billing entitlement and the billing authority has recorded the required usage.

The change must respect the existing domain split: **Workspace control data** remains in global D1, **Workspace product data** remains in per-Workspace Durable Objects, and billing needs its own authoritative **Billing ledger** that can make atomic per-Workspace credit/page reservations before product work is accepted.

## Solution

Add Workspace billing as a first-class backend and frontend capability.

Each **Workspace** becomes the billing customer. The current **Workspace** owner has **Workspace billing authority** and is the only normal user who can view the owner-facing **Billing page**, start Stripe Checkout flows, manage subscriptions, view invoices, buy Credit packs, or open Stripe Customer Portal. Workspace admins and members may see limited **Billing operational status** when billing state blocks product actions, but they do not see invoices, payment methods, exact prices paid, or billing controls.

Use Stripe for payment collection, invoices, subscriptions, tax calculation, hosted Checkout, hosted invoice payment pages, and Customer Portal. Stripe is integrated with restricted API keys, signed webhooks, dynamic payment methods, automatic tax, test-mode/live-mode separation, and idempotent webhook processing. The application owns product entitlement rules and activates paid entitlements only after successful payment events.

Non-enterprise Workspaces use prepaid **Credits**. One Credit allows one **Billable Document page** to be submitted. PDFs spend one Credit per detected **Source file page count** page. Images spend one Credit as one Billable Document page. Credits are spent when a Document submission is accepted and an **Extraction job** is queued. Included monthly Credits expire at the end of their **Billing period**. Purchased Credits carry forward until spent. Usage spends Included Credits before Purchased Credits.

Free, Pro, and Max are code-owned plan definitions:

| Plan | Monthly price | Included Credits | Template limit | Top-level Template field limit | Table-shaped field limit | Member limit | Per-page price | Monthly page limit | API access |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |
| Free | £0 | 0 | 3 | 5 | 1 table-shaped field, max 5 columns | 3 | £0.22 | 500 | No |
| Pro | £50 | 200 | 10 | 15 | 1 table-shaped field, max 10 columns | 50 | £0.20 | 1,500 | Yes |
| Max | £200 | 1,000 | 50 | 20 | 1 table-shaped field, max 15 columns | Unlimited | £0.18 | 5,000 | Yes |

All prices are GBP-only and tax-exclusive at launch. Stripe calculates VAT or other applicable taxes.

The **Plan page limit** is a hard monthly cap for non-enterprise plans, even when the Workspace has enough Credits. Free includes no monthly Credits; Free Workspaces must buy Purchased Credits before extraction, but Purchased Credits do not grant API access or paid plan limits. All non-enterprise plans may buy fixed Credit packs of 100, 500, 1,000, and 5,000 Credits. Credit packs use pre-created Stripe one-time Prices for every plan/pack combination and are granted only after successful Stripe payment events.

Paid subscription entitlements are payment-gated. Free -> Pro/Max and Pro -> Max activate only after successful payment. Upgrades are effective in the current Billing period after payment, grant only the additional Included Credits needed to reach the new plan allowance, and evaluate existing current-period page usage against the new Plan page limit. Downgrades and subscription cancellation take effect at the next Billing period, preserve Purchased Credits, and do not refund unused paid time or unused Included Credits.

If a paid subscription invoice is unpaid, the Workspace enters **Unpaid billing state**. It receives no new Included Credits and operates under Free plan limits for new actions until payment succeeds. Existing product data, memberships, and API keys are preserved, but paid API access is unavailable while unpaid. Buying Credit packs while unpaid is allowed, but does not restore paid subscription entitlements.

Plan/resource overage is preserved but blocks new work. Existing Templates, Template fields, Workspace memberships, and API keys are not deleted when a Workspace downgrades or becomes unpaid. However, any Plan limit overage blocks new Extraction jobs. Too many Templates blocks all new jobs and new Template creation. Too many accepted Workspace memberships blocks all new jobs and new invitations. A Template with too many top-level fields or too many table columns blocks new jobs for that Template and cannot be saved unless the save brings it within the current plan limit or billing is restored.

Add a separate per-Workspace Durable Object as the authoritative append-only **Billing ledger**, per ADR 0003. The billing DO records credit grants, purchases, reservations, refunds, revocations, Enterprise usage charges, no-billing usage entries, and rebuildable balance/usage summaries. D1 stores billing control data: Stripe customer/subscription/invoice references, processed Stripe event records, active entitlement summaries, scheduled changes, Plan overrides, No-billing state, Enterprise deal metadata, searchable admin summaries, and minimal retained billing records.

Document submission generates the Extraction job ID, reads Source file bytes, determines exact Billable Document page count, checks billing entitlement/capacity, records a Credit reservation, Enterprise usage charge, or No-billing usage entry, then stores the Source file and creates/queues the Extraction job. If billing rejects the submission, the Source file is not stored. If billing succeeds but Source file storage, job creation, or queueing fails, record a compensating Credit refund or equivalent ledger correction. Deleting Extraction jobs or Workspaces does not refund Credits or charges.

Application admins get an **Application admin billing view**. They can set time-bounded Plan overrides for Free/Pro/Max, choose whether payment is required, put Workspaces into No-billing mode, assign Enterprise deal terms, grant or revoke unspent Credits, inspect billing state, and manage invoice-related exceptions. Admin billing actions write an **Application admin billing audit log** with actor, timestamp, reason, before/after values, and affected Workspace.

No-billing mode is separate from Enterprise. It gives the Enterprise limit profile at no cost: unlimited Templates, unlimited accepted Workspace memberships, 25 top-level Template fields per Template, one table-shaped Template field with up to 20 columns, no Credits, no invoices, no usage charges, and no Plan page limit. No-billing mode still records No-billing usage entries in the Billing ledger.

Enterprise is manually assigned by Application admins and is not a public self-service plan. Enterprise uses the Enterprise limit profile and does not use prepaid Credits. Enterprise usage is invoice-based.

Enterprise ramp-up is optional. Application admins set ramp-up duration in months, defaulting to 3 months, and choose an Enterprise billing cycle start date so ramp-up periods align with invoice periods. Ramp-up usage is billed monthly in arrears from the Billing ledger using tiered monthly usage bands:

| Monthly page slice | Per-page price |
| --- | ---: |
| 0-10,000 | £0.14 |
| 10,001-20,000 | £0.13 |
| 20,001-40,000 | £0.12 |
| 40,001-60,000 | £0.11 |
| 60,001+ | £0.10 |

Enterprise annual commitments are paid upfront for one year. Each commitment has a monthly minimum allowance and an overage per-page price. Unused monthly minimum allowance does not roll over. Overage above the monthly minimum is invoiced monthly in arrears. Application admins can use standard annual tier defaults or enter custom allowance/per-page price values. Yearly cost is derived automatically from monthly minimum allowance times 12 times per-page price.

Standard annual tier defaults are:

| Monthly minimum allowance | Per-page price | Yearly cost |
| ---: | ---: | ---: |
| 60,000 | £0.09 | £64,800 |
| 100,000 | £0.08 | £96,000 |
| 200,000 | £0.07 | £168,000 |

Enterprise invoices are visible and payable by the Workspace owner. Automatic invoice collection is the default after a default payment method exists; Application admins can set manual invoice collection for Workspaces that require manual payment. Enterprise ramp-up and overage invoices are generated automatically after each monthly invoice period closes from the Billing ledger. They finalize automatically unless Enterprise invoice review mode is enabled.

Enterprise entitlement activates only after its required upfront invoice is paid. Ramp-up and overage invoices are billed in arrears, but overdue invoices suspend Enterprise entitlement until paid. Suspended or expired Enterprise entitlement falls back to active self-service subscription entitlement if one exists, otherwise Free plan.

Workspace deletion ends future self-service subscription billing, deactivates billing entitlements, and hard-erases Workspace product data and Source files. Workspace deletion does not refund Credits, subscription payments, Enterprise invoices, or other billing charges. Deletion is blocked while unpaid billing invoices exist. Workspaces with active Enterprise deal terms require Application admin handling before deletion completes. Minimal billing records needed for financial, audit, and legal purposes are retained after deletion and may reference the deleted Workspace ID and actor user IDs.

## User Stories

1. As a Workspace owner, I want Workspace billing to belong to the Workspace, so that ownership transfer preserves billing history.
2. As a Workspace owner, I want to be the only normal member who can manage billing, so that invoices and payment controls stay private.
3. As a Workspace owner, I want ownership transfer to transfer Workspace billing authority, so that the new owner can manage billing.
4. As a Workspace admin, I want not to see the owner Billing page, so that commercial details are not exposed to me.
5. As a Workspace member, I want to see limited Billing operational status when uploads are blocked, so that I understand why work cannot continue.
6. As a Workspace member, I want Billing operational status not to expose invoices or payment details, so that owner billing privacy is preserved.
7. As a Workspace owner, I want a Billing page, so that I can see plan, Credits, usage, invoices, payment setup, and scheduled changes.
8. As a Workspace owner, I want to see available Credits separately from remaining page capacity, so that I understand which limit is blocking submissions.
9. As a Workspace owner, I want to see current entitlement and next scheduled entitlement change, so that downgrades, cancellations, and override expiry are clear.
10. As a Workspace owner, I want to see Owner billing activity, so that I can understand purchases, grants, spending summaries, refunds, subscription changes, invoices, and payment status.
11. As a Workspace owner, I want Owner billing activity to hide internal admin notes and raw Stripe identifiers, so that the billing page remains customer-facing.
12. As a Workspace owner, I want to buy Credit packs, so that I can submit Documents before or beyond included monthly Credits.
13. As a Workspace owner, I want Credit pack purchases to be deliberate one-off Checkout purchases, so that extra usage is not bought accidentally.
14. As a Workspace owner, I want Credit packs to be available on Free, Pro, and Max, so that every non-enterprise plan can prepay usage.
15. As a Workspace owner, I want Free to include no Included Credits, so that I only pay for extraction when I buy Credits.
16. As a Workspace owner, I want Free Workspaces to be able to use the frontend with Purchased Credits, so that I can try extraction without a subscription.
17. As a Workspace owner, I want Free not to include API access, so that API access remains a paid plan perk.
18. As a Workspace owner, I want Purchased Credits to carry forward until spent, so that top-ups do not expire at the end of the month.
19. As a Workspace owner, I want Included Credits to expire at the end of the Billing period, so that monthly plan economics are predictable.
20. As a Workspace owner, I want Included Credits to be spent before Purchased Credits, so that paid top-ups last as long as possible.
21. As a Workspace owner, I want Credit pack prices to follow my current non-enterprise plan at purchase time, so that I pay the correct per-page price.
22. As a Workspace owner, I want existing Purchased Credits not to be repriced after a plan change, so that previous purchases remain stable.
23. As a Workspace owner, I want a fixed set of Credit pack sizes, so that purchasing is simple.
24. As a Workspace owner, I want pending Checkout Sessions not to count as available Credits, so that my balance only includes paid purchases.
25. As a Workspace owner, I want the Billing page to refresh after Checkout/webhook completion, so that newly paid Credits appear after Stripe confirms payment.
26. As a Workspace owner, I want to start a Pro subscription through Stripe Checkout, so that I can upgrade self-service.
27. As a Workspace owner, I want to start a Max subscription through Stripe Checkout, so that I can unlock higher limits.
28. As a Workspace owner, I want Free -> Pro/Max entitlements to activate only after first invoice payment, so that billing stays payment-gated.
29. As a Workspace owner, I want Free -> Pro to grant 200 Included Credits after payment, so that the Pro allowance is immediately available.
30. As a Workspace owner, I want Free -> Max to grant 1,000 Included Credits after payment, so that the Max allowance is immediately available.
31. As a Workspace owner, I want Pro -> Max upgrades to require prorated payment first, so that Max entitlements are not granted before payment.
32. As a Workspace owner, I want Pro -> Max to grant only the additional Included Credits needed to reach Max allowance, so that included allowances are not double-granted.
33. As a Workspace owner, I want existing period usage to carry forward after upgrade, so that current page usage is evaluated against the new tier limit.
34. As a Workspace owner at the Pro page cap, I want to upgrade to Max and continue after payment, so that I can keep processing in the same Billing period.
35. As a Workspace owner, I want downgrades to take effect at the next Billing period, so that paid entitlements are not removed early.
36. As a Workspace owner, I want subscription cancellation to schedule a downgrade to Free at the next Billing period, so that cancellation preserves already-paid access.
37. As a Workspace owner, I want cancellation not to refund unused paid time or Included Credits, so that billing behavior is clear.
38. As a Workspace owner, I want Purchased Credits preserved after downgrade, so that top-ups are not lost.
39. As a Workspace owner, I want the lower plan page limit to apply after downgrade, so that plan limits remain meaningful.
40. As a Workspace owner, I want failed subscription payment to suspend paid entitlements, so that I understand why paid features stop.
41. As a Workspace owner, I want unpaid Workspaces to receive no new Included Credits, so that no usage is granted without payment.
42. As a Workspace owner, I want to be able to buy Credit packs while unpaid, so that I can continue under Free limits if I choose.
43. As a Workspace owner, I want buying Credit packs while unpaid not to restore paid subscription entitlements, so that subscription debt remains clear.
44. As a Workspace owner, I want paid invoices to activate entitlements, so that payment state and product state match.
45. As a Workspace owner, I want payment method updates to happen through Stripe Customer Portal, so that Stripe handles payment method storage securely.
46. As a Workspace owner, I want billing address and tax identity collected through Stripe-hosted flows, so that I do not enter sensitive billing details into a custom form.
47. As a Workspace owner, I want invoices to use automatic collection when a default payment method exists, so that renewals and overages can be paid automatically.
48. As a Workspace owner, I want manual invoice payment to be possible for Enterprise/manual collection, so that procurement workflows can be supported.
49. As a Workspace owner, I want Stripe Tax to calculate applicable VAT or taxes, so that invoice totals are correct.
50. As a Workspace owner, I want catalog prices shown tax-exclusive, so that base pricing is clear.
51. As a Workspace owner, I want prices to be GBP-only at launch, so that pricing is simple.
52. As a Workspace owner, I want a Stripe Customer tied to the Workspace, so that billing survives owner changes.
53. As a Workspace owner, I want owner transfer to update Stripe billing contact email, so that invoices go to the current owner.
54. As a Workspace owner, I want multiple Stripe payment methods managed inside Stripe, so that the app does not store card details.
55. As a Workspace owner, I want normal Workspace deletion to stop future self-service billing, so that I am not charged after deleting a Workspace.
56. As a Workspace owner, I want Workspace deletion not to refund past charges or Credits, so that deletion is not a refund path.
57. As a Workspace owner, I want Workspace deletion blocked when invoices are unpaid, so that outstanding billing is resolved first.
58. As a Workspace owner, I want a starter Template in new Free Workspaces, so that I can understand the product before buying Credits.
59. As a Workspace owner, I want starter Templates to fit Free limits, so that new Workspaces are usable under default billing.
60. As a Workspace member, I want upload disabled before file selection when the Workspace is already blocked, so that I do not waste time selecting files that cannot be submitted.
61. As a Workspace member, I want backend submission enforcement after exact page count is known, so that large PDFs are charged accurately.
62. As a Workspace member, I want PDF page count failures to reject submission before billing reservation, so that invalid files do not spend Credits.
63. As a Workspace member, I want billing rejection to happen before Source file storage, so that rejected files do not leave stored Source files.
64. As a Workspace member, I want image Documents to count as one Billable Document page, so that image billing is predictable.
65. As a Workspace member, I want PDF Documents to count by detected page count, so that multi-page PDFs are charged fairly.
66. As a Workspace member, I want no hidden per-Document page cap from billing, so that large files are allowed when Credits and plan capacity exist.
67. As a Workspace member, I want product safety limits to remain separate from billing limits, so that abuse/file-size protections still apply.
68. As a Workspace member, I want duplicate uploads to create duplicate jobs and charges, so that retry/duplicate control remains my responsibility.
69. As a Workspace member, I want failed validation not to spend Credits, so that bad requests do not consume balance.
70. As a Workspace member, I want queueing failure before accepted processing to refund Credits and page capacity, so that platform failures do not charge me.
71. As a Workspace member, I want failed Extraction jobs to keep spent Credits unless intentionally refunded, so that normal processing failures have consistent billing.
72. As a Workspace member, I want deleting an Extraction job not to refund Credits, so that data cleanup is separate from billing.
73. As a Workspace member, I want existing Templates preserved after downgrade, so that billing changes do not delete my schemas.
74. As a Workspace member, I want existing members preserved after downgrade, so that billing changes do not remove access.
75. As a Workspace member, I want existing API keys preserved after loss of API entitlement, so that credentials work again if entitlement returns.
76. As an API client developer, I want API key requests rejected with entitlement errors when API access is inactive, so that I can distinguish billing from invalid credentials.
77. As an API client developer, I want API access only on Pro, Max, Enterprise, or No-billing entitlement, so that Free purchased Credits do not enable API use.
78. As an API client developer, I want billing entitlements enforced the same way for API key and session requests, so that API and frontend behavior match.
79. As an API client developer, I want Workspace API keys not to read billing or start Stripe flows, so that API credentials stay product-scoped.
80. As a Workspace owner, I want too many Templates to block new jobs and Template creation, so that my Workspace must fit the active plan.
81. As a Workspace owner, I want too many Workspace memberships to block new jobs and invitations, so that member limits matter.
82. As a Workspace owner, I want too many Template fields to block new jobs for that Template, so that field limits matter.
83. As a Workspace owner, I want table-shaped fields counted as one top-level Template field, so that field limits are understandable.
84. As a Workspace owner, I want table-shaped field columns limited separately, so that nested table complexity is controlled.
85. As a Workspace owner, I want one table-shaped Template field per Template, so that extraction schemas stay bounded.
86. As an Application admin, I want an Application admin billing view, so that I can manage Workspace billing outside owner self-service.
87. As an Application admin, I want to manually assign Free, Pro, or Max for a duration, so that I can handle commercial exceptions.
88. As an Application admin, I want Plan overrides to optionally require payment, so that temporary paid access can be invoiced.
89. As an Application admin, I want no-payment-required Plan overrides to activate immediately, so that support/commercial grants work without Stripe payment.
90. As an Application admin, I want payment-required Plan overrides to create owner-visible Stripe invoices, so that the Workspace owner can pay self-service.
91. As an Application admin, I want Plan override expiry to fall back to active subscription or Free, so that temporary access ends predictably.
92. As an Application admin, I want Plan overrides limited to Free, Pro, and Max, so that Enterprise and No-billing stay separate concepts.
93. As an Application admin, I want No-billing mode, so that selected Workspaces can use Enterprise limits at no cost.
94. As an Application admin, I want No-billing mode to record usage, so that no-cost usage remains visible for analytics and review.
95. As an Application admin, I want to grant Goodwill Credits, so that support and commercial adjustments are possible.
96. As an Application admin, I want to revoke only unspent Purchased or Goodwill Credits, so that historical ledger entries remain intact.
97. As an Application admin, I want Goodwill Credit grants not to rewrite page usage unless explicitly usage-restoring, so that commercial credits do not hide historical usage.
98. As an Application admin, I want billing actions audited with actor, timestamp, reason, before/after, and Workspace, so that billing changes are accountable.
99. As an Application admin, I want to assign Enterprise ramp-up deal terms, so that Enterprise customers can start with usage-based invoicing.
100. As an Application admin, I want Enterprise ramp-up duration specified in months, so that it aligns with invoice periods.
101. As an Application admin, I want to choose the Enterprise billing cycle start date, so that invoicing matches the commercial agreement.
102. As an Application admin, I want Enterprise ramp-up usage bands to be tiered, so that each slice of usage is charged at the right rate.
103. As an Application admin, I want ramp-up invoices generated automatically after period close, so that monthly billing does not depend on manual work.
104. As an Application admin, I want optional Enterprise invoice review mode, so that high-touch customers can have draft invoices reviewed before finalization.
105. As an Application admin, I want overdue ramp-up invoices to suspend Enterprise entitlement, so that arrears do not become free usage.
106. As an Application admin, I want to assign Enterprise annual commitments, so that Enterprise customers can move to yearly contracts.
107. As an Application admin, I want annual commitment defaults, so that standard Enterprise deals are quick to configure.
108. As an Application admin, I want custom Enterprise annual allowance and per-page price, so that negotiated contracts can be represented.
109. As an Application admin, I want yearly Enterprise cost derived from allowance and per-page price, so that annual contract math is internally consistent.
110. As an Application admin, I want Enterprise annual commitment to activate only after upfront invoice payment, so that Enterprise entitlement is payment-gated.
111. As an Application admin, I want Enterprise overage invoiced monthly in arrears, so that usage above minimum allowance is billed.
112. As an Application admin, I want overdue Enterprise overage invoices to suspend Enterprise entitlement, so that unpaid usage is resolved.
113. As an Application admin, I want Enterprise entitlement to have no standard hard monthly page cap, so that Enterprise customers are invoice-metered rather than capped.
114. As an Application admin, I want suspended Enterprise entitlement to fall back to self-service subscription or Free, so that the Workspace has a deterministic active entitlement.
115. As an Application admin, I want active Enterprise entitlement to supersede self-service subscription entitlement, so that customers are not double-billed.
116. As an Application admin, I want No-billing, Plan override, Enterprise, self-service, and Free precedence to be explicit, so that entitlement resolution is predictable.
117. As an Application admin, I want Enterprise invoices visible and payable by the Workspace owner, so that Enterprise billing remains self-service for the customer.
118. As an Application admin, I want Enterprise/custom invoices created from explicit invoice items, so that custom deal terms do not require a Stripe Price for every deal.
119. As an Application admin, I want manual invoice collection available, so that procurement-heavy customers can pay manually.
120. As an Application admin, I want Workspace deletion with active Enterprise deal terms to require admin handling, so that contracted accounts are not removed casually.
121. As a backend maintainer, I want a separate Workspace billing Durable Object, so that credit/page reservations are serialized per Workspace.
122. As a backend maintainer, I want the Billing ledger append-only, so that accounting history is auditable.
123. As a backend maintainer, I want balance and usage summaries rebuildable from the Billing ledger, so that cached summaries are not authority.
124. As a backend maintainer, I want Credit reservations to include Workspace ID, job ID, Template ID/version, page count, submission time, actor/auth mode when available, and idempotency key, so that usage is traceable.
125. As a backend maintainer, I want Enterprise usage charge entries to use the same submission metadata, so that invoice usage is auditable.
126. As a backend maintainer, I want No-billing usage entries to use the same submission metadata, so that no-cost usage is auditable.
127. As a backend maintainer, I want Credit reservations to record quantities rather than monetary amounts, so that prepaid pricing remains tied to purchase/grant events.
128. As a backend maintainer, I want Enterprise usage and invoice entries to record rates and amounts, so that invoice generation is reproducible.
129. As a backend maintainer, I want reservation idempotency keys generated internally from job IDs, so that internal retries do not double-reserve.
130. As a backend maintainer, I want Stripe event processing idempotent, so that duplicate webhook deliveries do not double-grant or double-charge.
131. As a backend maintainer, I want processed Stripe event records in D1, so that global Stripe event IDs are deduplicated before Workspace routing.
132. As a backend maintainer, I want minimal processed Stripe event records, so that raw Stripe payloads are not stored unnecessarily.
133. As a backend maintainer, I want Stripe API writes to use idempotency keys, so that retryable create/update operations are safe.
134. As a backend maintainer, I want Stripe webhooks signature-verified, so that spoofed events are rejected.
135. As a backend maintainer, I want Stripe restricted API keys, so that Stripe integration permissions are least-privilege.
136. As a backend maintainer, I want separate Stripe test and live mode resources, so that development cannot affect production billing.
137. As a backend maintainer, I want Stripe product/price IDs in environment configuration, so that test and live Price IDs can differ.
138. As a backend maintainer, I want the non-enterprise plan catalog code-owned, so that public plans are reviewable and not accidentally edited in admin UI.
139. As a backend maintainer, I want only required Stripe webhook events subscribed, so that webhook processing stays narrow.
140. As a backend maintainer, I want Billing reconciliation, so that missed webhooks and stale billing state are found.
141. As a backend maintainer, I want Billing reconciliation idempotent and non-destructive, so that it does not rewrite ledger history.
142. As a backend maintainer, I want paid Included Credits granted from Stripe payment/subscription events, so that time passing alone never grants paid usage.
143. As a backend maintainer, I want admin no-payment overrides to grant Included Credits at covered Billing period boundaries, so that no-payment entitlements behave like the target plan.
144. As a backend maintainer, I want Free Billing periods anchored to Workspace creation until subscription, so that Free monthly page limits reset predictably.
145. As a backend maintainer, I want paid Billing periods to follow Stripe subscription cycle, so that billing and usage periods align.
146. As a backend maintainer, I want Free fallback after subscription cancellation to keep the latest Stripe Billing period anchor, so that cancellation does not create odd reset jumps.
147. As a backend maintainer, I want billing records retained after Workspace deletion, so that financial/audit/legal records remain available.
148. As a backend maintainer, I want retained billing records to avoid account emails and names beyond Stripe/invoices, so that retained identity data is minimized.
149. As a frontend maintainer, I want a Billing page controller, so that owner billing UI state and actions are isolated from the app root.
150. As a frontend maintainer, I want upload controls to consume advisory entitlement summaries, so that obvious blocked states are shown before upload.
151. As a frontend maintainer, I want final enforcement to remain backend-owned, so that frontend advisory state cannot bypass billing.
152. As an AFK agent, I want billing modules to be deep and testable, so that this large feature can be implemented safely in slices.
153. As an AFK agent, I want decisions captured in CONTEXT and ADRs, so that implementation follows the agreed domain language.

## Implementation Decisions

- Use the existing domain vocabulary from Backend and Frontend contexts: **Workspace billing**, **Workspace billing authority**, **Billing ledger**, **Credit reservation**, **Plan page limit**, **Plan limit overage**, **Active entitlement**, **No-billing mode**, **Enterprise ramp-up**, **Enterprise annual commitment**, and related terms.
- Follow ADR 0003: the authoritative Billing ledger lives in a separate per-Workspace Durable Object. D1 stores control data, summaries, search/index data, processed Stripe event records, and Stripe references.
- Build a deep billing plan catalog module. It owns Free/Pro/Max definitions, Credit pack sizes, non-enterprise prices, included Credit allowances, Template/member/field/table-column limits, API access flags, and monthly page limits.
- Build a deep entitlement resolver module. It accepts Workspace billing control data, current time, subscription state, override state, Enterprise state, No-billing state, and fallback plan state, then returns the single **Active entitlement**, current limits, credit behavior, invoice behavior, scheduled next change, and operational block reasons.
- Active entitlement precedence is No-billing mode, active Plan override, active Enterprise entitlement, active self-service subscription entitlement, then Free plan.
- Plan overrides target only Free, Pro, or Max. Enterprise and No-billing have separate models.
- Build a billing period module. It computes current and next Billing periods from Workspace creation time, Stripe subscription billing cycle anchors, cancellation fallback anchors, and Enterprise billing cycle start dates.
- Build a Workspace billing Durable Object module with a narrow RPC interface for ledger authority. It should expose operations such as reserve prepaid submission, record Enterprise usage, record No-billing usage, refund reservation, grant Included Credits, grant Purchased Credits, grant Goodwill Credits, revoke unspent grants, summarize current balances, summarize current-period usage, and list customer-facing billing activity.
- The Billing ledger is append-only. Do not mutate or delete historical ledger entries. Use compensating entries for refunds, revocations, and corrections.
- Billing balances, Credit balances, current-period usage, and owner billing activity are projections from the ledger, not authority.
- Credit reservation entries include Workspace ID, Extraction job ID, Template ID/version, Billable Document page count, submission time, actor or auth mode when available, and an idempotency key.
- Enterprise usage charge and No-billing usage entries include the same submission metadata as Credit reservation entries.
- Credit reservations record quantities, not monetary amounts. Enterprise usage charge and invoice ledger entries record rates and monetary amounts used for invoice generation.
- Document submission does not accept a client-provided idempotency key. Duplicate user submissions are separate jobs and separate billing events.
- Reservation idempotency keys are generated internally from the generated Extraction job ID to protect internal retries for the same submission attempt.
- Build a billing control store module over D1. It owns Stripe Customer mapping, subscription references, invoice references, processed Stripe event records, active entitlement summaries, scheduled changes, Plan override metadata, No-billing state, Enterprise deal metadata, admin audit logs, and retained billing records.
- Build a Stripe billing gateway module. It wraps Stripe API calls with the latest Stripe API version used by the project, a restricted API key, retry/idempotency behavior, dynamic payment methods, automatic tax, test/live environment configuration, and no raw payment method handling.
- Use Stripe Checkout Sessions for owner-initiated subscription starts and Credit pack purchases.
- Do not hardcode `payment_method_types` in Stripe payment flows. Let Stripe dynamic payment methods choose eligible methods from Dashboard configuration.
- Use Stripe Customer Portal for payment method updates, subscription cancellation, and standard Pro/Max subscription management only where it can express the product rules.
- Self-service plan changes are initiated through the application. Do not expose unrestricted plan switching in Customer Portal.
- Use Stripe-hosted invoice payment pages for Application admin-created payment-required invoices where appropriate.
- Use Stripe Tax automatic tax on supported Checkout Sessions, Subscriptions, and Invoices.
- Store Stripe product and price IDs as environment configuration because test mode and live mode use different Stripe objects.
- Use pre-created monthly recurring Stripe Prices for Pro and Max. Free has no Stripe Price.
- Use pre-created one-time Stripe Prices for each non-enterprise plan and Credit pack size combination.
- Validate that a selected Credit pack Stripe Price matches the Workspace's current non-enterprise plan at purchase time.
- Use explicit Stripe invoice items derived from Enterprise deal terms for Enterprise/custom invoices rather than creating Prices for every custom deal.
- The Stripe Customer is one-to-one with Workspace. It represents the Workspace, not the owner user. Ownership transfer keeps the same Stripe Customer and updates billing contact email to the new owner.
- Stripe owns payment method storage, default payment method selection, and payment method removal. The application stores Stripe identifiers and sanitized summaries, not raw payment method details.
- Use a Stripe restricted API key for backend Stripe API calls. Store Stripe API keys and webhook signing secrets as deployment secrets, not source code or committed configuration.
- Verify Stripe webhook signatures before processing events.
- Subscribe only to required Stripe billing event types. Launch scope includes Checkout completion, invoice payment/failure/voiding, subscription lifecycle changes, and customer updates only when cached billing summaries require them.
- Store minimal processed Stripe billing event records in D1: event ID, type, received time, processed status, related Stripe object IDs, Workspace ID when resolvable, and error details when processing fails. Do not store full raw Stripe webhook payloads by default.
- Ledger entries created from Stripe use stable Stripe references such as event ID, invoice ID, invoice line ID, Checkout Session ID, PaymentIntent ID, or subscription ID to prevent duplicates.
- Stripe API write requests use Stripe idempotency keys for retryable create/update operations.
- Add Billing reconciliation as a scheduled, idempotent operation. It catches missed webhook deliveries, stale unpaid states, ungranted Included Credits, invoice status drift, and summary projection drift. It records or alerts on drift and must not blindly rewrite ledger history.
- Paid non-enterprise Included Credits are granted from Stripe invoice payment or subscription events, not local time passing alone.
- Credit pack Checkout Session creation does not grant Purchased Credits. Purchased Credits are granted only after successful Stripe payment events.
- Pending Credit pack Checkout Sessions are not shown as available balance or Owner billing activity.
- Free Workspaces use the Workspace creation time as Billing period anchor until they start a paid subscription. Paid Workspaces follow Stripe subscription billing cycle. After subscription end, the Workspace keeps the latest Stripe Billing period anchor for future Free Billing periods.
- A Plan page limit is monthly, not per-Document.
- Plan page usage is counted at accepted submission time, not completion time.
- Document submission generates an Extraction job ID before billing reservation, determines exact Billable Document page count before Source file storage, records billing usage/reservation before Source file storage and Extraction job creation, and only then stores and queues product work.
- Billing rejection must happen before Source file storage.
- If billing reservation succeeds but Source file storage, Extraction job creation, or queueing fails, record a Credit refund or compensating ledger entry.
- A Credit refund for failed acceptance or platform fault restores both Credits and Plan page limit capacity.
- Deleting an Extraction job does not refund Credits or reduce historical Plan page limit usage.
- Deleting a Workspace does not refund Credits, subscription payments, Enterprise invoices, or other billing charges.
- Deleting a Workspace ends future self-service subscription billing, deactivates billing entitlements, is blocked while unpaid billing invoices exist, and requires Application admin handling when active Enterprise deal terms exist.
- Deleting a Workspace retains minimal billing records needed for financial, audit, and legal purposes. Retained records may reference the deleted Workspace ID and actor user IDs, but should avoid account emails and names beyond what Stripe or invoices retain.
- Existing Workspaces default to Free when billing launches unless an Application admin assigns another entitlement before launch.
- New Workspaces start on Free. Starter Templates count against Free limits and must fit Free limits.
- Existing product data is not destructively migrated or deleted when billing enforcement launches. Enforcement applies to new Extraction jobs, new Templates, Template saves, Workspace invitations, API key generation/use, and billing actions.
- Build an entitlement/plan-limit inspector that can combine billing control data, Workspace membership counts from D1, Template/field/table-column counts from Workspace product data, and billing ledger usage summaries into block reasons.
- Any Plan limit overage blocks new Extraction jobs until resolved or billing is restored.
- If Workspace Template count exceeds current plan limit, block new jobs against all Templates and block new Template creation.
- If accepted Workspace memberships exceed current Plan member limit, block new jobs against all Templates and block new Workspace invitations.
- If a Template exceeds current Template field or Template object column limits, block new jobs for that Template and allow saves only when the save brings it within limits or billing is restored.
- API access entitlement is required for Workspace API key generation and product API access through Workspace API keys.
- Losing API entitlement preserves existing Workspace API keys but rejects product API requests using them until entitlement returns. Report this as an entitlement error, not an invalid credential.
- Owner-facing Workspace billing endpoints are session-only and require Workspace billing authority. Workspace API keys cannot read billing details or start Stripe billing flows.
- Detailed Workspace billing data is fetched through dedicated billing endpoints, not normal Workspace listing responses. Workspace listing may include minimal Billing operational status only.
- Backend billing entitlement summaries expose current Active entitlement, advisory block reasons, balance/capacity summaries, and next scheduled entitlement change when one exists. Final enforcement still happens in the submission path after exact page count is known.
- Add an owner-facing Billing page in the frontend. It shows current plan entitlement, available Credits, remaining current-period page capacity, Included Credit renewal, monthly page usage, Credit pack purchase actions, subscription management, invoices, payment setup, Owner billing activity, and scheduled changes.
- Non-owner Workspace members do not see the Billing page navigation item. They may see limited Billing operational status at blocked actions.
- Add Application admin billing view frontend/backend support for Plan overrides, No-billing mode, Goodwill Credit grants/revocations, Enterprise deal terms, invoice status, invoice collection mode, Enterprise invoice review mode, and billing audit logs.
- Application admin billing actions record Application admin billing audit log entries with actor, timestamp, reason, before/after values, and affected Workspace.
- Goodwill Credit grants add Credits without changing historical Plan page limit usage unless explicitly marked usage-restoring.
- Application admins may revoke unspent Purchased Credits or Goodwill Credit grants, but must not delete or mutate historical ledger entries.
- No-billing mode uses the Enterprise limit profile, bypasses Credits, invoices, usage charges, and Plan page limit enforcement, and still records No-billing usage entries.
- No-billing mode does not bypass product safety limits such as source file size limits or abuse/rate limits.
- Enterprise uses the Enterprise limit profile, has no standard hard monthly Plan page limit, does not use prepaid Credits, records Enterprise usage charges, and remains subject to product safety and abuse/rate limits.
- Enterprise ramp-up is optional, lasts an Application-admin-selected number of months defaulting to 3, uses an Application-admin-selected Enterprise billing cycle start date, and invoices monthly in arrears.
- Enterprise ramp-up usage bands are tiered by usage slice, not single-rate by total monthly volume.
- Enterprise annual commitments are optional without ramp-up or can follow ramp-up. They activate only after upfront invoice payment.
- Application admins can use standard Enterprise annual tier defaults or enter custom monthly allowance and per-page price. Yearly cost is derived automatically.
- Enterprise overage is billed monthly in arrears above the Enterprise monthly minimum allowance. Unused minimum allowance does not roll over.
- Enterprise ramp-up and overage invoices are generated automatically from Billing ledger usage after each invoice period closes.
- Enterprise invoices finalize automatically unless Enterprise invoice review mode is enabled.
- Overdue Enterprise ramp-up or overage invoices suspend Enterprise entitlement until paid. Suspended Enterprise falls back to active self-service subscription entitlement if present, otherwise Free.
- Active Enterprise entitlement supersedes self-service subscription entitlement. Historical self-service subscription records may remain, but the Workspace should not be double-billed for overlapping self-service and Enterprise entitlements.
- No ADR beyond the existing billing ledger ADR is required for Stripe surface choices unless implementation discovers a hard-to-reverse trade-off not captured here.

## Testing Decisions

- Good tests should assert externally visible billing behavior, domain contracts, entitlement decisions, and Stripe boundary calls. Avoid testing private helper names, exact SQL text, CSS implementation details, or Stripe SDK internals.
- The plan catalog module should have pure unit tests for Free, Pro, Max, Enterprise limit profile, Credit pack sizes, prices, included Credits, monthly page limits, API access, and Template/member/field/table-column limits.
- The entitlement resolver should have pure unit tests for No-billing, active Plan override, Enterprise, self-service subscription, unpaid state, Free fallback, scheduled downgrades, cancellation, override expiry, Enterprise suspension, and precedence ordering.
- The billing period module should have pure unit tests for Free anchors, Stripe subscription anchors, cancellation fallback anchors, Enterprise billing cycle start dates, current-period lookup, and boundary dates.
- The Workspace billing Durable Object should be tested as the primary deep module. Tests should verify append-only ledger entries, grants, purchases, Included Credit expiry, spend order, Purchased Credit carry-forward, reservations, refunds, revocations, Enterprise usage charges, No-billing usage entries, summaries, idempotency, and rebuildable projections.
- Billing ledger tests should verify Credit reservations consume Included Credits before Purchased Credits.
- Billing ledger tests should verify insufficient Credits reject prepaid submissions.
- Billing ledger tests should verify insufficient Plan page capacity rejects non-enterprise submissions.
- Billing ledger tests should verify refunds for failed acceptance restore both Credits and page capacity.
- Billing ledger tests should verify deleting jobs or Workspaces does not create refunds.
- Billing ledger tests should verify internally generated reservation idempotency keys prevent duplicate reservation for the same job ID.
- Billing ledger tests should verify duplicate user submissions with different job IDs are separate billable events.
- Billing control store tests should verify Stripe Customer mapping, active entitlement summaries, scheduled changes, Plan override metadata, No-billing state, Enterprise metadata, processed event records, and retained billing records.
- Stripe webhook processor tests should use fake Stripe event payloads and verify signature verification is required at the route boundary, duplicate processed event IDs are ignored, and stable Stripe references prevent duplicate grants/charges.
- Stripe webhook processor tests should verify Credit pack Checkout completion grants Purchased Credits only after successful payment events.
- Stripe webhook processor tests should verify subscription invoice paid grants Included Credits and activates paid entitlement.
- Stripe webhook processor tests should verify invoice payment failure creates or preserves Unpaid billing state without granting paid entitlements.
- Stripe webhook processor tests should verify invoice voiding/resolution updates unpaid/deletion-blocking state appropriately.
- Stripe webhook processor tests should verify subscription update/deletion schedules downgrades or cancellation behavior without bypassing payment gates.
- Stripe gateway tests should verify Checkout/Portal/invoice creation requests omit `payment_method_types`, enable automatic tax where supported, use configured Stripe Price IDs, and attach Workspace metadata.
- Stripe gateway tests should verify Stripe API writes use idempotency keys.
- Stripe gateway tests should verify test-mode and live-mode configuration are separated by environment.
- Billing reconciliation tests should verify missed paid invoice events can be detected and repaired idempotently without duplicating ledger entries.
- Billing reconciliation tests should verify stale unpaid states and invoice status drift are detected.
- Document submission tests should verify billing rejection happens after page count and before R2 storage/job creation.
- Document submission tests should verify successful prepaid submission records billing reservation before Source file storage and queued job creation.
- Document submission tests should verify successful Enterprise submission records an Enterprise usage charge before Source file storage and queued job creation.
- Document submission tests should verify successful No-billing submission records a No-billing usage entry before Source file storage and queued job creation.
- Document submission tests should verify Source file storage/job creation/queueing failure after billing reservation records a compensating refund or correction.
- Document submission tests should verify images count as one Billable Document page and PDFs count by detected Source file page count.
- Product route tests should verify Plan limit overage blocks new Extraction jobs, new Templates, Template saves that remain over limit, Workspace invitations, API key generation, and API key product access where applicable.
- Product route tests should verify existing over-limit Templates, memberships, and API keys are preserved after downgrade/unpaid state.
- Product route tests should verify API entitlement failures are entitlement errors rather than invalid API key authentication.
- Workspace deletion tests should verify deletion is blocked with unpaid invoices, ends future subscription billing when allowed, requires admin handling for active Enterprise deal terms, does not refund charges, and retains minimal billing audit records.
- Application admin billing tests should verify Plan override creation, no-payment activation, payment-required invoice creation, override expiry fallback, No-billing mode, Goodwill Credit grants, revocation of unspent grants, and admin audit logging.
- Enterprise billing tests should verify ramp-up month alignment, tiered ramp-up pricing, automatic invoice generation from ledger usage, invoice review mode, annual commitment upfront invoice activation, derived yearly cost, monthly minimum allowance, no rollover, overage calculation, and overdue suspension.
- Owner billing endpoint tests should verify only current Workspace owner sessions can read detailed billing or start Stripe flows.
- Owner billing endpoint tests should verify Workspace API keys cannot read billing details or start Stripe billing flows.
- Owner billing endpoint tests should verify returned activity omits internal admin notes, raw Stripe IDs, and reconciliation internals.
- Frontend Billing page tests should verify only Workspace owners see the Billing navigation item.
- Frontend Billing page tests should verify non-owners do not see invoices, payment methods, exact prices paid, or billing controls.
- Frontend Billing page tests should verify available Credits and remaining page capacity are displayed separately.
- Frontend Billing page tests should verify current entitlement and next scheduled entitlement change are displayed.
- Frontend Billing page tests should verify Credit pack actions start Checkout and do not show pending purchases as balance.
- Frontend Billing page tests should verify Customer Portal/payment setup actions are owner-only.
- Frontend upload tests should verify advisory entitlement summaries disable upload before file selection when submission is already blocked.
- Frontend upload tests should verify final backend rejection remains handled when exact PDF page count exceeds Credits or capacity after upload.
- Frontend operational status tests should verify blocked non-owner users see limited Billing operational status without owner-only details.
- Application admin billing frontend tests should verify admin controls for Plan overrides, No-billing, Goodwill Credits, Enterprise terms, collection mode, invoice review mode, and audit visibility.
- Prior backend test examples include Workspace policy tests, extraction API tests, Workspace product store tests, Better Auth configuration tests, and document processing workflow tests.
- Prior frontend test examples include Application admin page tests, auth tests, workspace toast tests, template controller behavior, and App-level workspace flow tests.
- Backend typecheck should pass after backend implementation.
- Frontend production build should pass after frontend changes.
- Stripe behavior should be verified in Stripe test mode before live mode configuration.

## Out of Scope

- Multi-currency pricing.
- Tax calculation outside Stripe Tax.
- Custom in-app card forms or raw PaymentIntent payment forms.
- Passing `payment_method_types` to Stripe for web payments.
- Stripe Connect marketplace/platform setup.
- Mobile/client-side Stripe secret key usage.
- Allowing Workspace API keys to manage or read billing.
- Client-provided idempotency keys for Document submission.
- Preventing users from accidentally submitting duplicate Documents.
- Per-Document billing page caps beyond existing product safety limits.
- Refunds for Workspace deletion.
- Refunds for Extraction job deletion.
- Automatic refunds for normal failed Extraction jobs.
- Destructive migration or deletion of existing over-plan Templates, Template fields, Workspace memberships, or API keys.
- Making Enterprise a public self-service plan.
- Using prepaid Credits for Enterprise.
- Allowing Application admins to edit Free/Pro/Max public plan definitions through the app.
- Building a custom payment method management UI.
- Storing full raw Stripe webhook payloads by default.
- Storing raw payment method details.
- Storing account emails/names in retained billing records beyond what Stripe or invoices already retain.
- Allowing unrestricted plan switching through Stripe Customer Portal.
- Building rich revenue analytics dashboards.
- Building a warehouse/export pipeline for billing analytics.
- Implementing issue breakdown in this PRD. Separate implementation issues can slice this PRD later.
- Reworking Account email verification, Account password reset, Workspace invitation, Leave Workspace, or Application admin account-management behavior beyond billing integration points.
- Redesigning Workspace product data storage beyond the billing coordination points already agreed in ADR 0003.

## Further Notes

- This PRD is based on the updated Backend and Frontend contexts and ADR 0003, **Workspace Billing Ledger in Durable Objects**.
- Billing should be implemented in slices even though this PRD is comprehensive. A sensible implementation order is: domain/catalog/control schema; billing ledger DO and entitlement resolver; submission enforcement with Free/default rules; Stripe Credit packs; Pro/Max subscriptions; owner Billing page; Application admin billing controls; Enterprise invoicing; reconciliation and polish.
- Stripe local development uses Stripe test mode resources. Production uses separate live-mode resources.
- Use the latest Stripe API version and SDK available to the project when implementation begins. The Stripe skill guidance used while writing this PRD named `2026-05-27.dahlia` as the latest API version.
- Use Stripe restricted API keys over unrestricted secret keys wherever Stripe permissions allow it.
- Keep money representation precise. Domain docs intentionally name prices as GBP per-page or GBP plan prices; implementation should avoid floating point arithmetic for monetary calculations.
- The current source-file page-count feature is a prerequisite for page-based billing because PDF page count is known at submission time before Source file storage.
- The owner-facing Billing page is a Workspace page, but Application admin billing management is an Application admin surface. Do not conflate Workspace owner/admin membership with Application admin authority.
- The PRD intentionally preserves a strong invariant: no paid non-enterprise entitlement before successful payment, no accepted prepaid Document submission without enough Credits and monthly page capacity, and no accepted Enterprise/no-billing submission without a ledger usage entry.
