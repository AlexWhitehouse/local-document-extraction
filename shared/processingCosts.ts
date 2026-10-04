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
