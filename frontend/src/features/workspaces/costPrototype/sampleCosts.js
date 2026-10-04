// THROWAWAY fixtures for the Workspace costs study. Shapes follow shared/processingCosts.ts
// and allocation follows ADR-0017, so the views exercise real rounding, partial and
// unavailable cases rather than tidy numbers.
import { allocateCost, costAmount, sumCosts } from "../../../../../shared/processingCosts.ts";

export const STAGES = [
  { id: "split", label: "Smart split" },
  { id: "auto_template", label: "Auto template" },
  { id: "extraction", label: "Extraction" },
];

export const TEMPLATES = ["Referral letter", "Care plan", "Delivery note", "Prescription", "Invoice"];
const TEMPLATE_PAGES = { "Referral letter": [1, 3], "Care plan": [4, 12], "Delivery note": [1, 2], Prescription: [1, 2], Invoice: [1, 4] };
const TEMPLATE_RATE = { "Referral letter": 1, "Care plan": 1.35, "Delivery note": 0.7, Prescription: 0.85, Invoice: 1.1 };

/** The study's clock. 1D means the 24 hours before this moment. */
export const NOW = "2026-10-04T13:20:00Z";
export const TODAY = NOW.slice(0, 10);
export const HISTORY_DAYS = 60;
// The Workspace switched models part-way through the sample.
export const MODEL_CHANGE = { date: "2026-09-21", from: "gemini-2.5-flash", to: "claude-haiku-4-5" };
// Work before tracking began migrates as unknown (ADR-0017).
export const TRACKING_STARTED = "2026-08-10";

function random(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function addDays(date, days) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function stageCost(rand, amount, untracked) {
  const calls = 1 + (rand() < 0.15 ? 1 : 0);
  if (untracked) return costAmount(0, 0, calls);
  // A few calls reach an endpoint that does not report cost.
  const unreported = rand() < 0.03 ? 1 : 0;
  return costAmount(amount * (unreported ? 0.6 : 1), calls, unreported);
}

function totals(costs) {
  return { currency: "USD", ...costs, total: sumCosts(STAGES.map(stage => costs[stage.id])) };
}

const pick = (rand, items) => items[Math.floor(rand() * items.length)];
const pagesFor = (rand, template) => { const [min, max] = TEMPLATE_PAGES[template]; return min + Math.floor(rand() * (max - min + 1)); };
const fileName = (template, number, extension = "pdf") => `${template.replace(/ /g, "_")}_${String(number).padStart(4, "0")}.${extension}`;

function directCosts(rand, { template, pages, date, autoTemplate }) {
  const untracked = date < TRACKING_STARTED;
  const model = date < MODEL_CHANGE.date ? MODEL_CHANGE.from : MODEL_CHANGE.to;
  const modelRate = model === MODEL_CHANGE.from ? 1 : 1.55;
  const extraction = (0.0021 + 0.0034 * pages) * TEMPLATE_RATE[template] * modelRate * (0.75 + rand() * 0.5);
  // Rare reassessment retries make visible outliers.
  const retried = rand() < 0.04;
  return {
    model, retried,
    direct: {
      split: costAmount(),
      auto_template: autoTemplate ? stageCost(rand, (0.0009 + rand() * 0.0012) * modelRate, untracked) : costAmount(),
      extraction: stageCost(rand, extraction * (retried ? 2.6 + rand() * 2 : 1), untracked),
    },
  };
}

function finish(document, splitShare) {
  const { direct, ...rest } = document;
  return { ...rest, costs: totals({ ...direct, split: splitShare || costAmount() }) };
}

function timestamp(rand, date) {
  const latest = date === TODAY ? Number(NOW.slice(11, 13)) - 1 : 19;
  const hour = Math.min(latest, 7 + Math.floor(rand() * 13));
  return `${date}T${String(hour).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}:00Z`;
}

/**
 * With Smart splitting on, a PDF becomes a Document packet: most hold one document, some
 * are split into several. Images never form a packet, so they become plain Documents.
 */
export function buildSample(seed = 20261004) {
  const rand = random(seed);
  const packets = [];
  const direct = [];
  let number = 1;
  for (let day = HISTORY_DAYS - 1; day >= 0; day -= 1) {
    const date = addDays(TODAY, -day);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const volume = date === TODAY ? 6 : weekend ? Math.floor(rand() * 2) : 3 + Math.floor(rand() * 4);
    for (let index = 0; index < volume; index += 1) {
      const created_at = timestamp(rand, date);
      const roll = rand();
      if (roll < 0.15) direct.push(buildDirect(rand, date, created_at, number++));
      else packets.push(buildPacket(rand, date, created_at, number++, roll < 0.72 ? 1 : 2 + Math.floor(rand() * 5)));
    }
  }
  const byTime = (a, b) => b.created_at.localeCompare(a.created_at);
  return { packets: packets.sort(byTime), direct: direct.sort(byTime) };
}

function buildDirect(rand, date, created_at, number) {
  const template = pick(rand, TEMPLATES);
  const { direct, ...rest } = directCosts(rand, { template, pages: 1, date, autoTemplate: rand() < 0.4 });
  return finish({ id: `job_${number}`, kind: "document", name: fileName(template, number, rand() < 0.7 ? "jpg" : "png"), template, pages: 1, date, created_at, direct, ...rest });
}

function buildPacket(rand, date, created_at, number, childCount) {
  const id = `pkt_${String(number).padStart(4, "0")}`;
  const drafts = Array.from({ length: childCount }, (_, index) => {
    const template = pick(rand, TEMPLATES);
    const pages = pagesFor(rand, template);
    const name = childCount === 1 ? fileName(template, number) : `${template} ${index + 1}`;
    return { id: `${id}_doc_${index + 1}`, kind: "document", name, template, pages, date, created_at, packetId: id, ...directCosts(rand, { template, pages, date, autoTemplate: true }) };
  });
  const documentPages = drafts.reduce((sum, child) => sum + child.pages, 0);
  // Blank separators and cover sheets are excluded from extraction but still assessed.
  const excludedPages = childCount > 1 && rand() < 0.7 ? 1 + Math.floor(rand() * 3) : childCount === 1 && rand() < 0.15 ? 1 : 0;
  const pages = documentPages + excludedPages;
  const untracked = date < TRACKING_STARTED;
  // A one-page upload needs no boundary assessment, so it has no split cost.
  const split = pages === 1 ? costAmount() : stageCost(rand, 0.0016 * pages * (date < MODEL_CHANGE.date ? 1 : 1.55) * (0.85 + rand() * 0.3), untracked);
  const children = drafts.map(child => ({ ...finish(child, allocateCost(split, child.pages, pages)), deleted: childCount > 1 && rand() < 0.05 }));
  const childCosts = stage => sumCosts(children.map(child => child.costs[stage]));
  return {
    id, kind: "packet", name: childCount === 1 ? drafts[0].name : `Intake_packet_${String(number).padStart(4, "0")}.pdf`,
    date, created_at, model: drafts[0].model, pages, excludedPages, children,
    // Costs are kept after deletion because they were incurred.
    deleted: rand() < 0.05,
    // A packet owns its whole split cost and rolls up children's direct costs once.
    costs: {
      ...totals({ split, auto_template: childCosts("auto_template"), extraction: childCosts("extraction") }),
      split_allocation: { document_pages: documentPages, packet_pages: pages },
      excluded_pages_cost: allocateCost(split, excludedPages, pages),
    },
  };
}

export const WORKSPACES = [
  { id: "ws_9f2c41aa", name: "Homecare intake", connected: true },
  { id: "ws_4b7d10e3", name: "Pharmacy claims", connected: true },
  { id: "ws_c013e9f7", name: "Evaluation sandbox", connected: true },
];

export const MEMBERS = [
  { user_id: "u_owner", name: "Alex Whitehouse", email: "alex@example.com", role: "owner", created_at: "2026-06-02T10:00:00Z" },
  { user_id: "u_admin", name: "Priya Shah", email: "priya@example.com", role: "admin", created_at: "2026-07-14T10:00:00Z" },
  { user_id: "u_member", name: "Sam Okafor", email: "sam@example.com", role: "member", created_at: "2026-08-21T10:00:00Z" },
];
