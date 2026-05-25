import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let currentSession;

const authClientMock = vi.hoisted(() => ({
  listUsers: vi.fn(),
  setRole: vi.fn(),
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  impersonateUser: vi.fn(),
  stopImpersonating: vi.fn(),
  refetchSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("./lib/authClient", () => ({
  createRuntimeAuthClient: () => ({
    useSession: () => ({
      data: currentSession,
      isPending: false,
      refetch: authClientMock.refetchSession,
    }),
    signIn: {
      email: vi.fn(),
      social: vi.fn(),
    },
    signUp: {
      email: vi.fn(),
    },
    signOut: authClientMock.signOut,
    admin: {
      listUsers: authClientMock.listUsers,
      setRole: authClientMock.setRole,
      banUser: authClientMock.banUser,
      unbanUser: authClientMock.unbanUser,
      impersonateUser: authClientMock.impersonateUser,
      stopImpersonating: authClientMock.stopImpersonating,
    },
  }),
}));

vi.mock("sonner", () => ({
  Toaster: (props) => (
    <div data-rich-colors={String(props.richColors)} data-testid="sonner-toaster" />
  ),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { App } from "./App.jsx";
import { toast } from "sonner";

function getUserRow(email) {
  const usersTable = screen.getByRole("table");
  return within(usersTable).getByText(email).closest("tr");
}

async function openUserActions(user, email) {
  const row = getUserRow(email);
  await user.click(within(row).getByRole("button", { name: `User actions for ${email}` }));
  return row;
}

async function clickUserAction(user, email, actionName) {
  const row = await openUserActions(user, email);
  await user.click(await within(row).findByRole("menuitem", { name: actionName }));
}

describe("Application admin page gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installLocalStorage();
    globalThis.fetch = vi.fn(mockWorkspaceFetch);
    currentSession = sessionForRole("user");
    authClientMock.listUsers.mockResolvedValue({
      data: { users: [], total: 0, limit: 25, offset: 0 },
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not show the Admin sidebar item to a regular user", async () => {
    render(<App />);

    expect(await screen.findByRole("button", { name: /Workspaces/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Admin/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Environment and Access" })).toBeTruthy();
    expect(authClientMock.listUsers).not.toHaveBeenCalled();
  });

  it("shows Application admins an Admin sidebar item with no count badge", async () => {
    currentSession = sessionForRole("admin");

    render(<App />);

    const adminButton = await screen.findByRole("button", { name: /^Admin$/ });
    expect(adminButton).toBeTruthy();
    expect(within(adminButton).queryByText(/\d+/)).toBeNull();
  });

  it("returns a regular user with stale admin-page state to the Workspace page", async () => {
    const user = userEvent.setup();
    currentSession = sessionForRole("admin");

    render(<App />);

    const adminButton = await screen.findByRole("button", { name: /^Admin$/ });
    currentSession = sessionForRole("user");
    await user.click(adminButton);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Environment and Access" })).toBeTruthy();
    });
    expect(screen.queryByRole("heading", { name: "Application Admin" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Admin$/ })).toBeNull();
  });

  it("lists Application admin users through Better Auth without exposing internal user IDs", async () => {
    const user = userEvent.setup();
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: "user_internal_1",
            email: "grace@example.com",
            name: "Grace Hopper",
            emailVerified: true,
            role: "admin",
            banned: false,
            banReason: null,
            createdAt: "2026-01-02T03:04:05.000Z",
          },
          {
            id: "user_internal_2",
            email: "alan@example.com",
            name: "Alan Turing",
            emailVerified: false,
            role: "user",
            banned: true,
            banReason: "Compromised credentials",
            createdAt: "2025-12-31T20:30:00.000Z",
          },
        ],
        total: 2,
        limit: 25,
        offset: 0,
      },
      error: null,
    });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));

    expect(await screen.findByText("Total users 2")).toBeTruthy();
    const usersTable = within(screen.getByRole("table"));
    expect(usersTable.getByText("grace@example.com")).toBeTruthy();
    expect(usersTable.getByText("Grace Hopper")).toBeTruthy();
    expect(usersTable.getByText("Verified")).toBeTruthy();
    expect(usersTable.getByText("Application Admin")).toBeTruthy();
    expect(usersTable.getByText("Active")).toBeTruthy();
    expect(usersTable.getByText("alan@example.com")).toBeTruthy();
    expect(usersTable.getByText("Alan Turing")).toBeTruthy();
    expect(usersTable.getByText("Unverified")).toBeTruthy();
    expect(usersTable.getByText("Regular User")).toBeTruthy();
    expect(usersTable.getAllByText("Banned").length).toBeGreaterThan(0);
    expect(usersTable.getByText("Compromised credentials")).toBeTruthy();
    expect(usersTable.getByText(/2026-01-02 \d{2}:\d{2}:\d{2}/)).toBeTruthy();
    expect(usersTable.queryByText("user_internal_1")).toBeNull();
    expect(authClientMock.listUsers).toHaveBeenCalledWith({
      query: {
        limit: 25,
        offset: 0,
        sortBy: "createdAt",
        sortDirection: "desc",
      },
    });
  });

  it("searches users manually by selected field and clears back to the first unfiltered page", async () => {
    const user = userEvent.setup();
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: { users: [], total: 0, limit: 25, offset: 0 },
      error: null,
    });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));
    await screen.findByText("Total users 0");

    expect(screen.getByLabelText("Search field").value).toBe("email");
    await user.selectOptions(screen.getByLabelText("Search field"), "name");
    await user.type(screen.getByLabelText("Search users"), "Grace");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(authClientMock.listUsers).toHaveBeenLastCalledWith({
        query: {
          limit: 25,
          offset: 0,
          sortBy: "createdAt",
          sortDirection: "desc",
          searchValue: "Grace",
          searchField: "name",
          searchOperator: "contains",
        },
      });
    });

    await user.click(screen.getByRole("button", { name: "Clear Search" }));

    await waitFor(() => {
      expect(authClientMock.listUsers).toHaveBeenLastCalledWith({
        query: {
          limit: 25,
          offset: 0,
          sortBy: "createdAt",
          sortDirection: "desc",
        },
      });
    });
    expect(screen.getByLabelText("Search field").value).toBe("email");
    expect(screen.getByLabelText("Search users").value).toBe("");
  });

  it("pages through Application admin users with a fixed page size", async () => {
    const user = userEvent.setup();
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: { users: [], total: 30, limit: 25, offset: 0 },
      error: null,
    });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));
    await screen.findByText("Total users 30");

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(authClientMock.listUsers).toHaveBeenLastCalledWith({
        query: {
          limit: 25,
          offset: 25,
          sortBy: "createdAt",
          sortDirection: "desc",
        },
      });
    });
    expect(screen.getByText("Page 2")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => {
      expect(authClientMock.listUsers).toHaveBeenLastCalledWith({
        query: {
          limit: 25,
          offset: 0,
          sortBy: "createdAt",
          sortDirection: "desc",
        },
      });
    });
    expect(screen.getByText("Page 1")).toBeTruthy();
  });

  it("shows Application admin list loading errors inline", async () => {
    const user = userEvent.setup();
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: null,
      error: { message: "Admin list unavailable" },
    });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));

    const inlineError = await screen.findByRole("alert");
    expect(within(inlineError).getByText("Admin list unavailable")).toBeTruthy();
    expect(within(inlineError).getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("makes a regular user an Application admin after confirmation and reloads the list", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: "user_regular_1",
            email: "alan@example.com",
            name: "Alan Turing",
            emailVerified: true,
            role: "user",
            banned: false,
            banReason: null,
            createdAt: "2026-01-02T03:04:05.000Z",
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
      error: null,
    });
    authClientMock.setRole.mockResolvedValue({ data: {}, error: null });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));
    await clickUserAction(user, "alan@example.com", "Make admin");

    expect(confirmSpy).toHaveBeenCalledWith(
      "Make alan@example.com an Application admin? This grants application-wide account management access.",
    );
    await waitFor(() => {
      expect(authClientMock.setRole).toHaveBeenCalledWith({
        userId: "user_regular_1",
        role: "admin",
      });
    });
    expect(authClientMock.listUsers).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith("Application role updated: alan@example.com");
  });

  it("removes another admin after stronger confirmation but prevents self-demotion", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: "user_1",
            email: "ada@example.com",
            name: "Ada Lovelace",
            emailVerified: true,
            role: "admin",
            banned: false,
            banReason: null,
            createdAt: "2026-01-02T03:04:05.000Z",
          },
          {
            id: "user_admin_2",
            email: "grace@example.com",
            name: "Grace Hopper",
            emailVerified: true,
            role: "admin",
            banned: false,
            banReason: null,
            createdAt: "2026-01-03T03:04:05.000Z",
          },
        ],
        total: 2,
        limit: 25,
        offset: 0,
      },
      error: null,
    });
    authClientMock.setRole.mockResolvedValue({ data: {}, error: null });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));

    const currentAdminRow = await openUserActions(user, "ada@example.com");
    expect(within(currentAdminRow).getByText("No actions available")).toBeTruthy();
    await clickUserAction(user, "grace@example.com", "Remove admin");

    expect(confirmSpy).toHaveBeenCalledWith(
      "Remove Application admin access from grace@example.com? This revokes application-wide account management access.",
    );
    await waitFor(() => {
      expect(authClientMock.setRole).toHaveBeenCalledWith({
        userId: "user_admin_2",
        role: "user",
      });
    });
    expect(authClientMock.listUsers).toHaveBeenCalledTimes(2);
  });

  it("shows a failure Action toast without reloading when a role change fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: "user_regular_1",
            email: "alan@example.com",
            name: "Alan Turing",
            emailVerified: true,
            role: "user",
            banned: false,
            banReason: null,
            createdAt: "2026-01-02T03:04:05.000Z",
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
      error: null,
    });
    authClientMock.setRole.mockResolvedValue({
      data: null,
      error: { message: "Role update denied" },
    });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));
    await clickUserAction(user, "alan@example.com", "Make admin");

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Application role could not be updated. Please try again.",
      );
    });
    expect(screen.getByText("alan@example.com")).toBeTruthy();
    expect(authClientMock.listUsers).toHaveBeenCalledTimes(1);
    expect(authClientMock.refetchSession).not.toHaveBeenCalled();
    expect(authClientMock.signOut).not.toHaveBeenCalled();
  });

  it("bans a regular user with a required reason and reloads the list", async () => {
    const user = userEvent.setup();
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: "user_regular_1",
            email: "alan@example.com",
            name: "Alan Turing",
            emailVerified: true,
            role: "user",
            banned: false,
            banReason: null,
            createdAt: "2026-01-02T03:04:05.000Z",
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
      error: null,
    });
    authClientMock.banUser.mockResolvedValue({ data: {}, error: null });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));
    await clickUserAction(user, "alan@example.com", "Ban user");

    expect(screen.getByRole("dialog", { name: "Ban alan@example.com" })).toBeTruthy();
    await user.type(screen.getByLabelText("Ban reason"), "Compromised account");
    await user.click(screen.getByRole("button", { name: "Confirm ban" }));

    await waitFor(() => {
      expect(authClientMock.banUser).toHaveBeenCalledWith({
        userId: "user_regular_1",
        banReason: "Compromised account",
      });
    });
    expect(authClientMock.listUsers).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith("User banned: alan@example.com");
  });

  it("shows inline validation and does not call Better Auth when a ban reason is missing", async () => {
    const user = userEvent.setup();
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: "user_regular_1",
            email: "alan@example.com",
            name: "Alan Turing",
            emailVerified: true,
            role: "user",
            banned: false,
            banReason: null,
            createdAt: "2026-01-02T03:04:05.000Z",
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
      error: null,
    });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));
    await clickUserAction(user, "alan@example.com", "Ban user");
    await user.click(screen.getByRole("button", { name: "Confirm ban" }));

    expect(await screen.findByText("Enter a ban reason before banning this user.")).toBeTruthy();
    expect(authClientMock.banUser).not.toHaveBeenCalled();
    expect(authClientMock.listUsers).toHaveBeenCalledTimes(1);
  });

  it("prevents self-ban but allows banning another Application admin through explicit confirmation", async () => {
    const user = userEvent.setup();
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: "user_1",
            email: "ada@example.com",
            name: "Ada Lovelace",
            emailVerified: true,
            role: "admin",
            banned: false,
            banReason: null,
            createdAt: "2026-01-02T03:04:05.000Z",
          },
          {
            id: "user_admin_2",
            email: "grace@example.com",
            name: "Grace Hopper",
            emailVerified: true,
            role: "admin",
            banned: false,
            banReason: null,
            createdAt: "2026-01-03T03:04:05.000Z",
          },
        ],
        total: 2,
        limit: 25,
        offset: 0,
      },
      error: null,
    });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));

    const currentAdminRow = await openUserActions(user, "ada@example.com");
    expect(within(currentAdminRow).getByText("No actions available")).toBeTruthy();
    await clickUserAction(user, "grace@example.com", "Ban user");

    expect(screen.getByRole("dialog", { name: "Ban grace@example.com" })).toBeTruthy();
    expect(screen.getByText("You are banning another Application admin."));
  });

  it("unbans a banned user after confirming email and existing ban reason", async () => {
    const user = userEvent.setup();
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: "user_banned_1",
            email: "alan@example.com",
            name: "Alan Turing",
            emailVerified: true,
            role: "user",
            banned: true,
            banReason: "Compromised credentials",
            createdAt: "2026-01-02T03:04:05.000Z",
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
      error: null,
    });
    authClientMock.unbanUser.mockResolvedValue({ data: {}, error: null });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));
    await clickUserAction(user, "alan@example.com", "Unban user");

    const dialog = screen.getByRole("dialog", { name: "Unban alan@example.com" });
    expect(within(dialog).getByText("alan@example.com")).toBeTruthy();
    expect(within(dialog).getByText("Compromised credentials")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Confirm unban" }));

    await waitFor(() => {
      expect(authClientMock.unbanUser).toHaveBeenCalledWith({ userId: "user_banned_1" });
    });
    expect(authClientMock.listUsers).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith("User unbanned: alan@example.com");
  });

  it("shows failure Action toasts without reloading when ban and unban operations fail", async () => {
    const user = userEvent.setup();
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: "user_regular_1",
            email: "alan@example.com",
            name: "Alan Turing",
            emailVerified: true,
            role: "user",
            banned: false,
            banReason: null,
            createdAt: "2026-01-02T03:04:05.000Z",
          },
          {
            id: "user_banned_1",
            email: "grace@example.com",
            name: "Grace Hopper",
            emailVerified: true,
            role: "user",
            banned: true,
            banReason: "Compromised credentials",
            createdAt: "2026-01-03T03:04:05.000Z",
          },
        ],
        total: 2,
        limit: 25,
        offset: 0,
      },
      error: null,
    });
    authClientMock.banUser.mockResolvedValue({ data: null, error: { message: "Ban denied" } });
    authClientMock.unbanUser.mockResolvedValue({ data: null, error: { message: "Unban denied" } });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));
    await clickUserAction(user, "alan@example.com", "Ban user");
    await user.type(screen.getByLabelText("Ban reason"), "Compromised account");
    await user.click(screen.getByRole("button", { name: "Confirm ban" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("User could not be banned. Please try again.");
    });
    expect(screen.getByRole("dialog", { name: "Ban alan@example.com" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await clickUserAction(user, "grace@example.com", "Unban user");
    await user.click(screen.getByRole("button", { name: "Confirm unban" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("User could not be unbanned. Please try again.");
    });
    expect(screen.getByRole("dialog", { name: "Unban grace@example.com" })).toBeTruthy();
    expect(authClientMock.listUsers).toHaveBeenCalledTimes(1);
  });

  it("starts impersonating an eligible regular user after transition confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: "user_regular_1",
            email: "alan@example.com",
            name: "Alan Turing",
            emailVerified: true,
            role: "user",
            banned: false,
            banReason: null,
            createdAt: "2026-01-02T03:04:05.000Z",
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
      error: null,
    });
    authClientMock.impersonateUser.mockResolvedValue({ data: {}, error: null });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));
    await clickUserAction(user, "alan@example.com", "Impersonate user");

    expect(confirmSpy).toHaveBeenCalledWith(
      "Start impersonating alan@example.com? You will leave the Admin page and enter this user's normal app experience.",
    );
    await waitFor(() => {
      expect(authClientMock.impersonateUser).toHaveBeenCalledWith({ userId: "user_regular_1" });
    });
  });

  it("only offers impersonation for active regular users other than the current admin", async () => {
    const user = userEvent.setup();
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: "user_1",
            email: "ada@example.com",
            name: "Ada Lovelace",
            emailVerified: true,
            role: "admin",
            banned: false,
            banReason: null,
            createdAt: "2026-01-02T03:04:05.000Z",
          },
          {
            id: "user_admin_2",
            email: "grace@example.com",
            name: "Grace Hopper",
            emailVerified: true,
            role: "admin",
            banned: false,
            banReason: null,
            createdAt: "2026-01-03T03:04:05.000Z",
          },
          {
            id: "user_banned_1",
            email: "katherine@example.com",
            name: "Katherine Johnson",
            emailVerified: true,
            role: "user",
            banned: true,
            banReason: "Compromised credentials",
            createdAt: "2026-01-04T03:04:05.000Z",
          },
          {
            id: "user_regular_1",
            email: "alan@example.com",
            name: "Alan Turing",
            emailVerified: true,
            role: "user",
            banned: false,
            banReason: null,
            createdAt: "2026-01-05T03:04:05.000Z",
          },
        ],
        total: 4,
        limit: 25,
        offset: 0,
      },
      error: null,
    });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));

    await screen.findByText("Total users 4");
    const currentAdminRow = await openUserActions(user, "ada@example.com");
    expect(within(currentAdminRow).queryByRole("menuitem", { name: "Impersonate user" })).toBeNull();
    const otherAdminRow = await openUserActions(user, "grace@example.com");
    expect(within(otherAdminRow).queryByRole("menuitem", { name: "Impersonate user" })).toBeNull();
    const bannedUserRow = await openUserActions(user, "katherine@example.com");
    expect(within(bannedUserRow).queryByRole("menuitem", { name: "Impersonate user" })).toBeNull();
    const regularUserRow = await openUserActions(user, "alan@example.com");
    expect(within(regularUserRow).getByRole("menuitem", { name: "Impersonate user" })).toBeTruthy();
  });

  it("clears session-scoped UI state, refetches the session, and moves to Workspace after impersonation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: "user_regular_1",
            email: "alan@example.com",
            name: "Alan Turing",
            emailVerified: true,
            role: "user",
            banned: false,
            banReason: null,
            createdAt: "2026-01-02T03:04:05.000Z",
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
      error: null,
    });
    authClientMock.impersonateUser.mockResolvedValue({ data: {}, error: null });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));
    await clickUserAction(user, "alan@example.com", "Impersonate user");

    await waitFor(() => {
      expect(authClientMock.refetchSession).toHaveBeenCalled();
    });
    expect(window.localStorage.removeItem).toHaveBeenCalledWith("documentextraction.workspace.v1");
    expect(screen.getByRole("heading", { name: "Environment and Access" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Application Admin" })).toBeNull();
    expect(
      globalThis.fetch.mock.calls.filter(([input]) => String(input).endsWith("/workspaces")),
    ).toHaveLength(2);
    expect(authClientMock.listUsers).toHaveBeenCalledTimes(1);
  });

  it("shows recoverable failure feedback without losing admin list state when impersonation fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    currentSession = sessionForRole("admin");
    authClientMock.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: "user_regular_1",
            email: "alan@example.com",
            name: "Alan Turing",
            emailVerified: true,
            role: "user",
            banned: false,
            banReason: null,
            createdAt: "2026-01-02T03:04:05.000Z",
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
      error: null,
    });
    authClientMock.impersonateUser.mockResolvedValue({
      data: null,
      error: { message: "Impersonation denied" },
    });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));
    await clickUserAction(user, "alan@example.com", "Impersonate user");

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Impersonation could not be started. Please try again.",
      );
    });
    expect(screen.getByRole("heading", { name: "Application Admin" })).toBeTruthy();
    expect(screen.getByText("alan@example.com")).toBeTruthy();
    expect(authClientMock.refetchSession).not.toHaveBeenCalled();
    expect(window.localStorage.removeItem).not.toHaveBeenCalledWith("documentextraction.workspace.v1");
    expect(authClientMock.listUsers).toHaveBeenCalledTimes(1);
  });

  it("shows an impersonation indicator naming the impersonated user without exposing the original admin ID", async () => {
    currentSession = impersonatedSession();

    render(<App />);

    const indicator = await screen.findByRole("status", { name: "Impersonation mode" });
    expect(within(indicator).getByText("Impersonating alan@example.com")).toBeTruthy();
    expect(within(indicator).queryByText("admin_internal_1")).toBeNull();
  });

  it("stops impersonating immediately through Better Auth and disables the action while in flight", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    currentSession = impersonatedSession();
    const stopRequest = deferred();
    authClientMock.stopImpersonating.mockReturnValue(stopRequest.promise);

    render(<App />);

    const stopButton = await screen.findByRole("button", { name: "Stop impersonating" });
    await user.click(stopButton);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(authClientMock.stopImpersonating).toHaveBeenCalledWith();
    expect(stopButton.disabled).toBe(true);

    stopRequest.resolve({ data: {}, error: null });
    await waitFor(() => {
      expect(stopButton.disabled).toBe(false);
    });
  });

  it("clears session-scoped UI state, refetches the session, returns to Admin, and shows success feedback after stopping impersonation", async () => {
    const user = userEvent.setup();
    currentSession = impersonatedSession();
    authClientMock.stopImpersonating.mockResolvedValue({ data: {}, error: null });
    authClientMock.refetchSession.mockImplementation(() => {
      currentSession = sessionForRole("admin");
      return Promise.resolve();
    });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Stop impersonating" }));

    await waitFor(() => {
      expect(authClientMock.refetchSession).toHaveBeenCalled();
    });
    expect(window.localStorage.removeItem).toHaveBeenCalledWith("documentextraction.workspace.v1");
    expect(await screen.findByRole("heading", { name: "Application Admin" })).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith("Impersonation stopped");
    await waitFor(() => {
      expect(
        globalThis.fetch.mock.calls.filter(([input]) => String(input).endsWith("/workspaces")),
      ).toHaveLength(2);
    });
  });

  it("shows recoverable failure feedback without clearing state or hiding the impersonation indicator when stopping fails", async () => {
    const user = userEvent.setup();
    currentSession = impersonatedSession();
    authClientMock.stopImpersonating.mockResolvedValue({
      data: null,
      error: { message: "Stop denied" },
    });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Stop impersonating" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Impersonation could not be stopped. Please try again.",
      );
    });
    expect(screen.getByRole("status", { name: "Impersonation mode" })).toBeTruthy();
    expect(screen.getByText("Impersonating alan@example.com")).toBeTruthy();
    expect(authClientMock.refetchSession).not.toHaveBeenCalled();
    expect(window.localStorage.removeItem).not.toHaveBeenCalledWith("documentextraction.workspace.v1");
  });

  it("keeps the Application admin page available while Workspace context is loading", async () => {
    const user = userEvent.setup();
    currentSession = sessionForRole("admin");
    globalThis.fetch = vi.fn((input) => {
      const url = String(input);
      if (url.endsWith("/workspaces")) {
        return new Promise(() => {});
      }
      return mockWorkspaceFetch(input);
    });

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));

    expect(await screen.findByRole("heading", { name: "Application Admin" })).toBeTruthy();
    expect(await screen.findByText("Total users 0")).toBeTruthy();
  });

  it("keeps the Application admin page available during Workspace resolution error", async () => {
    const user = userEvent.setup();
    currentSession = sessionForRole("admin");
    globalThis.fetch = vi.fn((input) => {
      const url = String(input);
      if (url.endsWith("/workspaces")) {
        return Promise.resolve(jsonResponse({ error: "failed" }, { status: 500 }));
      }
      return mockWorkspaceFetch(input);
    });

    render(<App />);
    expect(await screen.findByText("Workspace resolution error")).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));

    expect(await screen.findByRole("heading", { name: "Application Admin" })).toBeTruthy();
    expect(await screen.findByText("Total users 0")).toBeTruthy();
  });

  it("shows account-management context without Workspace or out-of-scope account controls", async () => {
    const user = userEvent.setup();
    currentSession = sessionForRole("admin");

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Admin$/ }));

    expect(await screen.findByRole("heading", { name: "Application Admin" })).toBeTruthy();
    expect(screen.getByText("Users, roles, bans, and impersonation")).toBeTruthy();
    expect(screen.getByText("Application-wide")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Workspace toolbar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create Workspace" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create user" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete user" })).toBeNull();
    expect(screen.queryByRole("button", { name: /password/i })).toBeNull();
    expect(screen.queryByText(/Workspace membership/i)).toBeNull();
    expect(screen.queryByText(/Audit log/i)).toBeNull();
  });
});

function sessionForRole(role) {
  return {
    user: {
      id: "user_1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      role,
    },
  };
}

function impersonatedSession() {
  return {
    user: {
      id: "user_regular_1",
      name: "Alan Turing",
      email: "alan@example.com",
      role: "user",
    },
    session: {
      impersonatedBy: "admin_internal_1",
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function installLocalStorage() {
  const storage = new Map([
    [
      "documentextraction.workspace.v1",
      JSON.stringify({ workspaceId: "ws_1", workspaceName: "Research Workspace" }),
    ],
  ]);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key) => storage.get(key) ?? null),
      setItem: vi.fn((key, value) => storage.set(key, String(value))),
      removeItem: vi.fn((key) => storage.delete(key)),
      clear: vi.fn(() => storage.clear()),
    },
  });
}

function mockWorkspaceFetch(input) {
  const url = String(input);

  if (url.endsWith("/workspaces")) {
    return Promise.resolve(
      jsonResponse({
        workspaces: [
          {
            id: "ws_1",
            name: "Research Workspace",
            role: "owner",
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
  }
  if (url.endsWith("/invitations")) {
    return Promise.resolve(jsonResponse({ invitations: [] }));
  }
  if (url.endsWith("/profile")) {
    return Promise.resolve(jsonResponse({ name: "Ada Lovelace", email: "ada@example.com" }));
  }
  if (url.endsWith("/templates")) {
    return Promise.resolve(jsonResponse({ templates: [] }));
  }
  if (url.includes("/jobs")) {
    return Promise.resolve(jsonResponse({ jobs: [], next_cursor: null }));
  }
  if (url.includes("/users")) {
    return Promise.resolve(jsonResponse({ users: [] }));
  }

  return Promise.resolve(jsonResponse({}));
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}
