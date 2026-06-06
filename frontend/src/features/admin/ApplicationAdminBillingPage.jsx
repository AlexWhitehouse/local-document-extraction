import React, { useMemo, useState } from "react";

const BILLING_FLOWS = [
  {
    id: "inspect-state",
    title: "Inspect Billing State",
    eyebrow: "Read only",
    description: "Find a Workspace and review entitlement, exceptions, reconciliation, and audit history.",
    submitLabel: "Done",
  },
  {
    id: "plan-override",
    title: "Plan Override",
    eyebrow: "Plan",
    description: "Grant a temporary Free, Pro, or Max entitlement, optionally requiring payment first.",
    submitLabel: "Create Plan Override",
    notesLabel: "Override reason",
    notesValue: (admin) => admin.planOverrideReason,
    onNotesChange: (admin, value) => admin.onPlanOverrideReasonChange(value),
    submit: (admin, event) => admin.onCreatePlanOverride(event),
  },
  {
    id: "enterprise-terms",
    title: "Enterprise Terms",
    eyebrow: "Enterprise",
    description: "Define optional ramp-up terms and optional annual Enterprise commitment in one guided flow.",
    submitLabel: "Create Enterprise Terms",
    notesLabel: "Enterprise terms reason",
    notesValue: (admin) => admin.enterpriseAgreementReason,
    onNotesChange: (admin, value) => admin.onEnterpriseAgreementReasonChange(value),
    submit: (admin, event) => admin.onCreateEnterpriseTerms(event),
  },
  {
    id: "goodwill-credit-grant",
    title: "Grant Goodwill Credits",
    eyebrow: "Credits",
    description: "Apply a manual support credit grant to the selected Workspace ledger.",
    submitLabel: "Grant Goodwill Credits",
    notesLabel: "Grant reason",
    notesValue: (admin) => admin.grantReason,
    onNotesChange: (admin, value) => admin.onGrantReasonChange(value),
    submit: (admin, event) => admin.onGrantGoodwillCredits(event),
  },
  {
    id: "no-billing-mode",
    title: "Edit No-Billing Mode",
    eyebrow: "Exception",
    description: "Set whether a Workspace uses the Enterprise limit profile without billing collection.",
    submitLabel: "Save No-Billing Mode",
    notesLabel: "No-billing reason",
    notesValue: (admin) => admin.noBillingReason,
    onNotesChange: (admin, value) => admin.onNoBillingReasonChange(value),
    submit: (admin, event) => admin.onEditNoBillingMode(event),
  },
  {
    id: "goodwill-credit-revoke",
    title: "Revoke Goodwill Grant",
    eyebrow: "Credits",
    description: "Reverse an unspent manual Goodwill Credit grant from the Workspace ledger.",
    submitLabel: "Revoke Goodwill Grant",
    notesLabel: "Revocation reason",
    notesValue: (admin) => admin.revokeReason,
    onNotesChange: (admin, value) => admin.onRevokeReasonChange(value),
    submit: (admin, event) => admin.onRevokeGoodwillCreditGrant(event),
    isDanger: true,
  },
];

export function ApplicationAdminBillingPage({ admin }) {
  const [activeFlowId, setActiveFlowId] = useState("");
  const activeFlow = useMemo(
    () => BILLING_FLOWS.find((flow) => flow.id === activeFlowId) || null,
    [activeFlowId],
  );

  function openFlow(flowId) {
    admin.onClearBillingFeedback?.();
    setActiveFlowId(flowId);
  }

  function closeFlow() {
    setActiveFlowId("");
  }

  return (
    <>
      <section className="content-grid admin-billing-actions-page">
        <div className="admin-billing-flow-grid" aria-label="Application admin billing actions">
          {BILLING_FLOWS.map((flow) => (
            <button
              key={flow.id}
              type="button"
              className={`admin-billing-flow-card${flow.isDanger ? " danger" : ""}`}
              onClick={() => openFlow(flow.id)}
            >
              <span>{flow.eyebrow}</span>
              <strong>{flow.title}</strong>
              <small>{flow.description}</small>
            </button>
          ))}
        </div>

        {admin.billingError ? (
          <p className="form-error" role="alert">{admin.billingError}</p>
        ) : null}
      </section>

      {activeFlow ? (
        <BillingFlowDialog
          key={activeFlow.id}
          admin={admin}
          flow={activeFlow}
          onClose={closeFlow}
        />
      ) : null}
    </>
  );
}

function BillingStateReview({ state }) {
  const reconciliationCheckedAt = formatReconciliationCheckedAt(state?.reconciliation?.last_checked_at);
  const stripeEventDiagnostics = state?.stripe_event_diagnostics;
  const recentStripeEvents = stripeEventDiagnostics?.recent_events || [];
  const selfServiceSubscription = state?.self_service_subscription;
  const subscriptionFailureMeta = formatSubscriptionInvoiceFailureMeta(
    selfServiceSubscription?.invoice?.finalization_failure,
  );

  return (
    <>
      {state ? (
        <>
          <div className="admin-billing-state-summary">
            <span className="status-chip">
              Active Plan {safeText(state.active_entitlement?.display_name)}
            </span>
            <span className="status-chip">
              No-billing {state.no_billing_mode?.enabled ? "enabled" : "disabled"}
            </span>
            {selfServiceSubscription ? (
              <span className="status-chip">
                Self-service {formatPlanName(selfServiceSubscription.plan)} invoice {formatStatusLabel(selfServiceSubscription.invoice?.status || selfServiceSubscription.status)}
              </span>
            ) : null}
            {state.plan_override ? (
              <span className="status-chip">
                Override {formatPlanName(state.plan_override.plan)}
              </span>
            ) : null}
            {state.payment_required_plan_override ? (
              <span className="status-chip">
                Payment-required {formatPlanName(state.payment_required_plan_override.plan)} invoice {safeText(state.payment_required_plan_override.invoice?.status)}
              </span>
            ) : null}
            {state.enterprise_ramp_up ? (
              <span className="status-chip">
                Enterprise ramp-up {formatStatusLabel(state.enterprise_ramp_up.status)}
              </span>
            ) : null}
            {state.enterprise_annual_commitment ? (
              <>
                <span className="status-chip">
                  Enterprise annual {formatStatusLabel(state.enterprise_annual_commitment.status)}
                </span>
                <span className="status-chip">
                  Annual upfront invoice {formatStatusLabel(state.enterprise_annual_commitment.upfront_invoice?.status)}
                </span>
                {state.enterprise_annual_commitment.latest_overage_invoice ? (
                  <span className="status-chip">
                    Annual overage invoice {formatStatusLabel(state.enterprise_annual_commitment.latest_overage_invoice?.status)}
                  </span>
                ) : null}
              </>
            ) : null}
            {state.reconciliation ? (
              <>
                {reconciliationCheckedAt ? (
                  <span className="status-chip">
                    Reconciliation checked {reconciliationCheckedAt}
                  </span>
                ) : null}
                <span className="status-chip">
                  Open drift {Number(state.reconciliation.open_drift_count || 0)}
                </span>
              </>
            ) : null}
            {stripeEventDiagnostics ? (
              <>
                <span className="status-chip">
                  Failed Stripe events {Number(stripeEventDiagnostics.failed_event_count || 0)}
                </span>
                {Number(stripeEventDiagnostics.payment_failed_event_count || 0) > 0 ? (
                  <span className="status-chip">
                    Payment failed events {Number(stripeEventDiagnostics.payment_failed_event_count || 0)}
                  </span>
                ) : null}
                {Number(stripeEventDiagnostics.ignored_event_count || 0) > 0 ? (
                  <span className="status-chip">
                    Ignored Stripe events {Number(stripeEventDiagnostics.ignored_event_count || 0)}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>

          {state.reconciliation?.drift_records?.length ? (
            <div className="admin-billing-reconciliation-list">
              {state.reconciliation.drift_records.map((record) => (
                <div className="admin-billing-reconciliation-item" key={record.id}>
                  <strong>{safeText(record.drift_type)}</strong>
                  <span>{safeText(record.related_stripe_object_id)}</span>
                  <span>{safeText(record.actionability)}</span>
                </div>
              ))}
            </div>
          ) : null}

          {subscriptionFailureMeta.length ? (
            <div className="admin-billing-reconciliation-list">
              <div className="workspace-head">
                <h3>Subscription invoice diagnostics</h3>
              </div>
              {subscriptionFailureMeta.map((item) => (
                <div className="admin-billing-reconciliation-item" key={item}>
                  <strong>{item}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {recentStripeEvents.length ? (
            <div className="admin-billing-reconciliation-list">
              <div className="workspace-head">
                <h3>Stripe event diagnostics</h3>
              </div>
              {recentStripeEvents.map((event) => (
                <div className="admin-billing-reconciliation-item" key={event.event_id}>
                  <strong>{safeText(event.type)}</strong>
                  <span>{safeText(event.related_stripe_object_id)}</span>
                  <span>{safeText(event.failure_class || event.outcome)}</span>
                  {event.retry_guidance ? <span>{safeText(event.retry_guidance)}</span> : null}
                  {event.manual_review_guidance ? <span>{safeText(event.manual_review_guidance)}</span> : null}
                </div>
              ))}
            </div>
          ) : null}

          {state.audit_entries?.length ? (
            <div className="admin-billing-audit-list">
              <div className="workspace-head">
                <h3>Application admin billing audit</h3>
                <p>Admin-only billing changes with actor, reason, and summarized state.</p>
              </div>
              <div className="admin-billing-audit-scroll">
                {state.audit_entries.map((entry) => (
                  <div className="admin-billing-audit-item" key={entry.id || `${entry.action}-${entry.occurred_at}`}>
                    <div className="admin-billing-audit-primary">
                      <strong>{formatBillingAuditAction(entry.action)}</strong>
                      <span>{formatUtcDateTime(entry.occurred_at)}</span>
                    </div>
                    <AuditFact label="Actor" value={formatBillingAuditActor(entry)} />
                    <AuditFact label="Reason" value={safeText(entry.reason)} />
                    <AuditFact label="Previous state" value={summarizeBillingAuditSnapshot(entry.before, "before")} />
                    <AuditFact label="New state" value={summarizeBillingAuditSnapshot(entry.after, "after")} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="admin-billing-empty-state">
          <strong>No billing state loaded</strong>
          <span>Find and select a Workspace to load current billing context.</span>
        </div>
      )}
    </>
  );
}

function AuditFact({ label, value }) {
  return (
    <span className="admin-billing-audit-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function BillingFlowDialog({ admin, flow, onClose }) {
  const [stepIndex, setStepIndex] = useState(0);
  const steps = getFlowSteps(flow);
  const isLastStep = stepIndex === steps.length - 1;
  const canContinue = canContinueBillingFlow(flow, admin, stepIndex);
  const selectedWorkspace = admin.billingSelectedWorkspace;
  const titleId = `admin-billing-flow-${flow.id}-title`;

  async function submitFlow(event) {
    event.preventDefault();
    if (!isLastStep) {
      setStepIndex((current) => Math.min(current + 1, steps.length - 1));
      return;
    }
    if (flow.id === "inspect-state") {
      onClose();
      return;
    }
    const didComplete = await flow.submit?.(admin, event);
    if (didComplete) {
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal-card admin-billing-flow-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onSubmit={submitFlow}
      >
        <div className="admin-billing-flow-modal-head">
          <div>
            <p className="eyebrow">{flow.eyebrow}</p>
            <h2 id={titleId}>{flow.title}</h2>
            <p>{flow.description}</p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <ol className="admin-billing-stepper" aria-label="Billing flow steps">
          {steps.map((step, index) => (
            <li
              key={step}
              className={index === stepIndex ? "active" : index < stepIndex ? "complete" : ""}
            >
              <span>{index + 1}</span>
              <strong>{step}</strong>
            </li>
          ))}
        </ol>

        <div className="admin-billing-flow-step">
          {renderBillingFlowStep({ admin, flow, selectedWorkspace, stepIndex })}
        </div>

        {admin.billingWorkspaceSearchError ? (
          <p className="form-error" role="alert">{admin.billingWorkspaceSearchError}</p>
        ) : null}
        {admin.billingError ? (
          <p className="form-error" role="alert">{admin.billingError}</p>
        ) : null}

        <div className="actions compact admin-billing-flow-actions">
          <button
            type="button"
            className="secondary"
            disabled={stepIndex === 0 || admin.isBillingMutating}
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
          >
            Back
          </button>
          <button
            type="submit"
            className={flow.isDanger && isLastStep ? "danger" : ""}
            disabled={!canContinue || admin.isBillingLoading || admin.isBillingMutating}
          >
            {admin.isBillingMutating
              ? "Working..."
              : isLastStep
                ? flow.submitLabel
                : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}

function WorkspaceSearchStep({ admin, selectedWorkspace }) {
  function handleSearchKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      admin.onSearchBillingWorkspaces(event);
    }
  }

  return (
    <div className="admin-billing-workspace-step">
      <div className="admin-billing-workspace-search">
        <label>
          Search field
          <select
            value={admin.billingWorkspaceSearchField}
            onChange={(event) => admin.onBillingWorkspaceSearchFieldChange(event.target.value)}
          >
            <option value="workspace_id">Workspace ID</option>
            <option value="owner_email">Owner email</option>
          </select>
        </label>
        <label>
          Workspace search
          <input
            value={admin.billingWorkspaceSearchInput}
            placeholder={admin.billingWorkspaceSearchField === "owner_email" ? "owner@example.com" : "workspace_..."}
            onChange={(event) => admin.onBillingWorkspaceSearchInputChange(event.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
        </label>
        <button
          type="button"
          className="secondary"
          disabled={admin.isBillingWorkspaceSearching}
          onClick={admin.onSearchBillingWorkspaces}
        >
          {admin.isBillingWorkspaceSearching ? "Searching..." : "Search Workspaces"}
        </button>
      </div>

      {admin.billingWorkspaceSearchResults.length ? (
        <div className="admin-billing-workspace-results">
          {admin.billingWorkspaceSearchResults.map((workspace) => {
            const workspaceId = String(workspace.id || workspace.workspace_id || "").trim();
            const isSelected = workspaceId && workspaceId === String(admin.billingWorkspaceId || "").trim();
            return (
              <button
                key={workspaceId}
                type="button"
                className={isSelected ? "admin-billing-workspace-result active" : "admin-billing-workspace-result"}
                aria-label={`Select workspace ${workspaceId}`}
                onClick={() => admin.onSelectBillingWorkspace(workspace)}
              >
                <strong>{safeText(workspace.name || workspaceId)}</strong>
                <span>{safeText(workspaceId)}</span>
                <span>Owner {safeText(workspace.owner_email)}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {admin.billingWorkspaceId ? (
        <div className="admin-billing-selected-workspace">
          <span className="status-chip good">Workspace selected</span>
          <div>
            <strong>{safeText(selectedWorkspace?.name || admin.billingWorkspaceId)}</strong>
            <span>{safeText(admin.billingWorkspaceId)}</span>
            {selectedWorkspace?.owner_email ? <span>Owner {safeText(selectedWorkspace.owner_email)}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderBillingFlowStep({ admin, flow, selectedWorkspace, stepIndex }) {
  if (stepIndex === 0) {
    return <WorkspaceSearchStep admin={admin} selectedWorkspace={selectedWorkspace} />;
  }
  if (flow.id === "inspect-state") {
    return <BillingFlowInspectStep admin={admin} />;
  }
  if (flow.id === "enterprise-terms") {
    if (stepIndex === 1) {
      return <BillingFlowEnterpriseRampUpStep admin={admin} />;
    }
    if (stepIndex === 2) {
      return <BillingFlowEnterpriseAnnualStep admin={admin} />;
    }
    return <BillingFlowNotesStep admin={admin} flow={flow} />;
  }
  if (stepIndex === 1) {
    return <BillingFlowTermsStep admin={admin} flow={flow} />;
  }
  return <BillingFlowNotesStep admin={admin} flow={flow} />;
}

function BillingFlowTermsStep({ admin, flow }) {
  if (flow.id === "plan-override") {
    return (
      <div className="admin-billing-flow-fields">
        <label>
          Plan override target
          <select
            value={admin.planOverrideTarget}
            onChange={(event) => admin.onPlanOverrideTargetChange(event.target.value)}
          >
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="max">Max</option>
          </select>
        </label>
        <label>
          Override start date
          <input
            type="date"
            value={toDateValue(admin.planOverrideStart)}
            onChange={(event) => admin.onPlanOverrideStartChange(event.target.value)}
          />
        </label>
        <label>
          Override duration months
          <input
            type="number"
            min="1"
            step="1"
            value={admin.planOverrideDurationMonths}
            onChange={(event) => admin.onPlanOverrideDurationMonthsChange(event.target.value)}
          />
        </label>
        <p className="muted admin-billing-flow-wide-field">
          Derived end date {safeText(admin.planOverrideDerivedEnd)}
        </p>
        <label className="admin-billing-checkbox-field admin-billing-flow-wide-field">
          <input
            type="checkbox"
            checked={admin.planOverridePaymentRequired}
            onChange={(event) => admin.onPlanOverridePaymentRequiredChange(event.target.checked)}
          />
          Require payment before activation
        </label>
        {admin.planOverridePaymentRequired ? (
          <>
            <label>
              Payment-required amount (GBP)
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={admin.paymentRequiredOverrideAmount}
                onChange={(event) => admin.onPaymentRequiredOverrideAmountChange(event.target.value)}
              />
            </label>
            <label>
              Invoice payment method
              <select
                value={admin.paymentRequiredOverrideCollection}
                onChange={(event) => admin.onPaymentRequiredOverrideCollectionChange(event.target.value)}
              >
                <option value="automatic">Auto-charge saved payment method</option>
                <option value="manual">Send invoice</option>
              </select>
            </label>
          </>
        ) : null}
      </div>
    );
  }

  if (flow.id === "no-billing-mode") {
    return (
      <div className="admin-billing-flow-fields">
        <label className="admin-billing-checkbox-field admin-billing-flow-wide-field">
          <input
            type="checkbox"
            checked={admin.noBillingEnabled}
            onChange={(event) => admin.onNoBillingEnabledChange(event.target.checked)}
          />
          No-billing mode enabled
        </label>
        <div className="admin-billing-flow-note admin-billing-flow-wide-field">
          <strong>{admin.noBillingEnabled ? "No-billing will be enabled" : "No-billing will be disabled"}</strong>
          <span>
            {admin.noBillingEnabled
              ? "The Workspace will use the Enterprise limit profile without collecting billing."
              : "Billing control will return to normal entitlement rules."}
          </span>
        </div>
      </div>
    );
  }

  if (flow.id === "goodwill-credit-grant") {
    return (
      <div className="admin-billing-flow-fields">
        <label>
          Goodwill Credits
          <input
            type="number"
            min="1"
            step="1"
            value={admin.goodwillCredits}
            onChange={(event) => admin.onGoodwillCreditsChange(event.target.value)}
          />
        </label>
      </div>
    );
  }

  if (flow.id === "goodwill-credit-revoke") {
    return (
      <div className="admin-billing-flow-fields">
        <label>
          Goodwill grant ID
          <input
            value={admin.revokeGrantId}
            onChange={(event) => admin.onRevokeGrantIdChange(event.target.value)}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="admin-billing-flow-note">
      <strong>{flow.title}</strong>
      <span>This action only needs a selected Workspace and an application-admin note.</span>
    </div>
  );
}

function BillingFlowEnterpriseRampUpStep({ admin }) {
  return (
    <div className="admin-billing-flow-fields">
      <label className="admin-billing-checkbox-field admin-billing-flow-wide-field">
        <input
          type="checkbox"
          checked={admin.enterpriseRampUpIncluded}
          onChange={(event) => admin.onEnterpriseRampUpIncludedChange(event.target.checked)}
        />
        Include Enterprise ramp-up
      </label>
      {admin.enterpriseRampUpIncluded ? (
        <>
          <label>
            Enterprise ramp-up billing cycle start
            <input
              type="month"
              value={toMonthValue(admin.enterpriseRampUpCycleStart)}
              onChange={(event) => admin.onEnterpriseRampUpCycleStartChange(event.target.value)}
            />
          </label>
          <label>
            Enterprise ramp-up duration months
            <input
              type="number"
              min="1"
              step="1"
              value={admin.enterpriseRampUpDurationMonths}
              onChange={(event) => admin.onEnterpriseRampUpDurationMonthsChange(event.target.value)}
            />
          </label>
          <label>
            Enterprise ramp-up collection
            <select
              value={admin.enterpriseRampUpCollection}
              onChange={(event) => admin.onEnterpriseRampUpCollectionChange(event.target.value)}
            >
              <option value="manual">Manual</option>
              <option value="automatic">Automatic</option>
            </select>
          </label>
          <label className="admin-billing-checkbox-field">
            <input
              type="checkbox"
              checked={admin.enterpriseRampUpInvoiceReviewEnabled}
              onChange={(event) => admin.onEnterpriseRampUpInvoiceReviewEnabledChange(event.target.checked)}
            />
            Review ramp-up invoices before finalization
          </label>
        </>
      ) : (
        <div className="admin-billing-flow-note admin-billing-flow-wide-field">
          <strong>No ramp-up selected</strong>
          <span>Continue to define whether this Workspace also needs an annual Enterprise commitment.</span>
        </div>
      )}
    </div>
  );
}

function BillingFlowEnterpriseAnnualStep({ admin }) {
  return (
    <div className="admin-billing-flow-fields">
      <label className="admin-billing-checkbox-field admin-billing-flow-wide-field">
        <input
          type="checkbox"
          checked={admin.enterpriseAnnualIncluded}
          onChange={(event) => admin.onEnterpriseAnnualIncludedChange(event.target.checked)}
        />
        Include Enterprise annual commitment
      </label>
      {admin.enterpriseAnnualIncluded ? (
        <>
          <label>
            Annual commitment preset
            <select
              value={admin.enterpriseAnnualPreset}
              onChange={(event) => admin.onEnterpriseAnnualPresetChange(event.target.value)}
            >
              <option value="60000:9">60,000/month at GBP 0.09</option>
              <option value="100000:8">100,000/month at GBP 0.08</option>
              <option value="200000:7">200,000/month at GBP 0.07</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            Annual monthly minimum allowance
            <input
              type="number"
              min="1"
              step="1"
              value={admin.enterpriseAnnualMonthlyMinimumAllowance}
              onChange={(event) => admin.onEnterpriseAnnualMonthlyMinimumAllowanceChange(event.target.value)}
            />
          </label>
          <label>
            Annual per-page price (GBP)
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={admin.enterpriseAnnualPerPagePrice}
              onChange={(event) => admin.onEnterpriseAnnualPerPagePriceChange(event.target.value)}
            />
          </label>
          <label>
            Annual billing cycle start
            <input
              type="month"
              value={toMonthValue(admin.enterpriseAnnualCycleStart)}
              onChange={(event) => admin.onEnterpriseAnnualCycleStartChange(event.target.value)}
            />
          </label>
          <label>
            Annual collection
            <select
              value={admin.enterpriseAnnualCollection}
              onChange={(event) => admin.onEnterpriseAnnualCollectionChange(event.target.value)}
            >
              <option value="manual">Manual</option>
              <option value="automatic">Automatic</option>
            </select>
          </label>
          <label className="admin-billing-checkbox-field">
            <input
              type="checkbox"
              checked={admin.enterpriseAnnualInvoiceReviewEnabled}
              onChange={(event) => admin.onEnterpriseAnnualInvoiceReviewEnabledChange(event.target.checked)}
            />
            Review annual invoices before finalization
          </label>
          <p className="muted admin-billing-flow-wide-field">
            Derived yearly cost {safeText(admin.enterpriseAnnualDerivedYearlyCost)}
          </p>
        </>
      ) : (
        <div className="admin-billing-flow-note admin-billing-flow-wide-field">
          <strong>No annual commitment selected</strong>
          <span>You can still submit ramp-up terms if the previous step is enabled.</span>
        </div>
      )}
    </div>
  );
}

function BillingFlowNotesStep({ admin, flow }) {
  const reviewItems = getFlowReviewItems(flow, admin);
  const notesValue = flow.notesValue?.(admin) || "";

  return (
    <div className="admin-billing-notes-step">
      <dl className="admin-billing-flow-review">
        {reviewItems.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      <label>
        {flow.notesLabel}
        <textarea
          rows={4}
          value={notesValue}
          onChange={(event) => flow.onNotesChange?.(admin, event.target.value)}
        />
      </label>
    </div>
  );
}

function BillingFlowInspectStep({ admin }) {
  return (
    <div className="admin-billing-inspect-step">
      <div className="admin-billing-inspect-head">
        <div>
          <strong>Billing state</strong>
          <span>{safeText(admin.billingWorkspaceId)}</span>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={admin.isBillingLoading || !String(admin.billingWorkspaceId || "").trim()}
          onClick={admin.onLoadBillingState}
        >
          {admin.isBillingLoading ? "Loading..." : "Refresh State"}
        </button>
      </div>
      <BillingStateReview state={admin.billingState} />
    </div>
  );
}

function getFlowSteps(flow) {
  if (flow.id === "inspect-state") {
    return ["Find Workspace", "Review State"];
  }
  if (flow.id === "enterprise-terms") {
    return ["Find Workspace", "Ramp-Up", "Annual", "Add Notes"];
  }
  return ["Find Workspace", "Set Terms", "Add Notes"];
}

function canContinueBillingFlow(flow, admin, stepIndex) {
  if (stepIndex === 0) {
    return Boolean(String(admin.billingWorkspaceId || "").trim());
  }
  if (flow.id === "inspect-state") {
    return Boolean(admin.billingState);
  }
  if (flow.id === "enterprise-terms") {
    if (stepIndex === 1) {
      return !admin.enterpriseRampUpIncluded || areEnterpriseRampUpTermsReady(admin);
    }
    if (stepIndex === 2) {
      return !admin.enterpriseAnnualIncluded || areEnterpriseAnnualTermsReady(admin);
    }
    return Boolean(
      (admin.enterpriseRampUpIncluded || admin.enterpriseAnnualIncluded) &&
      String(flow.notesValue?.(admin) || "").trim(),
    );
  }
  if (stepIndex === 1) {
    return areFlowTermsReady(flow, admin);
  }
  return Boolean(String(flow.notesValue?.(admin) || "").trim());
}

function areFlowTermsReady(flow, admin) {
  if (flow.id === "plan-override") {
    return Boolean(
      admin.planOverrideTarget &&
      admin.planOverrideStart &&
      Number.isInteger(Number(admin.planOverrideDurationMonths)) &&
      Number(admin.planOverrideDurationMonths) > 0 &&
      (!admin.planOverridePaymentRequired ||
        (Number(admin.paymentRequiredOverrideAmount) > 0 && admin.paymentRequiredOverrideCollection)),
    );
  }
  if (flow.id === "no-billing-mode") {
    return true;
  }
  if (flow.id === "goodwill-credit-grant") {
    return Number.isInteger(Number(admin.goodwillCredits)) && Number(admin.goodwillCredits) > 0;
  }
  if (flow.id === "goodwill-credit-revoke") {
    return Boolean(String(admin.revokeGrantId || "").trim());
  }
  return true;
}

function areEnterpriseRampUpTermsReady(admin) {
  return Boolean(
    admin.enterpriseRampUpCycleStart &&
    Number.isInteger(Number(admin.enterpriseRampUpDurationMonths)) &&
    Number(admin.enterpriseRampUpDurationMonths) > 0 &&
    admin.enterpriseRampUpCollection,
  );
}

function areEnterpriseAnnualTermsReady(admin) {
  return Boolean(
    Number(admin.enterpriseAnnualMonthlyMinimumAllowance) > 0 &&
    Number(admin.enterpriseAnnualPerPagePrice) > 0 &&
    admin.enterpriseAnnualCycleStart &&
    admin.enterpriseAnnualCollection,
  );
}

function getFlowReviewItems(flow, admin) {
  const workspaceId = safeText(admin.billingWorkspaceId);
  if (flow.id === "plan-override") {
    const items = [
      { label: "Workspace", value: workspaceId },
      { label: "Plan", value: formatPlanName(admin.planOverrideTarget) },
      { label: "Start date", value: safeText(admin.planOverrideStart) },
      { label: "Duration", value: `${safeText(admin.planOverrideDurationMonths)} months` },
      { label: "Derived end", value: safeText(admin.planOverrideDerivedEnd) },
      { label: "Payment required", value: admin.planOverridePaymentRequired ? "Yes" : "No" },
    ];
    if (admin.planOverridePaymentRequired) {
      items.push(
        { label: "Amount", value: `GBP ${safeText(admin.paymentRequiredOverrideAmount)}` },
        { label: "Invoice payment", value: formatInvoicePaymentMethod(admin.paymentRequiredOverrideCollection) },
      );
    }
    return items;
  }
  if (flow.id === "enterprise-terms") {
    const items = [
      { label: "Workspace", value: workspaceId },
      { label: "Ramp-up", value: admin.enterpriseRampUpIncluded ? "Included" : "Not included" },
      { label: "Annual", value: admin.enterpriseAnnualIncluded ? "Included" : "Not included" },
    ];
    if (admin.enterpriseRampUpIncluded) {
      items.push(
        { label: "Ramp-up start", value: safeText(admin.enterpriseRampUpCycleStart) },
        { label: "Ramp-up duration", value: `${safeText(admin.enterpriseRampUpDurationMonths)} months` },
        { label: "Ramp-up collection", value: safeText(admin.enterpriseRampUpCollection) },
      );
    }
    if (admin.enterpriseAnnualIncluded) {
      items.push(
        { label: "Annual allowance", value: `${Number(admin.enterpriseAnnualMonthlyMinimumAllowance || 0).toLocaleString("en-GB")} pages/month` },
        { label: "Annual price", value: `GBP ${safeText(admin.enterpriseAnnualPerPagePrice)}/page` },
        { label: "Annual start", value: safeText(admin.enterpriseAnnualCycleStart) },
        { label: "Yearly cost", value: safeText(admin.enterpriseAnnualDerivedYearlyCost) },
      );
    }
    return items;
  }
  if (flow.id === "no-billing-mode") {
    return [
      { label: "Workspace", value: workspaceId },
      { label: "No-billing mode", value: admin.noBillingEnabled ? "Enabled" : "Disabled" },
    ];
  }
  if (flow.id === "goodwill-credit-grant") {
    return [
      { label: "Workspace", value: workspaceId },
      { label: "Credits", value: Number(admin.goodwillCredits || 0).toLocaleString("en-GB") },
    ];
  }
  if (flow.id === "goodwill-credit-revoke") {
    return [
      { label: "Workspace", value: workspaceId },
      { label: "Grant ID", value: safeText(admin.revokeGrantId) },
    ];
  }
  return [
    { label: "Workspace", value: workspaceId },
    { label: "Action", value: flow.title },
  ];
}

function toMonthValue(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2})/);
  return match ? match[1] : text;
}

function toDateValue(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : text;
}

function safeText(value) {
  const text = String(value || "").trim();
  return text || "-";
}

function formatStatusLabel(value) {
  return safeText(value).replaceAll("_", " ");
}

function formatPlanName(plan) {
  const normalized = String(plan || "").trim();
  if (normalized === "no_billing") {
    return "No-billing";
  }
  if (!normalized) {
    return "-";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatSubscriptionInvoiceFailureMeta(finalizationFailure) {
  if (!finalizationFailure) {
    return [];
  }
  return [
    finalizationFailure.automatic_tax_status
      ? `Automatic tax ${formatStatusLabel(finalizationFailure.automatic_tax_status)}`
      : "",
    finalizationFailure.automatic_tax_reason
      ? `Tax location ${formatStatusLabel(finalizationFailure.automatic_tax_reason)}`
      : "",
    finalizationFailure.last_finalization_error_code
      ? `Finalization error ${formatStatusLabel(finalizationFailure.last_finalization_error_code)}`
      : "",
  ].filter(Boolean);
}

function formatInvoicePaymentMethod(collectionMode) {
  if (collectionMode === "automatic") {
    return "Auto-charge saved payment method";
  }
  if (collectionMode === "manual") {
    return "Send invoice";
  }
  return "-";
}

function formatBillingAuditAction(action) {
  const normalized = String(action || "").trim();
  const labels = {
    goodwill_credit_grant: "Goodwill Credit grant",
    goodwill_credit_revocation: "Goodwill Credit revocation",
    plan_override_created: "Plan override created",
    no_billing_mode_updated: "No-billing mode updated",
    payment_required_plan_override_created: "Payment-required Plan override created",
    payment_required_plan_override_payment_updated: "Payment-required Plan override payment updated",
    enterprise_ramp_up_assigned: "Enterprise ramp-up assigned",
    enterprise_annual_commitment_created: "Enterprise annual commitment created",
  };
  if (labels[normalized]) {
    return labels[normalized];
  }
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "-";
}

function formatBillingAuditActor(entry) {
  const actorName = String(entry?.actor_name || "").trim();
  if (actorName) {
    return actorName;
  }
  const actorUserId = String(entry?.actor_user_id || "").trim();
  if (actorUserId === "stripe") {
    return "Stripe reconciliation";
  }
  return actorUserId ? `User ID ${actorUserId}` : "-";
}

function summarizeBillingAuditSnapshot(snapshot, position = "after") {
  if (!snapshot || typeof snapshot !== "object") {
    return position === "before" ? "No previous billing state" : "No new billing state";
  }

  const parts = [];
  appendPlanOverrideAuditParts(parts, snapshot);
  appendPaymentRequiredPlanOverrideAuditParts(parts, snapshot);
  appendEnterpriseAuditParts(parts, snapshot);
  const plan = snapshot.plan || snapshot.active_entitlement?.plan;
  if (plan) {
    parts.push(formatPlanName(plan));
  }
  const invoiceStatus = snapshot.invoice_status || snapshot.invoice?.status;
  if (invoiceStatus) {
    parts.push(`invoice ${String(invoiceStatus).replaceAll("_", " ")}`);
  }
  if (typeof snapshot.enabled === "boolean") {
    parts.push(snapshot.enabled ? "enabled" : "disabled");
  }
  if (Object.prototype.hasOwnProperty.call(snapshot, "no_billing_enabled")) {
    parts.push(snapshot.no_billing_enabled ? "No-billing enabled" : "No-billing disabled");
  }
  if (typeof snapshot.total_available === "number") {
    parts.push(`${snapshot.total_available.toLocaleString("en-GB")} Credits available`);
  }
  if (typeof snapshot.available_credits === "number" && typeof snapshot.total_available !== "number") {
    parts.push(`${snapshot.available_credits.toLocaleString("en-GB")} Credits available`);
  }
  if (typeof snapshot.granted_credits === "number") {
    parts.push(`${snapshot.granted_credits.toLocaleString("en-GB")} Credits granted`);
  }
  if (typeof snapshot.revoked_credits === "number") {
    parts.push(`${snapshot.revoked_credits.toLocaleString("en-GB")} Credits revoked`);
  }
  const status = snapshot.status || snapshot.enterprise_status;
  if (status && !invoiceStatus) {
    parts.push(String(status).replaceAll("_", " "));
  }

  return parts.length
    ? parts.join(", ")
    : position === "before"
      ? "Previous state captured"
      : "New state captured";
}

function appendPlanOverrideAuditParts(parts, snapshot) {
  if (!Object.prototype.hasOwnProperty.call(snapshot, "plan_override_plan")) {
    return;
  }
  if (!snapshot.plan_override_plan) {
    parts.push("No Plan override");
    return;
  }

  parts.push(`Plan override ${formatPlanName(snapshot.plan_override_plan)}`);
  appendDateAuditPart(parts, "starts", snapshot.plan_override_start_at);
  appendDateAuditPart(parts, "ends", snapshot.plan_override_end_at);
}

function appendPaymentRequiredPlanOverrideAuditParts(parts, snapshot) {
  if (!Object.prototype.hasOwnProperty.call(snapshot, "payment_required_plan_override_plan")) {
    return;
  }
  if (!snapshot.payment_required_plan_override_plan) {
    parts.push("No payment-required Plan override");
    return;
  }

  parts.push(`Payment-required override ${formatPlanName(snapshot.payment_required_plan_override_plan)}`);
  appendDateAuditPart(parts, "starts", snapshot.payment_required_plan_override_start_at);
  appendDateAuditPart(parts, "ends", snapshot.payment_required_plan_override_end_at);
  if (typeof snapshot.payment_required_plan_override_amount_minor === "number") {
    parts.push(formatGbpMinorAmount(snapshot.payment_required_plan_override_amount_minor));
  }
  if (snapshot.payment_required_plan_override_collection_mode) {
    parts.push(formatInvoicePaymentMethod(snapshot.payment_required_plan_override_collection_mode));
  }
  if (snapshot.payment_required_plan_override_invoice_status) {
    parts.push(`invoice ${String(snapshot.payment_required_plan_override_invoice_status).replaceAll("_", " ")}`);
  }
}

function appendEnterpriseAuditParts(parts, snapshot) {
  if (snapshot.enterprise_ramp_up_status) {
    parts.push(`Enterprise ramp-up ${String(snapshot.enterprise_ramp_up_status).replaceAll("_", " ")}`);
  }
  if (typeof snapshot.enterprise_ramp_up_duration_months === "number") {
    parts.push(`${snapshot.enterprise_ramp_up_duration_months} months`);
  }
  if (snapshot.enterprise_annual_status) {
    parts.push(`Enterprise annual ${String(snapshot.enterprise_annual_status).replaceAll("_", " ")}`);
  }
  if (typeof snapshot.enterprise_annual_monthly_minimum_allowance === "number") {
    parts.push(`${snapshot.enterprise_annual_monthly_minimum_allowance.toLocaleString("en-GB")} pages/month`);
  }
  if (typeof snapshot.enterprise_annual_per_page_price_minor === "number") {
    parts.push(`${formatGbpMinorAmount(snapshot.enterprise_annual_per_page_price_minor)}/page`);
  }
  if (typeof snapshot.enterprise_annual_yearly_amount_minor === "number") {
    parts.push(`${formatGbpMinorAmount(snapshot.enterprise_annual_yearly_amount_minor)} yearly`);
  }
  appendDateAuditPart(parts, "cycle starts", snapshot.enterprise_billing_cycle_start_date);
  if (snapshot.enterprise_ramp_up_collection_mode) {
    parts.push(formatInvoicePaymentMethod(snapshot.enterprise_ramp_up_collection_mode));
  }
  if (snapshot.enterprise_annual_collection_mode) {
    parts.push(formatInvoicePaymentMethod(snapshot.enterprise_annual_collection_mode));
  }
  if (snapshot.enterprise_annual_upfront_invoice_status) {
    parts.push(`upfront invoice ${String(snapshot.enterprise_annual_upfront_invoice_status).replaceAll("_", " ")}`);
  }
}

function appendDateAuditPart(parts, label, value) {
  const formatted = formatUtcDateTime(value);
  if (formatted !== "-") {
    parts.push(`${label} ${formatted}`);
  }
}

function formatGbpMinorAmount(amountMinor) {
  return `GBP ${(Number(amountMinor || 0) / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatUtcDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const parts = [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ];
  return `${parts.join("-")} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function formatReconciliationCheckedAt(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
    return "";
  }

  const formatted = formatUtcDateTime(text);
  return formatted === "-" ? "" : formatted;
}

function pad(value) {
  return String(value).padStart(2, "0");
}
