import React from "react";
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApplicationBootstrap } from "./ApplicationBootstrap";
import { DEFAULT_RUNTIME_CONFIGURATION } from "./lib/runtimeConfiguration";

vi.mock("./App", () => ({ App: ({ configuration }) => <div>Upload limit: {configuration.limits.maxSourceFileBytes}</div> }));

it("waits for server capabilities and passes the actual upload limit to the app", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ ...DEFAULT_RUNTIME_CONFIGURATION, limits: { maxSourceFileBytes: 42 } }));
  vi.stubGlobal("fetch", fetch);
  render(<ApplicationBootstrap />);
  expect(await screen.findByText("Upload limit: 42")).toBeTruthy();
  expect(fetch).toHaveBeenCalledWith("/v1/config", expect.objectContaining({ cache: "no-store" }));
});

it("keeps auth unavailable on invalid configuration and lets users retry", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ auth: { googleEnabled: true } }))
    .mockResolvedValueOnce(Response.json(DEFAULT_RUNTIME_CONFIGURATION));
  vi.stubGlobal("fetch", fetch);
  render(<ApplicationBootstrap />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText(/Upload limit:/)).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Upload limit: 10485760")).toBeTruthy();
});
