import { describe, expect, it, vi } from "vitest";
import { appPath, followAppLink, parseAppRoute } from "./appRoutes";

describe("app routes", () => {
  it.each([
    { page: "workspace", workspaceId: "workspace a" },
    { page: "templates", workspaceId: "a", templateId: "two" },
    { page: "documents", workspaceId: "a", documentId: "one" },
    { page: "documents", workspaceId: "a", packetId: "packet" },
    { page: "documents", workspaceId: "a", packetId: "packet", documentId: "child" },
    { page: "evaluations", workspaceId: "a" },
    { page: "costs", workspaceId: "a", costTab: "overview" },
    { page: "costs", workspaceId: "a", costTab: "documents" },
    { page: "admin" },
    { page: "workspace", invitationId: "invited" },
  ])("round trips %j", route => expect(parseAppRoute(appPath(route))).toEqual(route));
  it.each(["/%zz", "/workspaces/a%2fb", "/workspaces/a%5cb", "/workspaces/%00", "//example.com", "/workspaces/a/evaluations/run", "/workspaces/a/packets"])("rejects %s", path => {
    expect(parseAppRoute(path).page).toBe("not-found");
  });
  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }])("keeps native new-tab behavior for %j", options => {
    const event = { button: 0, preventDefault: vi.fn(), ...options };
    const navigate = vi.fn();
    followAppLink(event, navigate);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
