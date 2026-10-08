// Per-field problems read as one Field error: what happened, then what to do.
export function issueMessage(issues = []) {
  return issues.length ? issues.map((issue) => `${issue.title}. ${issue.remedy}`).join(" ") : undefined;
}

// Just the fix, for a control whose position already names the location.
export function issueRemedy(issues = []) {
  return issues.length ? issues.map((issue) => issue.remedy).join(" ") : undefined;
}

export function templateIssues(issues, property) {
  return issues.filter((issue) => issue.location.scope === "template" && issue.location.property === property);
}
