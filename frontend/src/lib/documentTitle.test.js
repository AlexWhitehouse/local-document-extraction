import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatDocumentTitle, useDocumentTitle } from "./documentTitle.js";

describe("formatDocumentTitle", () => {
  it("joins the item, page and workspace and omits missing parts", () => {
    expect(formatDocumentTitle({ item: "Invoice", page: "Templates", workspace: "Acme" })).toBe(
      "Invoice · Templates · Acme — Studio",
    );
    expect(formatDocumentTitle({ page: "Templates", workspace: "Acme" })).toBe("Templates · Acme — Studio");
    expect(formatDocumentTitle({ page: "Sign in" })).toBe("Sign in — Studio");
    expect(formatDocumentTitle({ item: "  ", workspace: undefined })).toBe("Studio");
  });
});

describe("useDocumentTitle", () => {
  it("sets document.title and follows changes to the page", () => {
    const { rerender, unmount } = renderHook(({ page }) => useDocumentTitle({ page, workspace: "Acme" }), {
      initialProps: { page: "Templates" },
    });

    expect(document.title).toBe("Templates · Acme — Studio");

    rerender({ page: "Costs" });
    expect(document.title).toBe("Costs · Acme — Studio");

    unmount();
  });
});
