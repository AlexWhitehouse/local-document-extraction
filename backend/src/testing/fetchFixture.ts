export type FetchImplementation = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

/** Keep Bun's preconnect capability while replacing just the request transport in a test. */
export function fetchFixture(implementation: FetchImplementation): typeof fetch {
  return Object.assign(implementation, { preconnect: globalThis.fetch.preconnect });
}
