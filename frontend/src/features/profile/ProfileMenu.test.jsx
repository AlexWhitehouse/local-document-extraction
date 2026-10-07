import { fireEvent, render, screen } from "@testing-library/react";
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
    renderMenu({ isDirty: true, saveError: "Profile could not be saved. Please try again." });

    expect(screen.getByRole("alert").textContent).toBe("Profile could not be saved. Please try again.");
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
