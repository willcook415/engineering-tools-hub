import { describe, expect, test } from "vitest";
import { getPolynomialInputIssues, trimLeadingNearZero } from "./validation";

describe("polynomial validation", () => {
  test("rejects empty coefficients", () => {
    const issues = getPolynomialInputIssues({ coefficients: [] });
    expect(issues.some((x) => x.includes("at least two coefficients"))).toBe(true);
  });

  test("rejects all-zero coefficients", () => {
    const issues = getPolynomialInputIssues({ coefficients: [0, 0, 0] });
    expect(issues.some((x) => x.includes("All coefficients are zero"))).toBe(true);
  });

  test("rejects degree above limit", () => {
    const coeffs = Array.from({ length: 13 }, () => 1);
    const issues = getPolynomialInputIssues({ coefficients: coeffs });
    expect(issues.some((x) => x.includes("exceeds max supported degree"))).toBe(true);
  });

  test("rejects invalid tolerance and max iterations", () => {
    const issues = getPolynomialInputIssues({ coefficients: [1, -1], deltaTolerance: 0, residualTolerance: 0, maxIterations: 3 });
    expect(issues.some((x) => x.includes("Delta tolerance"))).toBe(true);
    expect(issues.some((x) => x.includes("Residual tolerance"))).toBe(true);
    expect(issues.some((x) => x.includes("Max iterations"))).toBe(true);
  });

  test("trims leading near-zero coefficients", () => {
    const trimmed = trimLeadingNearZero([0, 1e-16, 2, -3], 1e-14);
    expect(trimmed).toEqual([2, -3]);
  });
});
