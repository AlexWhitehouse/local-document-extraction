# Backend Context

The backend context covers durable product rules for authentication, workspace access, templates, document extraction, and background image processing. It defines business language used by API handlers, policies, and worker processing.

## Language

**Account password policy**:
The minimum strength rule for email/password account credentials.
_Avoid_: password validation, sign-up password rule

**Account email verification**:
Proof that a user controls the email address used for application access.
_Avoid_: email confirmation, verified user

**Account password reset**:
A self-service flow where someone who knows an account email can request a link and set a new password for an email/password Account.
_Avoid_: forgot password, password recovery, Workspace password reset

**Application admin**:
A user with application-wide account management authority, separate from any workspace-scoped role.
_Avoid_: workspace admin, owner, support user

**Workspace**:
An environment a user can access only after they have a workspace membership.
_Avoid_: group, account, tenant

**Workspace billing**:
The billing relationship for a **Workspace**, including its plan, payment state, credits, invoices, and usage charges.
_Avoid_: user billing, account billing, tenant billing

**Workspace billing authority**:
The self-service permission held by the current **Workspace** owner to view and manage **Workspace billing**.
_Avoid_: billing admin, billing user, workspace billing member

**Application admin billing view**:
The application-wide billing management surface where Application admins manage Workspace billing outside the owner-facing billing page.
_Avoid_: owner billing page, workspace billing tab, support billing

**Application admin billing audit log**:
The durable audit trail of Application admin actions that change Workspace billing state or commercial terms.
_Avoid_: billing ledger, admin note, support history

**Owner billing activity**:
The customer-facing history of billing activity visible to the Workspace owner.
_Avoid_: admin audit log, Stripe raw events, reconciliation log

**Billing operational status**:
Limited Workspace billing state shown to non-owner members only to explain blocked product actions.
_Avoid_: billing details, invoice summary, payment status

**Workspace membership**:
Accepted access that makes a user a member of a **Workspace** with a role.
_Avoid_: user status, workspace user row

**Workspace policy**:
The rules that decide what a workspace member may do inside a **Workspace**.
_Avoid_: role checks, permission helpers

**Workspace context**:
The currently selected accepted **Workspace** or pending **Workspace invitation** that determines what the user can see and do.
_Avoid_: selected workspace, active workspace state

**Accepted workspace context**:
A **Workspace context** backed by **Workspace membership** that enables workspace API access when the user has a session or workspace API key.
_Avoid_: connected workspace, unlocked workspace

**Pending workspace invitation context**:
A **Workspace context** backed by a pending **Workspace invitation** that shows invitation details and actions but does not enable workspace API access.
_Avoid_: pending workspace, disabled workspace

**Workspace invitation**:
A pending offer for an email address to join a **Workspace**.
_Avoid_: invite, invited workspace, pending member

**Workspace invitation management**:
The owner/admin view of actionable pending **Workspace invitations** sent from a **Workspace**.
_Avoid_: invitation history, invite audit log

**Workspace invitation summary**:
The displayed details for a pending **Workspace invitation**, including workspace, invited email, offered role, pending status, inviter identity, invited time, and expiry.
_Avoid_: invitation row, invite card

**Workspace member action**:
An action that changes a member's workspace access or role.
_Avoid_: user status change, member edit

**Workspace API key**:
A workspace-scoped credential for external API clients to access workspace-scoped product routes.
_Avoid_: frontend session key, user token

**Workspace API key format**:
The opaque generated string format for **Workspace API keys**.
_Avoid_: user-facing key schema, guaranteed key length

**Workspace control data**:
Durable access and identity records needed to locate and authorize a **Workspace**.
_Avoid_: global workspace data, aggregate workspace data

**Workspace product data**:
Workspace-owned extraction configuration and processing records created inside an **Accepted workspace context**.
_Avoid_: app data, tenant payload, aggregate data

**Workspace product analytics**:
Aggregate event data about **Workspace product data** usage that excludes customer content and identity data.
_Avoid_: product data projection, audit log, source of truth

**Workspace live update**:
A realtime notification about changed **Workspace product data** for an accepted **Workspace context**.
_Avoid_: polling replacement for all data, durable event log, analytics event

**Workspace context invalidation**:
A freshness hint carried by **Workspace live updates** that tells a session browser its accepted **Workspace context** may need HTTP revalidation after Workspace billing, Template limit, member limit, or access state changes.
_Avoid_: billing payload, context snapshot, durable event

**Leave Workspace**:
A self-service action where a non-owner workspace member removes only their own **Workspace membership**.
_Avoid_: exit group, delete access

**Replacement personal Workspace**:
A newly created personal **Workspace** that preserves the expectation that a user has at least one accepted **Workspace** after **Leave Workspace**.
_Avoid_: fallback workspace, default workspace

**Document**:
A user-provided file submitted for extraction.
_Avoid_: image, upload, input file

**Source file**:
The original uploaded binary for a **Document**.
_Avoid_: image object, R2 object, file blob

**Source file page count**:
The detected number of pages in a PDF **Source file**.
_Avoid_: PDF page metadata, upload page count

**Credit**:
A prepaid unit that allows one billable Document page to be submitted for extraction.
_Avoid_: token, page token, usage point

**Included Credit**:
A Credit granted by a paid monthly plan for the current billing period.
_Avoid_: free credit, bundled page, monthly allowance

**Purchased Credit**:
A Credit bought separately in advance and carried forward until spent.
_Avoid_: top-up token, extra page, add-on credit

**Credit pack**:
A fixed bundle of Purchased Credits bought at the Workspace's current non-enterprise plan price.
_Avoid_: custom credit amount, credit order, top-up quantity

**Billing ledger**:
The authoritative record of Workspace credit grants, purchases, spending, refunds, and page usage reservations.
_Avoid_: balance cache, billing summary, Stripe ledger

**Billing reconciliation**:
An idempotent scheduled check that compares Stripe billing state with Workspace billing records and records or alerts on drift.
_Avoid_: billing cron, webhook backup, balance rewrite

**Stripe billing event**:
A Stripe-originated webhook or API-observed billing change that may affect Workspace billing state.
_Avoid_: Stripe callback, payment notification, billing ping

**Stripe restricted API key**:
A least-privilege Stripe API key used by the backend for Stripe billing operations.
_Avoid_: Stripe secret key, client Stripe key, dashboard key

**Stripe test mode**:
The non-production Stripe environment used for local development, test customers, test prices, and webhook testing.
_Avoid_: fake billing, local Stripe, mock Stripe

**Credit reservation**:
A committed **Billing ledger** entry that spends Credits and records Plan page limit usage for an accepted Document submission.
_Avoid_: pending charge, job credit flag, usage estimate

**Credit refund**:
A compensating **Billing ledger** entry that returns Credits and page-limit capacity after a reserved submission is not accepted or is intentionally refunded.
_Avoid_: reservation deletion, credit reversal, balance edit

**Goodwill Credit grant**:
A manual Credit grant that compensates a Workspace commercially without changing historical Plan page limit usage unless explicitly marked to do so.
_Avoid_: refund, coupon, balance edit

**Billable Document page**:
One counted page of a submitted **Document** for **Workspace billing** purposes.
_Avoid_: source file page count, model page, processed image

**Billing period**:
The monthly interval in which plan entitlement, included Credits, and plan usage limits are evaluated.
_Avoid_: billing cycle, subscription month, usage month

**Billing period anchor**:
The date/time used to determine the start of a Workspace's monthly Billing periods.
_Avoid_: cycle anchor, reset date, usage window start

**Plan page limit**:
The maximum number of Billable Document pages a Workspace may submit during a Billing period under its current plan.
_Avoid_: credit limit, usage balance, monthly quota

**Plan member limit**:
The maximum number of accepted Workspace memberships allowed by the Workspace's current plan.
_Avoid_: user quota, seat limit, workspace user limit

**Plan limit overage**:
The state where existing Workspace product data exceeds the limits of the Workspace's current plan.
_Avoid_: grandfathered data, invalid workspace, excess resources

**Plan upgrade**:
A paid change to a higher non-enterprise plan that takes effect during the current Billing period after successful payment.
_Avoid_: plan switch, tier bump, subscription edit

**Plan downgrade**:
A scheduled change to a lower non-enterprise plan that takes effect at the next Billing period.
_Avoid_: plan reduction, tier drop, cancellation

**Subscription cancellation**:
A Workspace owner action that schedules the self-service paid subscription entitlement to end at the next Billing period.
_Avoid_: immediate downgrade, account cancellation, refund request

**Plan override**:
A time-bounded Application admin assignment that controls a Workspace's plan entitlement outside normal self-service subscription changes.
_Avoid_: manual tier, admin plan, temporary subscription

**No-billing mode**:
An Application admin state where a Workspace receives Enterprise product limits without Credits, invoices, or usage charges.
_Avoid_: free enterprise, unlimited plan, comped subscription

**Enterprise limit profile**:
The product limits shared by Enterprise plans and No-billing mode.
_Avoid_: unlimited limits, enterprise plan, no-billing limits

**Enterprise usage charge**:
An invoice-based charge for Enterprise Billable Document pages rather than prepaid Credit spend.
_Avoid_: enterprise credit, prepaid enterprise usage, credit overage

**No-billing usage entry**:
A Billing ledger entry that records Billable Document page usage for a Workspace in No-billing mode without charging Credits or invoices.
_Avoid_: free usage charge, ignored usage, no-cost credit

**Per-page price**:
The GBP price charged for one Billable Document page.
_Avoid_: pence fraction, credit amount, page cost

**Billing catalog price**:
The tax-exclusive GBP price shown for a plan, Credit pack, or Enterprise usage charge before VAT or other applicable taxes.
_Avoid_: tax-inclusive price, displayed total, final charge

**Enterprise ramp-up**:
A time-bounded Enterprise billing state where monthly invoices charge actual Billable Document page usage by ramp-up usage bands before an annual commitment starts.
_Avoid_: enterprise trial, enterprise credits, pilot plan

**Enterprise billing cycle start date**:
The Application-admin-selected date that anchors Enterprise ramp-up months and monthly invoice periods.
_Avoid_: ramp-up start, invoice anchor, enterprise renewal day

**Enterprise ramp-up usage band**:
An inclusive monthly Billable Document page slice that determines the per-page price for that slice of Enterprise ramp-up usage.
_Avoid_: enterprise credit tier, volume discount, usage bracket

**Enterprise annual commitment**:
A yearly Enterprise plan paid upfront with a minimum monthly page allowance and monthly overage invoicing.
_Avoid_: enterprise subscription, annual credits, enterprise MOQ plan

**Enterprise deal terms**:
The Application-admin-set commercial terms for a Workspace's Enterprise ramp-up or annual commitment.
_Avoid_: enterprise catalog plan, custom subscription, sales note

**Enterprise monthly minimum allowance**:
The Billable Document pages prepaid for each monthly invoice period under an Enterprise annual commitment.
_Avoid_: MOQ credits, prepaid monthly credits, included enterprise pages

**Enterprise annual tier default**:
A standard annual commitment option shown to Application admins when setting Enterprise deal terms.
_Avoid_: fixed enterprise plan, self-service enterprise tier, required contract

**Enterprise overage**:
Billable Document pages above the Enterprise monthly minimum allowance that are invoiced monthly.
_Avoid_: enterprise extra credits, excess usage, monthly add-on

**Enterprise billing invoice**:
A Stripe invoice for Enterprise upfront commitment, ramp-up usage, or monthly overage that is visible to the Workspace owner.
_Avoid_: enterprise bill, admin invoice, enterprise credit invoice

**Enterprise invoice review mode**:
An Application-admin setting that leaves automatically generated Enterprise invoices in draft for review before finalization.
_Avoid_: manual enterprise billing, invoice approval, draft billing

**Automatic invoice collection**:
Stripe collection where invoices are charged against the Workspace billing customer's default payment method.
_Avoid_: auto-pay, stored-card billing, silent charge

**Manual invoice collection**:
Stripe collection where invoices are sent for manual payment instead of automatically charged.
_Avoid_: offline billing, pay later, procurement invoice

**Stripe Checkout Session**:
A Stripe-hosted payment flow used for owner-initiated subscription starts and Credit pack purchases.
_Avoid_: custom payment form, raw payment intent, card form

**Stripe Customer Portal**:
A Stripe-hosted self-service billing management flow for payment method and subscription management.
_Avoid_: custom subscription manager, payment settings page, billing settings form

**Stripe Customer**:
The Stripe customer record that represents exactly one Workspace for billing.
_Avoid_: user customer, owner customer, account customer

**Unpaid billing state**:
The state where a Workspace has not paid the subscription invoice required to activate paid plan entitlements for a Billing period.
_Avoid_: grace usage, failed subscription, delinquent account

**Active entitlement**:
The single effective billing state that determines a Workspace's current plan limits, credit behavior, and invoice behavior.
_Avoid_: active plan, billing status, subscription state

**Free plan**:
The default non-enterprise plan that grants limited product access but no Included Credits.
_Avoid_: trial plan, free credits plan, unpaid workspace

**Non-enterprise plan catalog**:
The code-owned Free, Pro, and Max plan definitions and Stripe price mappings.
_Avoid_: editable plans, admin pricing table, plan database

**Extraction job**:
The durable processing record created when a **Document** is submitted with a **Template**.
_Avoid_: job, document, processing task

**Extraction job lifecycle**:
The durable state progression for an **Extraction job** from submission through Cloudflare Workflow processing, result persistence, completion, failure, and **Source file** cleanup.
_Avoid_: job status helpers, queue state, workflow flag

**Extraction processor**:
The background execution path that performs model extraction work for an **Extraction job**.
_Avoid_: job state owner, queue state machine

**Extraction result**:
The completed output value for a **Template field** in an **Extraction job**.
_Avoid_: answer row, model response, result item

**Template**:
A reusable extraction schema selected when submitting **Documents**.
_Avoid_: form, prompt, extraction config

**Template field**:
An individual answer definition inside a **Template**.
_Avoid_: field row, extraction key, output column

**Template version**:
A specific revision of a **Template** used to interpret **Extraction job** results.
_Avoid_: current template, schema snapshot

**Template object schema**:
The table-shaped definition for an object-like **Template field**.
_Avoid_: object marker parsing, nested field table

**Template object column**:
A column inside a table-shaped **Template object schema**.
_Avoid_: nested field, table field, object field

**Template object column limit**:
The maximum number of **Template object columns** allowed in the single table-shaped **Template field** permitted by a plan.
_Avoid_: nested field limit, table array field limit, max table fields

## Rules

- **Account password policy** requires at least 8 characters, one ASCII uppercase letter, one ASCII number, and one special character.
- **Account email verification** is required before an email/password user may access the application.
- A trusted social provider's verified email claim satisfies **Account email verification** without a separate Document Extraction verification email.
- **Account email verification** email is sent from `Document Extraction <no-reply@extract.t3m.uk>`.
- Reusable outbound email sending requires callers to provide the sender identity rather than reading a global sender from configuration.
- The Worker email sending binding is named `EMAIL` and is shared by transactional email flows.
- Local development uses the real Cloudflare Email Sending service for **Account email verification**, not a verification bypass.
- After successful **Account email verification**, users return to the application root.
- Successful **Account email verification** signs the user in automatically.
- Signing in with an unverified email/password account sends a new **Account email verification** link instead of granting access.
- Existing unverified email/password users are blocked on future sign-in, but this slice does not forcibly invalidate existing sessions.
- Existing unverified email/password users are not backfilled as verified by migration.
- **Account email verification** email is HTML formatted, includes a plain-text alternative, and tells unexpected recipients they can ignore it.
- **Account email verification** sending is scheduled without blocking sign-up or sign-in responses.
- **Account email verification** uses direct Cloudflare Email Sending for this slice; a durable email queue is deferred until retry, audit, or provider-switching needs justify it.
- **Account password reset** request responses do not reveal whether the submitted email belongs to an email/password Account.
- **Account password reset** links land on the SPA `/reset-password` experience with a Better Auth reset token or token error in the query string.
- **Account password reset** requires the same **Account password policy** as email/password sign-up.
- **Account password reset** links expire after one hour.
- **Account password reset** revokes existing sessions after the password changes.
- **Account password reset** email is sent from `Document Extraction <no-reply@extract.t3m.uk>`.
- **Account password reset** email is HTML formatted, includes a plain-text alternative, includes the reset link, and tells unexpected recipients they can ignore it.
- **Account password reset** sending is scheduled without blocking request responses.
- Transactional email templates are code-owned render modules, with each email type in its own file.
- Auth-triggered transactional emails use Worker `waitUntil` when the request path can send email; session-read paths do not require scheduling context.
- **Application admin** authority is application-wide and is not granted by Workspace owner/admin membership.
- **Workspace billing** is scoped to the **Workspace**, not to an individual user.
- Each **Workspace** has at most one **Stripe Customer** for billing.
- A **Stripe Customer** represents the **Workspace**, not the **Workspace** owner user.
- **Workspace** ownership transfer keeps the same **Stripe Customer**.
- **Workspace** ownership transfer updates the **Stripe Customer** billing contact email to the new owner while preserving billing history.
- The current **Workspace** owner has **Workspace billing authority**.
- Transferring **Workspace** ownership transfers **Workspace billing authority** without changing the **Workspace billing** history.
- Workspace admins and members do not have **Workspace billing authority**.
- The owner-facing billing page is visible only to the current **Workspace** owner.
- The owner-facing billing page may show **Owner billing activity** including credit purchases, included Credit grants, credit spending summaries, refunds, subscription changes, invoices, and payment status.
- **Owner billing activity** must not expose internal admin notes, **Application admin billing audit log** details, raw Stripe identifiers, or billing reconciliation internals.
- **Application admins** manage **Workspace billing** through the **Application admin billing view**, not through the owner-facing billing page unless they are also the **Workspace** owner.
- **Application admin** actions that change **Workspace billing** state or commercial terms are recorded in the **Application admin billing audit log** with actor, timestamp, reason, before/after values, and affected **Workspace**.
- Non-owner **Workspace members** may see **Billing operational status** when billing state blocks product actions.
- **Billing operational status** must not expose invoices, payment methods, exact prices paid, or owner-only billing controls.
- The backend exposes billing entitlement summaries so clients can show why new Document submission is blocked before upload.
- Billing entitlement summaries expose both current **Active entitlement** and next scheduled entitlement change when one exists.
- Backend billing entitlement summaries are advisory; final Document submission enforcement happens after exact billable page count is known.
- Detailed **Workspace billing** data is fetched through dedicated billing endpoints rather than normal Workspace listing responses.
- Normal Workspace listing responses may include minimal **Billing operational status** but must not expose owner-only billing details.
- Owner-facing **Workspace billing** endpoints are session-only and require **Workspace billing authority**.
- **Workspace API keys** cannot read billing details or start Stripe billing flows.
- A **Credit** is reserved and spent when a **Document** submission is accepted and an **Extraction job** is queued.
- **Plan page limit** usage is counted when a **Document** submission is accepted and an **Extraction job** is queued.
- **Credit** spend and **Plan page limit** usage must be recorded as a **Credit reservation** before a **Document** submission is accepted.
- A **Document** submission must be rejected before queueing work when the **Workspace** lacks enough **Credits** or remaining **Plan page limit** capacity.
- A **Document** submission should determine exact **Billable Document page** count before **Source file** storage, billing reservation, and **Extraction job** creation.
- A **Document** submission rejected for billing entitlement or capacity must not store its **Source file**.
- A **Document** submission generates its **Extraction job** ID before billing reservation so the **Billing ledger** can reference the future job.
- Billing reservation happens before **Source file** storage and **Extraction job** creation.
- The **Billing ledger** is the source of truth for **Credit** balances, **Credit reservations**, refunds, and **Plan page limit** usage.
- The **Billing ledger** is append-only for grants, purchases, reservations, refunds, revocations, and Enterprise usage charges.
- The **Billing ledger** records **No-billing usage entries** for **No-billing mode** submissions.
- Billing balances and monthly usage summaries are rebuildable projections from the **Billing ledger**.
- **Credit reservation** entries include **Workspace** ID, **Extraction job** ID, **Template** ID and version, **Billable Document page** count, submission time, actor or auth mode when available, and idempotency key.
- **Credit reservation** idempotency keys for Document submission are generated internally from the **Extraction job** ID rather than supplied by the client.
- Duplicate user submissions are treated as separate submissions with separate **Extraction job** IDs and billing entries.
- **Credit reservation** entries record Credit and page quantities rather than monetary amounts.
- **Enterprise usage charge** entries include the same submission metadata as **Credit reservation** entries.
- **Enterprise usage charge** and invoice-related ledger entries record the rates and monetary amounts used for invoice generation.
- **No-billing usage entries** include the same submission metadata as **Credit reservation** entries.
- **Credit reservations** are not mutated or deleted; failed acceptance and intentional refunds are represented by **Credit refunds**.
- If **Credit reservation** succeeds but **Extraction job** creation or queueing fails, a **Credit refund** must be recorded.
- A **Credit refund** for failed acceptance or platform fault restores both **Credits** and **Plan page limit** capacity.
- A **Goodwill Credit grant** adds **Credits** without changing historical **Plan page limit** usage unless explicitly marked as usage-restoring.
- Deleting an **Extraction job** does not create a **Credit refund** or reduce historical **Plan page limit** usage.
- Deleting a **Workspace** does not refund **Credits**, subscription payments, Enterprise invoices, or other billing charges.
- Deleting a **Workspace** ends future self-service subscription billing and deactivates billing entitlements before **Workspace control data** and **Workspace product data** are deleted.
- Deleting a **Workspace** is blocked while the **Workspace** has unpaid billing invoices.
- Deleting a **Workspace** retains minimal billing records needed for financial, audit, and legal purposes, including invoices, payments, billing ledger entries, and billing audit logs.
- Billing records retained after **Workspace** deletion may reference the deleted **Workspace** ID.
- Billing records retained after **Workspace** deletion may retain actor user IDs needed to explain financial or admin actions, but should avoid retaining account emails and names beyond what Stripe or invoices already retain.
- A **Workspace** with active Enterprise deal terms requires **Application admin** handling before deletion completes.
- **Application admins** may grant **Goodwill Credit grants** to a **Workspace**.
- **Application admins** may revoke unspent **Purchased Credits** or **Goodwill Credit grants**, but must not delete or mutate historical **Billing ledger** entries.
- A PDF **Document** spends one **Credit** per detected **Source file page count** page.
- An image **Document** spends one **Credit** as one **Billable Document page**.
- **Included Credits** expire at the end of the **Billing period** that granted them.
- Paid non-enterprise **Included Credits** are granted from Stripe invoice payment or subscription events, not from local time passing alone.
- Stripe webhooks are the primary path for real-time billing state changes.
- **Stripe billing events** must be processed idempotently because Stripe may deliver duplicate or related events.
- The backend uses a **Stripe restricted API key** for Stripe API calls.
- Local development uses **Stripe test mode** keys, customers, products, prices, invoices, and webhooks.
- Production uses separate live-mode Stripe keys, products, prices, invoices, and webhooks.
- Stripe webhook endpoints should subscribe only to required billing event types, not all events.
- Launch Stripe webhook events include Checkout completion, invoice payment/failure/voiding, subscription lifecycle changes, and customer updates only when cached billing summaries require them.
- Stripe API keys and webhook signing secrets are stored as deployment secrets, not source code or committed configuration.
- Stripe webhooks must verify Stripe signatures before processing **Stripe billing events**.
- The application stores minimal processed **Stripe billing event** records for idempotency and debugging, not full raw Stripe webhook payloads by default.
- Minimal processed **Stripe billing event** records are **Workspace control data** stored in D1.
- The Workspace billing ledger still enforces Workspace-specific ledger idempotency.
- **Billing ledger** entries created from Stripe must use stable Stripe references, such as event ID, invoice ID, invoice line ID, Checkout Session ID, PaymentIntent ID, or subscription ID, to prevent duplicate grants, purchases, and invoice charges.
- Stripe API write requests must use Stripe idempotency keys for retryable create/update operations.
- **Billing reconciliation** catches missed webhook deliveries, stale unpaid states, ungranted **Included Credits**, and invoice status drift.
- **Billing reconciliation** must be idempotent and must not blindly rewrite **Billing ledger** history.
- **Purchased Credits** carry forward until spent.
- **Billable Document pages** spend **Included Credits** before **Purchased Credits**.
- Paid non-enterprise **Billing periods** follow the Stripe subscription billing cycle.
- **Free plan** **Billing periods** use the **Workspace** creation time as the **Billing period anchor** until the **Workspace** starts a paid subscription.
- After a paid subscription ends, the **Workspace** keeps the latest Stripe **Billing period anchor** for future **Free plan** Billing periods.
- A **Plan page limit** is a hard cap for non-enterprise plans even when the **Workspace** has enough **Credits**.
- A **Plan page limit** is a monthly limit, not a per-Document page limit.
- A **Workspace** must upgrade or receive an **Application admin** override to submit beyond its non-enterprise **Plan page limit**.
- The **Free plan** grants zero **Included Credits**.
- A **Workspace** on the **Free plan** must buy **Purchased Credits** before submitting billable Documents.
- Existing **Workspaces** default to the **Free plan** when billing launches unless an **Application admin** assigns another entitlement before launch.
- New **Workspaces** start on the **Free plan**.
- Starter **Templates** created for new **Workspaces** count against **Free plan** limits and must fit those limits.
- Any non-enterprise **Workspace** may buy **Purchased Credits**.
- Self-service **Credit packs** are fixed at 100, 500, 1,000, and 5,000 **Purchased Credits**.
- A **Credit pack** is priced from the **Workspace**'s current non-enterprise plan at purchase time.
- Non-enterprise **Per-page prices** are £0.22 on the **Free plan**, £0.20 on Pro, and £0.18 on Max.
- **Billing catalog prices** are tax-exclusive.
- Billing is GBP-only at launch.
- Stripe calculates VAT or other applicable taxes for invoices and Checkout payments.
- Stripe Tax automatic tax is enabled for supported Checkout Sessions, Subscriptions, and Invoices.
- Stripe-hosted flows collect and update billing address, tax identity, and payment method details.
- The application stores Stripe identifiers and sanitized billing summaries, not raw payment method details.
- Stripe owns payment method storage, default payment method selection, and payment method removal for each **Stripe Customer**.
- The application may display whether automatic collection is available, but does not model individual payment methods.
- The **Non-enterprise plan catalog** is code-owned/static at launch.
- **Application admins** do not edit the **Non-enterprise plan catalog** through the application.
- Stripe product and price IDs are environment configuration because test mode and live mode use different Stripe objects.
- Pro and Max subscriptions use pre-created monthly recurring Stripe Prices.
- The **Free plan** has no Stripe Price because it has no subscription fee.
- **Credit packs** are explicit one-off self-service purchases.
- Self-service **Credit packs** use pre-created one-time Stripe Prices for each non-enterprise plan and pack-size combination.
- The application validates that a selected **Credit pack** Stripe Price matches the **Workspace**'s current plan at purchase time.
- Starting **Stripe Checkout Sessions** for **Credit packs** does not grant **Purchased Credits**.
- **Purchased Credits** from **Credit packs** are granted only after successful Stripe payment events.
- Pending **Credit pack** Checkout Sessions are not shown as available balance or **Owner billing activity** before payment succeeds.
- Owner-initiated self-service subscription starts and **Credit pack** purchases use **Stripe Checkout Sessions**.
- Non-enterprise paid subscriptions use **Automatic invoice collection** through Stripe by default.
- Self-service payment method updates, **Subscription cancellation**, and standard Pro/Max subscription management use **Stripe Customer Portal** where it can express the product rules.
- Self-service plan changes are initiated through the application so product rules, proration intent, and entitlement activation remain application-owned.
- **Stripe Customer Portal** must not expose unrestricted plan switching that bypasses application-owned entitlement rules.
- Stripe-hosted invoice payment pages may be used for **Application admin**-created payment-required invoices.
- Stripe payment flows must use dynamic payment methods and must not hardcode `payment_method_types`.
- A **Workspace** in **Unpaid billing state** may buy **Credit packs**, but doing so does not restore paid subscription entitlements.
- Existing **Purchased Credits** are not repriced when the **Workspace** changes plan.
- Downgrading a **Workspace** preserves existing **Purchased Credits**, but the lower plan's **Plan page limit** still gates monthly usage.
- A **Plan upgrade** takes effect for plan perks, **Plan page limit**, and **Included Credits** only after successful payment.
- A mid-period **Plan upgrade** creates a prorated upgrade invoice for the remaining **Billing period**.
- A mid-period **Plan upgrade** grants only the additional **Included Credits** needed to reach the new plan's included allowance for the current **Billing period**.
- A **Workspace** blocked at its current **Plan page limit** may complete a **Plan upgrade**.
- Existing **Billing period** page usage carries forward after a **Plan upgrade** and is evaluated against the new plan's **Plan page limit**.
- Moving from the **Free plan** to a paid non-enterprise plan activates paid entitlements only after the first subscription invoice is paid.
- Moving from the **Free plan** to Pro grants the full 200 **Included Credits** for the current **Billing period** after payment.
- Moving from the **Free plan** to Max grants the full 1,000 **Included Credits** for the current **Billing period** after payment.
- A **Plan downgrade** takes effect at the next **Billing period**.
- **Subscription cancellation** schedules a **Plan downgrade** to the **Free plan** at the next **Billing period**.
- **Subscription cancellation** does not refund unused paid time or unused **Included Credits**.
- A **Plan override** has a Free, Pro, or Max target plan, start time, end time, payment-required setting, reason, and creating **Application admin**.
- An active **Plan override** controls **Workspace** entitlements ahead of normal self-service subscription state.
- A payment-required **Plan override** does not activate paid entitlements until its required invoice is paid.
- A payment-required **Plan override** creates an owner-visible Stripe invoice for the **Workspace**.
- A payment-required **Plan override** uses **Automatic invoice collection** by default when the **Workspace** has a default payment method, otherwise the owner pays manually through the billing page.
- A no-payment-required **Plan override** activates its entitlements without Stripe subscription payment.
- An active no-payment-required **Plan override** grants the target plan's **Included Credits** for each covered **Billing period**.
- When a **Plan override** expires, the **Workspace** falls back to its active self-service subscription entitlement if one exists, otherwise the **Free plan**.
- **No-billing mode** is distinct from Enterprise plans.
- **No-billing mode** bypasses **Credits**, invoices, usage charges, and **Plan page limit** enforcement.
- The **Enterprise limit profile** allows unlimited **Templates** and unlimited accepted **Workspace memberships**.
- The **Enterprise limit profile** allows at most 25 top-level **Template fields** per **Template**.
- The **Enterprise limit profile** allows at most one table-shaped **Template field** with at most 20 **Template object columns**.
- **No-billing mode** uses the **Enterprise limit profile**.
- **No-billing mode** does not bypass product safety limits such as source file size limits or abuse/rate limits.
- **Active entitlement** precedence is **No-billing mode**, active **Plan override**, active Enterprise entitlement, active self-service subscription entitlement, then **Free plan**.
- Active Enterprise entitlement supersedes self-service subscription entitlement.
- A **Workspace** may retain historical self-service subscription records after Enterprise entitlement starts, but should not be double-billed for overlapping self-service and Enterprise entitlements.
- Enterprise plans use the **Enterprise limit profile**.
- Enterprise plans do not use prepaid **Credits**.
- Enterprise **Billable Document pages** are recorded as **Enterprise usage charges** for invoice billing.
- Enterprise plans do not have a standard hard monthly **Plan page limit**.
- Enterprise usage remains subject to product safety limits and abuse/rate limits.
- **Enterprise ramp-up** duration is set by an **Application admin** in months and defaults to 3 months.
- **Enterprise ramp-up** uses an **Enterprise billing cycle start date** chosen by an **Application admin** so ramp-up periods and monthly invoicing align.
- **Enterprise ramp-up** is optional.
- During **Enterprise ramp-up**, invoices charge actual **Billable Document page** usage by ramp-up usage bands.
- **Enterprise ramp-up** usage is billed in arrears for each monthly invoice period.
- **Enterprise ramp-up** invoices are generated automatically after each monthly invoice period closes from the **Billing ledger**.
- **Enterprise ramp-up** invoices finalize automatically unless **Enterprise invoice review mode** is enabled.
- An overdue **Enterprise ramp-up** invoice suspends Enterprise entitlement until paid.
- Suspended Enterprise entitlement falls back to the **Workspace**'s active self-service subscription entitlement if one exists, otherwise the **Free plan**.
- When **Enterprise ramp-up** ends without an active paid **Enterprise annual commitment**, the **Workspace** falls back to its active self-service subscription entitlement if one exists, otherwise the **Free plan**.
- **Enterprise ramp-up usage bands** are 0-10,000 pages at £0.14 per page, 10,001-20,000 pages at £0.13 per page, 20,001-40,000 pages at £0.12 per page, 40,001-60,000 pages at £0.11 per page, and 60,001+ pages at £0.10 per page.
- **Enterprise ramp-up usage bands** are tiered: each slice of monthly usage is charged at that slice's per-page price.
- **Enterprise deal terms** are set per **Workspace** by **Application admins**.
- Standard Enterprise price tables provide defaults for **Enterprise deal terms** but are not a self-service public plan catalog.
- An **Enterprise annual commitment** is paid upfront for a year.
- **Enterprise annual tier defaults** are 60,000 pages/month at £0.09 per page and £64,800/year, 100,000 pages/month at £0.08 per page and £96,000/year, and 200,000 pages/month at £0.07 per page and £168,000/year.
- **Application admins** may enter custom **Enterprise annual commitment** allowance and per-page price instead of using an **Enterprise annual tier default**.
- The yearly cost for an **Enterprise annual commitment** is derived from monthly minimum allowance times 12 times per-page price.
- An **Application admin** may create an **Enterprise annual commitment** after **Enterprise ramp-up** or without any **Enterprise ramp-up**.
- An **Enterprise annual commitment** includes an **Enterprise monthly minimum allowance** for each monthly invoice period.
- Unused **Enterprise monthly minimum allowance** does not roll over to later invoice periods.
- **Enterprise overage** is invoiced monthly for usage above the **Enterprise monthly minimum allowance**.
- **Enterprise overage** uses the same per-page price as the selected **Enterprise annual commitment**.
- **Enterprise overage** is billed in arrears for each monthly invoice period.
- **Enterprise overage** invoices are generated automatically after each monthly invoice period closes from the **Billing ledger**.
- **Enterprise overage** invoices finalize automatically unless **Enterprise invoice review mode** is enabled.
- An overdue **Enterprise overage** invoice suspends Enterprise entitlement until paid.
- **Application admins** assign Enterprise plans and create or trigger required **Enterprise billing invoices**.
- **Enterprise billing invoices** use explicit Stripe invoice items derived from **Enterprise deal terms**, not a pre-created Stripe Price for every custom deal.
- **Enterprise billing invoices** are visible and payable by the **Workspace** owner through the billing page.
- **Enterprise billing invoices** use **Automatic invoice collection** by default after the **Workspace** owner adds a default payment method.
- **Application admins** may set **Enterprise billing invoices** to **Manual invoice collection** for Workspaces that require manual payment.
- An **Enterprise annual commitment** activates only after its upfront **Enterprise billing invoice** is paid.
- **Application admins** do not manually activate unpaid **Enterprise annual commitments**; no-cost access uses **No-billing mode** instead.
- Monthly **Enterprise overage** invoices are visible to the **Workspace** owner through the billing page.
- Non-enterprise paid plan entitlements for a **Billing period** activate only after that period's subscription invoice is paid.
- A **Workspace** in **Unpaid billing state** receives no new **Included Credits** and operates under **Free plan** limits for new actions until payment succeeds.
- **Unpaid billing state** preserves existing **Workspace product data**, **Workspace memberships**, and **Workspace API keys**, but does not grant paid API access while unpaid.
- **Plan limit overage** does not delete existing **Workspace product data**.
- Billing enforcement does not destructively migrate existing **Templates** or **Workspace memberships** that exceed the active plan.
- Billing enforcement applies to new **Extraction jobs**, new **Templates**, **Template** saves, and new **Workspace invitations**.
- Any **Plan limit overage** blocks new **Extraction jobs** until the overage is resolved or billing is restored.
- If a **Workspace** has more **Templates** than its current plan allows, no new **Extraction jobs** may be submitted against any **Template** until the Template count is brought within the current plan or billing is restored.
- If a **Workspace** has more **Templates** than its current plan allows, no new **Templates** may be created until the Template count is brought within the current plan or billing is restored.
- If a **Template** has more **Template fields** than the current plan allows, no new **Extraction jobs** may be submitted against that **Template** until it is edited within the current plan or billing is restored.
- A **Template** with too many **Template fields** for the current plan can only be saved when the save brings it within the current plan limit or billing is restored.
- Each **Template** may contain at most one table-shaped **Template field**.
- A table-shaped **Template field** counts as one top-level **Template field**.
- A table-shaped **Template field** may contain no more **Template object columns** than the current plan's **Template object column limit**.
- If a **Workspace** has more accepted **Workspace memberships** than its current **Plan member limit**, no new **Extraction jobs** may be submitted against any **Template** until membership count is brought within the current plan or billing is restored.
- If a **Workspace** has more accepted **Workspace memberships** than its current **Plan member limit**, no new **Workspace invitations** may be created until membership count is brought within the current plan or billing is restored.
- A **Plan member limit** overage still allows accepted **Workspace members** to access the frontend, but blocks new Document submission through both session and **Workspace API key** access.
- **Workspace API key** generation requires paid API access entitlement and is unavailable on the **Free plan** or in **Unpaid billing state**.
- **Workspace API keys** may authenticate product API access only when the **Workspace** has active API access entitlement.
- **Purchased Credits** do not grant API access entitlement.
- Losing API access entitlement preserves existing **Workspace API keys** but product API requests using them are rejected until entitlement returns.
- API access entitlement failures should be reported as entitlement errors rather than invalid **Workspace API key** authentication.
- Billing entitlements and **Plan limit overage** checks apply the same way to session-authenticated requests and **Workspace API key** requests.
- A failed validation or queueing failure before an **Extraction job** is accepted does not spend **Credits**.
- A failed **Extraction job** keeps its spent **Credits** unless the failure is later classified as a platform fault and intentionally refunded.
- Initial **Application admin** access is bootstrapped by a one-time migration that promotes known Better Auth users to the persisted Application admin role.
- **Application admin page** visibility is based on persisted application role in the authenticated session.
- Better Auth application role is single-valued: a user is either `user` or `admin` in the application-wide auth context.
- Better Auth admin plugin account fields are added through an explicit forward migration, including a safe one-time promotion of known bootstrap users when those users exist.
- Better Auth's persisted application role field remains unconstrained in the database; single-role `user`/`admin` semantics are enforced by application behavior.
- Better Auth synthetic user responses include admin plugin fields so email-verification flows do not expose a different user shape from real account records.
- The first **Application admin** capability set includes listing users, searching users, changing application roles, banning/unbanning users with reasons, and impersonating non-admin users.
- The first **Application admin** capability set does not include deleting users, creating users, setting passwords, or manually revoking sessions.
- The first **Application admin** capability set does not include editing user names or account email addresses.
- The first **Application admin** capability set does not include Workspace membership summaries or Workspace data management.
- The first **Application admin** capability set uses Better Auth admin utilities directly rather than custom product `/v1/admin/*` routes.
- The first **Application admin** capability set does not introduce custom audit logging for admin actions.
- Better Auth admin endpoints are served by the existing `/api/auth/*` Better Auth handler delegation, not custom product routing.
- Backend coverage for **Application admin** setup verifies Better Auth admin plugin configuration rather than Better Auth endpoint internals.
- **Application admins** may impersonate regular users, but may not impersonate other **Application admins**.
- Banning a user through **Application admin** account management blocks that user's account sessions and future sign-in, but does not automatically delete Workspace memberships or rotate Workspace API keys.
- The first **Application admin** ban flow creates permanent bans with required reasons; temporary ban duration is not exposed.
- **Application admin** role changes require confirmation, with stronger confirmation language when removing Application admin authority.
- An **Application admin** cannot demote their own application role in the first admin capability set.
- An **Application admin** cannot ban their own account in the first admin capability set.
- An **Application admin** may ban another Application admin with explicit confirmation.
- Unbanning a user through **Application admin** account management requires confirmation that shows the user's email and existing ban reason.
- **Application admin** role changes do not trigger custom session invalidation in the first admin capability set.
- Starting impersonation requires confirmation that identifies the target user.
- An **Application admin** cannot impersonate their own account.
- Banned users are not eligible impersonation targets until unbanned.
- Banned users receive Better Auth's default banned-user sign-in message.
- A personal **Workspace** is created only after **Account email verification** gives the user account access, not when an unverified email/password account is first registered.
- Personal **Workspace** creation after **Account email verification** is idempotent; users who already have accepted **Workspace membership** do not receive another personal **Workspace**.
- Pending **Workspace invitations** do not suppress personal **Workspace** creation after **Account email verification**.
- A **Workspace invitation** is not workspace access until accepted.
- **Workspace invitations** are in-app invitations; outbound email is outside the current invitation lifecycle.
- Use `cancelled` for a **Workspace invitation** that ended without acceptance, including when the invitee declines it.
- Invitee decline and owner/admin cancellation are separate actions with different authorization paths, but both make the invitation `cancelled`.
- Only workspace owners and admins may see or cancel pending **Workspace invitations** sent from a **Workspace**.
- A workspace owner/admin should confirm before cancelling someone else's pending **Workspace invitation**.
- A **Workspace invitation** remains valid after inviter role changes or inviter departure unless it is cancelled or expires.
- Deleting a **Workspace** deletes its **Workspace invitations**.
- **Workspace invitation management** shows actionable pending invitations, not accepted, cancelled, or expired invitation history.
- Invitees should see inviter identity, offered role, invited email, invited time, and expiry before accepting a **Workspace invitation**.
- Only actionable pending **Workspace invitations** should appear in an invitee's workspace list; expired invitations are hidden from that list.
- Invitees accept or decline a **Workspace invitation** from the invitation detail view, not directly from the workspace list.
- Invitees do not need a confirmation prompt when declining their own **Workspace invitation**.
- A current workspace member should not also have a pending **Workspace invitation** for the same **Workspace**.
- Accepting a **Workspace invitation** must not overwrite an existing **Workspace membership** or change its role.
- **Workspace invitations** match the invitee by the account's current email address; account email is not user-editable.
- A signed-in user must always have at least one accepted **Workspace** after sign-up or first login.
- A user cannot delete their only accepted **Workspace**.
- If the accepted **Workspace** invariant is broken, the backend owns repairing it; clients must not create a replacement through the normal user-facing create-workspace flow.
- `GET /v1/workspaces` repairs a broken zero-accepted-Workspace invariant by creating a personal **Workspace** through the same bootstrap path used for first login.
- Pending **Workspace invitations** do not satisfy the accepted **Workspace** invariant.
- A workspace owner/admin may remove another user's **Workspace membership** even if that was the target user's last accepted **Workspace**; the target user's invariant is repaired when they next list their Workspaces.
- Removing another user's **Workspace membership** does not immediately create that user's replacement personal **Workspace**.
- Accepted **Workspace** IDs are backend-owned; clients must not invent default or fallback workspace IDs.
- When a client needs a replacement accepted **Workspace context**, it should use the first accepted **Workspace** returned by the backend workspace list.
- The SPA uses the signed-in user session plus accepted **Workspace context** for workspace-scoped requests; **Workspace API keys** are for external API clients.
- **Workspace API keys** may be generated and shown to workspace owners/admins for external clients, but they are not SPA authentication credentials.
- **Workspace API keys** authenticate external clients for workspace-scoped product routes such as templates, extraction jobs, and document submission.
- **Workspace API keys** currently have the same access as accepted Workspace context on workspace-scoped product routes.
- **Workspace API keys** do not authenticate user/session-only routes such as profile, workspace membership, invitations, workspace deletion, or API key generation.
- **Workspace API keys** do not create browser sessions or authenticate access to the SPA shell.
- **Workspace API key** material is visible only immediately after creation or rotation because the backend stores only a hash.
- **Workspace API key format** is opaque to users and clients beyond being passed as a bearer token.
- **Workspace API key** lookup is **Workspace control data** so external clients do not need to provide Workspace context before authentication.
- **Workspace control data** includes account/session records, Workspace records, Workspace memberships, Workspace invitations, and Workspace API key lookup.
- **Workspace control data** includes Stripe customer, subscription, invoice references, active entitlement summaries, scheduled billing changes, no-billing state, **Plan overrides**, Enterprise deal metadata, and processed **Stripe billing event** records.
- **Workspace product data** includes Templates, Template fields and versions, Extraction jobs, Extraction results, and Source file metadata.
- **Workspace product data** includes Source file metadata, not Source file binary contents.
- Deleting a **Workspace** hard-erases its authoritative **Workspace product data** and associated **Source file** binary contents.
- **Workspace** deletion wins over in-flight **Extraction processing**; late background work must not recreate hard-erased **Workspace product data**.
- Cross-workspace summaries of **Workspace product data** are rebuildable read models, not the authority for workspace-scoped product APIs.
- Workspace-scoped product API responses must come from authoritative **Workspace product data**, not from cross-workspace projections.
- The first Workspace product data scale-out does not introduce a global D1 projection of **Workspace product data**.
- The first Workspace product data scale-out does not require automated migration of existing **Workspace product data**.
- The current scale model optimizes for many Workspaces across the application, not one Workspace with unbounded product data.
- Workspace limit configuration is **Workspace control data**.
- Workspace limits that depend on counting Templates, Template fields, Extraction jobs, or Extraction results are enforced against authoritative **Workspace product data**.
- Workspace membership and **Workspace API key** authorization are checked against **Workspace control data** before routing to authoritative **Workspace product data**.
- **Workspace product analytics** may include stable product identifiers such as Workspace ID, Template ID, and Extraction job ID when needed for aggregate usage analysis or operational debugging.
- **Workspace product analytics** must not include extracted answers, evidence text, Source file names, account emails, API keys, or Document contents.
- **Workspace product analytics** is not authoritative **Workspace product data** and is not part of Workspace deletion hard-erasure.
- **Workspace live updates** notify clients about **Extraction job lifecycle** changes after authoritative **Workspace product data** has been persisted.
- **Workspace live updates** cover all **Extraction job lifecycle** changes for the accepted **Workspace context**, not only the currently selected Extraction job.
- **Workspace context invalidation** events are freshness hints, not a source of computed Workspace state.
- **Workspace context invalidation** events carry a reason code and occurrence timestamp so clients can revalidate accepted **Workspace context** over HTTP.
- **Workspace live updates** are not durable history; clients revalidate authoritative **Workspace product data** and accepted **Workspace context** after reconnecting.
- The first **Workspace live update** capability is session-only for the SPA; Workspace API keys do not open live update connections.
- **Workspace live updates** use a versioned batch message envelope.
- **Extraction job lifecycle** live update events must not include extracted answers, evidence text, Source file binary contents, account emails, API keys, or Document contents.
- **Workspace context invalidation** live update events must not include computed **Billing operational status**, remaining Credits, remaining Plan page capacity, Stripe details, account identity, API keys, extracted answers, evidence text, Source file binary contents, or Document contents.
- Creating a **Workspace** and generating a **Workspace API key** are separate user intents.
- `POST /v1/workspaces` returns the new accepted **Workspace context** with `has_api_key: false` and no **Workspace API key** secret.
- First-login Workspace bootstrap creates the accepted **Workspace** and starter template, not visible external-client **Workspace API key** material.
- A new or bootstrapped **Workspace** starts without an external-client **Workspace API key** until an owner/admin explicitly generates one.
- Existing silently generated workspace key hashes are treated as not being external-client **Workspace API keys** during migration.
- Workspace listing or detail responses may expose whether a **Workspace API key** exists, but never expose existing key material.
- `/v1/workspaces` includes whether each accepted **Workspace** has an external-client **Workspace API key**.
- `POST /v1/workspaces/:id/api-key` issues a new one-time **Workspace API key** secret and replaces any existing key hash.
- `POST /v1/workspaces/:id/api-key` returns the one-time **Workspace API key** secret and `has_api_key: true`.
- Workspace owners/admins may generate or rotate **Workspace API keys**; members may not.
- **Leave Workspace** does not delete the **Workspace**, its documents, invitations, API key, or other members.
- **Leave Workspace** is performed by a signed-in workspace member, not by a workspace API key.
- Workspace owners delete workspaces rather than leave them.
- If **Leave Workspace** would remove a user's last accepted **Workspace**, create a **Replacement personal Workspace** for that user.
- A **Replacement personal Workspace** uses the same starter-template bootstrap as a new-user workspace.
- A **Replacement personal Workspace** response includes `has_api_key: false` and no **Workspace API key** secret.
- After **Leave Workspace**, the user moves into another accepted **Workspace context**, preferring the **Replacement personal Workspace** when one was created.
- A workspace member should confirm before leaving a **Workspace**.
- **Template object schema** defines expected columns, column order, data types, and extraction guidance for fields whose data type is `object` or `array<object>`.
- **Template object schema** should be normalized, validated, encoded for model guidance, decoded for editing, and rendered through one domain module.
- **Template fields** are always requested during extraction; the public Template contract does not distinguish required and optional fields.
- A **Source file** may be an image or PDF, but the product term for the submitted item is **Document**.
- Document submission must use the `document` multipart field; legacy `image` and generic `file` submission fields are not accepted or advertised.
- Application-owned configuration, storage binding, and database names should use **Document** or **Source file** terminology rather than legacy `image` terminology.
- Persisted extraction job source metadata should be named with **Source file** terminology and should not expose legacy `image` API response aliases.
- Historical migration files remain immutable; legacy `image` schema names should be removed through forward migrations only.
- Standard MIME types, generated files, and required platform API vocabulary may retain `image` where that word is part of the external standard or platform contract.
- Use **Document** synonymously for supported source formats, including PNG, JPEG, WebP, and PDF, unless a standards-level MIME type must be named.
- The background workflow that processes submitted **Documents** should be named `documentProcessingWorkflow` in application-owned code.
- R2 storage for **Source files** should use non-legacy **Document** or **Source file** naming for both Worker bindings and physical bucket names.
- R2 remains the authoritative binary store for **Source files**.
- A **Source file page count** applies only to PDF **Source files** and is absent for non-PDF **Source files**.
- PDF **Source files** require a **Source file page count** at Document submission time; if the count cannot be determined, the Document submission is rejected.
- A **Source file page count** is internal Source file metadata until a product feature requires exposing or enforcing it.
- Existing **Source files** are not backfilled with a **Source file page count** because their original binary may already have been cleaned up.
- The product/API label is **Document Extraction**, not legacy Image Extraction.
- Cloudflare Workflow retry steps, not **Extraction job** status values, own retryability for transient processing failures.
- Do not model retryability with a durable `retryable_failed` **Extraction job** status.
- The durable **Extraction job lifecycle** states are `queued`, `processing`, `completed`, and `failed`.
- Authoritative **Extraction job lifecycle** state belongs to **Workspace product data**.
- The **Extraction processor** performs long-running extraction work but does not own authoritative **Extraction job lifecycle** state.
- Cloudflare Workflow instance details are implementation metadata, not durable **Extraction job lifecycle** states.
- After Cloudflare Workflow receives an AI gateway response, **Extraction results** should be persisted and the **Extraction job** should be marked `completed`.
- A completed **Extraction job** should not retain its **Source file** binary after processing cleanup succeeds.
- If queuing an **Extraction processor** fails during Document submission, the **Extraction job** is marked `failed` and the uploaded **Source file** is deleted.
- **Workspace** deletion cleanup sweeps residual **Source files** that normal **Extraction job lifecycle** cleanup did not delete.
- A **Template** must have at least one **Template field** before it can be used for extraction.
- Changing **Template fields** creates a new **Template version**.
- An **Extraction job** is interpreted against the **Template version** selected at submission time.
- An **Extraction result** may include confidence and evidence when requested.
- Authoritative **Template** existence, status, current version, field count, version creation, and deletion checks belong to **Workspace product data**.

## Relationships

- A **Workspace invitation** may be displayed beside **Workspaces**, but it does not create **Workspace membership** until accepted.
- Accepted **Workspaces** appear before invited workspace entries; invited entries are ordered by latest update first.
- Current workspace members and pending **Workspace invitations** are separate access-management lists.
- Accepting a **Workspace invitation** creates **Workspace membership** and moves the user into **Accepted workspace context**.
- Declining a **Workspace invitation** makes it non-actionable and removes it from the invitee's workspace list.
- A **Workspace member action** may remove a member, make a member an admin, or transfer workspace ownership to a member.
- **Leave Workspace** removes a non-owner member's **Workspace membership** without deleting the **Workspace**.
- **Leave Workspace** creates a **Replacement personal Workspace** when it removes the user's last accepted **Workspace**.
- A **Pending workspace invitation context** is locked until the **Workspace invitation** is accepted or declined.
- **Workspace control data** identifies which **Workspace product data** a user or **Workspace API key** may access.
- **Workspace product data** belongs to exactly one **Workspace**.
- A deleted **Workspace** has no remaining authoritative **Workspace product data**.
- In-flight **Extraction processing** for a deleted **Workspace** may finish externally, but it has no **Extraction job lifecycle** state to update after hard-erasure.
- A **Document** has exactly one **Source file** at submission time.
- A **Document** submitted with a **Template** creates one **Extraction job**.
- An **Extraction job lifecycle** is coordinated by authoritative **Workspace product data** and executed by an **Extraction processor** after the **Extraction job** is queued.
- A **Template** has one or more **Template fields**.
- A **Template** has one or more **Template versions**.
- A **Template field** may have a **Template object schema** when its data type is `object` or `array<object>`.
- An **Extraction job** belongs to exactly one **Template version**.
- A completed **Extraction job** has one **Extraction result** per extracted **Template field**.

## Example Dialogue

> **Dev:** "If a user selects an invited workspace, can we treat it as the active workspace for API calls?"
> **Domain expert:** "No. It is a **Pending workspace invitation context** until accepted, so it can show invitation details but must not enable workspace API access."

## Flagged Ambiguities

- "group" was used to describe what a user leaves; resolved: the domain term is **Workspace**, and access is represented by **Workspace membership**.
- "user status" was used for workspace access management; resolved: the domain term is **Workspace member action**.
- "workspace state" can mean backend access, local persistence, or UI presentation; resolved: use **Workspace context** for backend access context and **Workspace selection view** for the frontend UI concept.
- Legacy `image` terminology was used for earlier document submission, but the resolved product term is **Document** because source files can include PDFs as well as images; use **Source file** when referring to the original submitted binary.
