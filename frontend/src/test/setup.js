import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

function createMemoryStorage() {
  const values = new Map();

  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(String(key)),
    setItem: (key, value) => values.set(String(key), String(value)),
  };
}

for (const storageName of ["localStorage", "sessionStorage"]) {
  Object.defineProperty(window, storageName, {
    configurable: true,
    value: createMemoryStorage(),
  });
}

const capturedDescriptors = [
  ...["fetch", "WebSocket", "URL"].map((key) => captureDescriptor(globalThis, key)),
  ...["localStorage", "sessionStorage", "location"].map((key) => captureDescriptor(window, key)),
  captureDescriptor(navigator, "clipboard"),
];

afterEach(() => {
  cleanup();
  clearStorage(window.localStorage);
  clearStorage(window.sessionStorage);
  if (vi.isFakeTimers()) {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  for (const captured of capturedDescriptors) restoreDescriptor(captured);
});

function captureDescriptor(object, key) {
  return {
    descriptor: Object.getOwnPropertyDescriptor(object, key),
    key,
    object,
  };
}

function restoreDescriptor({ descriptor, key, object }) {
  if (descriptor) {
    Object.defineProperty(object, key, descriptor);
  } else {
    delete object[key];
  }
}

function clearStorage(storage) {
  try {
    storage?.clear();
  } catch {
    // A test may deliberately replace storage with an unavailable browser shim.
  }
}
