import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Popover } from "./Popover.jsx";
import { Callout } from "./Callout.jsx";
import { LoadMore, Pager } from "./Pager.jsx";

function PopoverHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label="Filters"
        trigger={(props) => (
          <button type="button" {...props} onClick={() => setOpen((value) => !value)}>
            Filters
          </button>
        )}
      >
        <input aria-label="Model" />
      </Popover>
      <p>Outside</p>
    </>
  );
}

describe("Popover", () => {
  it("closes on Escape and outside press, returning focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<PopoverHarness />);
    const trigger = screen.getByRole("button", { name: "Filters" });

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await user.click(screen.getByLabelText("Model"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    await user.click(screen.getByText("Outside"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Popover focus", () => {
  it("leaves focus alone on mount and does not pull it back after an outside press", async () => {
    const user = userEvent.setup();
    render(<PopoverHarness />);
    expect(document.activeElement).toBe(document.body);

    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.click(screen.getByText("Outside"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Filters" }));
  });
});

describe("Callout, Pager and LoadMore", () => {
  it("renders a toned callout with its action", () => {
    render(
      <Callout tone="info" title="Set up a Model gateway" action={<button type="button">Open Workspace</button>}>
        Evaluations need a model.
      </Callout>,
    );

    expect(screen.getByText("Set up a Model gateway").closest(".ui-callout").className).toContain("ui-tone-info");
    expect(screen.getByRole("button", { name: "Open Workspace" })).toBeTruthy();
  });

  it("disables paging at the ends and shows load-more failures with Try again", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    render(
      <>
        <Pager label="1–20" hasPrevious={false} hasNext onPrevious={() => {}} onNext={() => {}} />
        <LoadMore onLoadMore={onLoadMore} error="Couldn't load more documents." />
      </>,
    );

    expect(screen.getByRole("button", { name: "Previous page" }).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("Couldn't load more documents.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onLoadMore).toHaveBeenCalled();
  });
});
