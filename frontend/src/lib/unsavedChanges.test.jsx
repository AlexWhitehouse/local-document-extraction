import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmLeavingUnsavedEdits,
  hasUnsavedEdits,
  runDiscardChecks,
  unsavedEditLabels,
  unsavedEditsLeavingFor,
  useUnsavedGuard,
} from "./unsavedChanges";

function Editor({ dirty, label = "Editor", leaves, onDiscard }) {
  useUnsavedGuard(dirty, label, { leaves, onDiscard });

  return null;
}

function unloadPrevented() {
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);

  return unload.defaultPrevented;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useUnsavedGuard", () => {
  it("registers only while the editor is dirty and mounted", () => {
    const { rerender, unmount } = render(<Editor dirty={false} />);
    expect(hasUnsavedEdits()).toBe(false);

    rerender(<Editor dirty label="Expected answer" />);
    expect(hasUnsavedEdits()).toBe(true);
    expect(unsavedEditLabels()).toEqual(["Expected answer"]);

    unmount();
    expect(hasUnsavedEdits()).toBe(false);
  });

  it("installs the page-unload prompt only while an editor is dirty", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const unloadCalls = (spy) => spy.mock.calls.filter(([type]) => type === "beforeunload");

    const { rerender, unmount } = render(<Editor dirty={false} />);
    expect(unloadCalls(add)).toHaveLength(0);
    expect(unloadPrevented()).toBe(false);

    rerender(<Editor dirty />);
    expect(unloadCalls(add)).toHaveLength(1);
    expect(unloadPrevented()).toBe(true);

    rerender(<Editor dirty={false} />);
    expect(unloadCalls(remove)).toHaveLength(1);
    expect(unloadPrevented()).toBe(false);

    rerender(<Editor dirty />);
    unmount();
    expect(unloadCalls(remove)).toHaveLength(2);
    expect(unloadPrevented()).toBe(false);
  });

  it("keeps one unload prompt for several dirty editors", () => {
    const view = render(
      <>
        <Editor dirty label="Template" />
        <Editor dirty label="Expected answer" />
      </>,
    );

    view.rerender(
      <>
        <Editor dirty={false} label="Template" />
        <Editor dirty label="Expected answer" />
      </>,
    );
    expect(unloadPrevented()).toBe(true);
    view.unmount();
    expect(unloadPrevented()).toBe(false);
  });
});

describe("leaving unsaved edits", () => {
  it("lets navigation through without asking when nothing would be lost", () => {
    const onDiscard = vi.fn();
    render(<Editor dirty leaves={(route) => route.page !== "templates"} onDiscard={onDiscard} />);

    expect(confirmLeavingUnsavedEdits({ page: "templates" })).toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("asks once for every editor the route would lose and discards them on confirm", async () => {
    const user = userEvent.setup();
    const template = vi.fn();
    const answer = vi.fn();
    const stays = vi.fn();

    render(
      <>
        <Editor dirty label="Template" onDiscard={template} />
        <Editor dirty label="Expected answer" onDiscard={answer} />
        <Editor dirty label="Evaluation" leaves={() => false} onDiscard={stays} />
      </>,
    );

    let verdict;
    act(() => {
      verdict = confirmLeavingUnsavedEdits({ page: "documents", workspaceId: "a" });
    });
    expect(await screen.findAllByRole("alertdialog", { name: "Discard changes?" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Discard" }));

    await expect(verdict).resolves.toBe(true);
    expect(template).toHaveBeenCalledOnce();
    expect(answer).toHaveBeenCalledOnce();
    expect(stays).not.toHaveBeenCalled();
  });

  it("keeps the edits when the user keeps editing", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    render(<Editor dirty onDiscard={onDiscard} />);

    let verdict;
    act(() => {
      verdict = confirmLeavingUnsavedEdits({ page: "documents" });
    });
    await user.click(await screen.findByRole("button", { name: "Keep editing" }));

    await expect(verdict).resolves.toBe(false);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(hasUnsavedEdits()).toBe(true);
  });

  it("discards only after every later check also allows the navigation", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    render(<Editor dirty onDiscard={onDiscard} />);

    const leaving = unsavedEditsLeavingFor({ page: "documents" });
    let verdict;
    act(() => {
      verdict = runDiscardChecks([leaving.confirm, () => false], leaving.discard);
    });
    await user.click(await screen.findByRole("button", { name: "Discard" }));

    await expect(verdict).resolves.toBe(false);
    expect(onDiscard).not.toHaveBeenCalled();
  });
});
