/** Page numbers always refer to the original PDF, including noncontiguous selections. */
export function parsePageSelection(value) {
  if (!String(value || "").trim()) return null;
  const pages = new Set();
  for (const token of String(value).split(",")) {
    const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error("Use page numbers or ranges, such as 1, 3–5 (enter 3-5).");
    const first = Number(match[1]);
    const last = Number(match[2] || match[1]);
    if (!Number.isSafeInteger(first) || first < 1 || last < first || last > 10000) {
      throw new Error("Page numbers must be between 1 and 10000, with ranges in ascending order.");
    }
    for (let page = first; page <= last; page += 1) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

export function formatPages(pages) {
  return Array.isArray(pages) ? pages.join(", ") : "All pages";
}

export function validateSplitPlan(groups, exclusions, selectedPages) {
  const allowed = new Set(selectedPages);
  const assigned = new Set();
  for (const group of groups) {
    if (!group.pages?.length) throw new Error("Each document needs at least one page.");
    for (const page of group.pages) {
      if (!allowed.has(page)) throw new Error(`Page ${page} is outside the selected pages.`);
      if (assigned.has(page)) throw new Error(`Page ${page} is assigned more than once.`);
      assigned.add(page);
    }
  }
  for (const exclusion of exclusions) {
    if (!String(exclusion.reason || "").trim()) throw new Error(`Give a reason for excluding page ${exclusion.page}.`);
    if (!allowed.has(exclusion.page)) throw new Error(`Page ${exclusion.page} is outside the selected pages.`);
    if (assigned.has(exclusion.page)) throw new Error(`Page ${exclusion.page} is assigned more than once.`);
    assigned.add(exclusion.page);
  }
  const missing = selectedPages.filter((page) => !assigned.has(page));
  if (missing.length) throw new Error(`Assign or explicitly exclude pages: ${formatPages(missing)}.`);
  return { groups, exclusions };
}
