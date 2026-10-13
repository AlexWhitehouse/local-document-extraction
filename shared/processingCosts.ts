export type ProcessingCostStage = "split" | "auto_template" | "extraction";

/** Amount is the known subtotal; null means calls occurred but none reported cost. */
export type CostAmount = {
  amount: number | null;
  complete: boolean;
  reported_calls: number;
  unreported_calls: number;
};

export type ProcessingCosts = {
  currency: "USD";
  total: CostAmount;
  split: CostAmount;
  auto_template: CostAmount;
  extraction: CostAmount;
  split_allocation?: { document_pages: number; packet_pages: number };
  excluded_pages_cost?: CostAmount;
};

export function costAmount(amount = 0, reported = 0, unreported = 0): CostAmount {
  return {
    amount: unreported && !reported ? null : amount,
    complete: unreported === 0,
    reported_calls: reported,
    unreported_calls: unreported,
  };
}

export function sumCosts(costs: CostAmount[]): CostAmount {
  return costAmount(
    costs.reduce((sum, cost) => sum + (cost.amount ?? 0), 0),
    costs.reduce((sum, cost) => sum + cost.reported_calls, 0),
    costs.reduce((sum, cost) => sum + cost.unreported_calls, 0),
  );
}

export function allocateCost(cost: CostAmount, pages: number, totalPages: number): CostAmount {
  if (!pages) return costAmount();

  return { ...cost, amount: cost.amount === null ? null : cost.amount * (pages / totalPages) };
}

/** The Costs page's USD format: three significant digits below $1 so sub-cent document costs stay comparable. */
export function formatUsd(amount: number): string {
  if (amount === 0) return "$0.00";

  if (amount >= 1) return `$${amount.toFixed(2)}`;

  if (amount < 0.0001) return "<$0.0001";

  if (amount >= 0.1) return `$${amount.toFixed(3).replace(/0$/, "")}`;

  return `$${amount.toPrecision(3)}`;
}
