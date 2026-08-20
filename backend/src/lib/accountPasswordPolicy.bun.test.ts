import { describe, expect, it } from "bun:test";

import { evaluateAccountPasswordPolicy } from "./accountPasswordPolicy";

describe("Account password policy", () => {
  it("reports all unmet requirements for a weak account password", () => {
    expect(evaluateAccountPasswordPolicy("short")).toEqual({
      valid: false,
      unmetRequirements: ["min_length", "uppercase", "number", "special"],
    });
  });

  it("accepts an account password that satisfies the full policy", () => {
    expect(evaluateAccountPasswordPolicy("Strong1!")).toEqual({
      valid: true,
      unmetRequirements: [],
    });
  });

  it("treats any non-alphanumeric character as the special-character requirement", () => {
    expect(evaluateAccountPasswordPolicy("Strong1 ")).toEqual({
      valid: true,
      unmetRequirements: [],
    });
  });
});
