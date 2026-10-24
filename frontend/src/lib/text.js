export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

// A wait in whole minutes, or whole hours from an hour up: "1 minute", "9 minutes", "3 hours".
export function formatWait(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));

  return minutes < 60 ? pluralize(minutes, "minute") : pluralize(Math.ceil(minutes / 60), "hour");
}
