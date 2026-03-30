import { describe, expect, test } from "vitest";
import { solvePolynomial } from "./solve";

function closeTo(actual: number, expected: number, tol = 1e-6) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

describe("polynomial solver", () => {
  test("solves linear equation x - 5 = 0", () => {
    const out = solvePolynomial({ coefficients: [1, -5] }).outputs;
    expect(out.roots.length).toBe(1);
    expect(out.methodUsed).toBe("exact");
    closeTo(out.roots[0].value.re, 5, 1e-8);
    closeTo(out.roots[0].value.im, 0, 1e-8);
  });

  test("solves quadratic with distinct real roots", () => {
    const out = solvePolynomial({ coefficients: [1, -5, 6] }).outputs;
    const roots = out.roots.map((r) => r.value.re).sort((a, b) => a - b);
    closeTo(roots[0], 2, 1e-6);
    closeTo(roots[1], 3, 1e-6);
  });

  test("detects repeated root multiplicity for (x-2)^2", () => {
    const out = solvePolynomial({ coefficients: [1, -4, 4] }).outputs;
    expect(out.roots.length).toBe(1);
    expect(out.roots[0].multiplicity).toBe(2);
    closeTo(out.roots[0].value.re, 2, 1e-5);
  });

  test("returns complex conjugate pair for x^2 + 1", () => {
    const out = solvePolynomial({ coefficients: [1, 0, 1] }).outputs;
    expect(out.roots.length).toBe(2);
    expect(out.roots.every((r) => r.classification === "complex")).toBe(true);
    const imag = out.roots.map((r) => Math.abs(r.value.im)).sort((a, b) => a - b);
    closeTo(imag[0], 1, 1e-6);
    closeTo(imag[1], 1, 1e-6);
  });

  test("solves cubic with one real and one complex pair", () => {
    const out = solvePolynomial({ coefficients: [1, 0, 1, 1] }).outputs; // (x+1)(x^2-x+1)
    expect(out.roots.length).toBe(3);
    expect(["exact", "hybrid_fallback"]).toContain(out.methodUsed);
    const real = out.roots.find((r) => r.classification === "real");
    expect(real).toBeTruthy();
    closeTo(real!.value.re, -0.6823278038, 1e-4);
  });

  test("handles high degree synthetic polynomial", () => {
    const out = solvePolynomial({ coefficients: [1, -10, 35, -50, 24] }).outputs; // (x-1)(x-2)(x-3)(x-4)
    expect(out.converged || out.methodUsed === "exact").toBe(true);
    expect(out.maxResidual).toBeLessThan(1e-5);
    expect(out.roots.length).toBe(4);
  });

  test("flags non-convergence when iterations are too low", () => {
    const out = solvePolynomial({ coefficients: [1, 0, 0, 0, -1], maxIterations: 5, deltaTolerance: 1e-20 }).outputs;
    expect(out.converged).toBe(false);
    expect(out.diagnostics.some((d) => d.code === "non_convergence")).toBe(true);
  });

  test("residuals stay small for converged case", () => {
    const out = solvePolynomial({ coefficients: [1, -6, 11, -6] }).outputs; // roots: 1,2,3
    expect(out.converged || out.methodUsed === "exact").toBe(true);
    expect(out.maxResidual).toBeLessThan(1e-6);
  });
});
