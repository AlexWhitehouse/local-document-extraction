export type AccountPasswordPolicyRequirement =
  | "min_length"
  | "uppercase"
  | "number"
  | "special";

export type AccountPasswordPolicyResult = {
  valid: boolean;
  unmetRequirements: AccountPasswordPolicyRequirement[];
};

export function evaluateAccountPasswordPolicy(
  password: string,
): AccountPasswordPolicyResult {
  const unmetRequirements: AccountPasswordPolicyRequirement[] = [];

  if (password.length < 8) {
    unmetRequirements.push("min_length");
  }
  if (!/[A-Z]/.test(password)) {
    unmetRequirements.push("uppercase");
  }
  if (!/[0-9]/.test(password)) {
    unmetRequirements.push("number");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    unmetRequirements.push("special");
  }

  return {
    valid: unmetRequirements.length === 0,
    unmetRequirements,
  };
}
