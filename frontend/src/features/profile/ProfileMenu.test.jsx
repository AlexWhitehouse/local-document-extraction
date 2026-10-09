import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProfileMenu } from "./ProfileMenu.jsx";

function renderMenu(overrides = {}) {
  const props = {
    displayName: "Ada Lovelace",
    displayEmail: "ada@example.com",
    draftName: "Ada Lovelace",
    isOpen: true,
    isDirty: false,
    canSaveProfile: true,
    saveError: "",
    isSavingProfile: false,
    isSigningOut: false,
    onToggle: vi.fn(),
    onDraftNameChange: vi.fn(),
    onSaveProfile: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  };

  render(<ProfileMenu {...props} />);

  return props;
}

describe("ProfileMenu saving", () => {
  it("disables Save while the name is blank", async () => {
    const user = userEvent.setup();
    const props = renderMenu({ draftName: "", isDirty: true, canSaveProfile: false });

    expect(screen.getByRole("button", { name: "Save profile" }).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(props.onSaveProfile).not.toHaveBeenCalled();
  });

  it("shows a save failure inline in the profile form", () => {
    renderMenu({ isDirty: true, saveError: "Couldn't save profile. Try again." });

    expect(screen.getByRole("alert").textContent).toBe("Couldn't save profile. Try again.");
  });
});

describe("ProfileMenu settings dialog", () => {
  it("closes on Escape when the name is unchanged", () => {
    const props = renderMenu({ isDirty: false });

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Settings" }), { key: "Escape" });
    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });

  it("asks before discarding an edited name", async () => {
    const props = renderMenu({ isDirty: true });

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Settings" }), { key: "Escape" });
    await userEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    expect(props.onToggle).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Settings" }), { key: "Escape" });
    await userEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("ProfileMenu keyboard shortcuts", () => {
  const shortcutProps = {
    displayName: "Ada Lovelace",
    displayEmail: "ada@example.com",
    draftName: "Ada Lovelace",
    isDirty: false,
    canSaveProfile: true,
    saveError: "",
    isSavingProfile: false,
    isSigningOut: false,
    onDraftNameChange: vi.fn(),
    onSaveProfile: vi.fn(),
    onSignOut: vi.fn(),
  };

  it("lists the sidebar, help and document list shortcuts in Settings", () => {
    render(<ProfileMenu {...shortcutProps} isOpen onToggle={vi.fn()} />);

    const section = screen.getByRole("region", { name: "Keyboard shortcuts" });
    expect(within(section).getByText("Collapse or expand the sidebar")).toBeTruthy();
    expect(within(section).getByText("Show keyboard shortcuts")).toBeTruthy();
    expect(within(section).getByText(/Move between documents in the list/)).toBeTruthy();
  });

  it("opens Settings and focuses the shortcuts section with ?", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<ProfileMenu {...shortcutProps} isOpen={false} onToggle={onToggle} />);

    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<ProfileMenu {...shortcutProps} isOpen onToggle={onToggle} />);
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Keyboard shortcuts" }));
  });

  it("ignores ? while typing and while a dialog is already open", () => {
    const onToggle = vi.fn();

    const { rerender } = render(
      <>
        <input aria-label="Search" />
        <ProfileMenu {...shortcutProps} isOpen={false} onToggle={onToggle} />
      </>,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search" }), { key: "?" });
    expect(onToggle).not.toHaveBeenCalled();

    rerender(
      <>
        <input aria-label="Search" />
        <ProfileMenu {...shortcutProps} isOpen onToggle={onToggle} />
      </>,
    );
    fireEvent.keyDown(document.body, { key: "?" });
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("ProfileMenu appearance", () => {
  it("defaults to dark and applies a chosen theme straight away", async () => {
    window.localStorage.removeItem("studio.theme");
    renderMenu();
    const theme = screen.getByRole("radiogroup", { name: "Theme" });

    expect(within(theme).getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");

    await userEvent.click(within(theme).getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("studio.theme")).toBe("light");
    window.localStorage.removeItem("studio.theme");
  });
});
