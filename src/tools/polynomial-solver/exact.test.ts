import { describe, expect, test } from "vitest";
import { normalizeMonic } from "./complex";
import { solveExactMonic } from "./exact";

function close(actual: number, expected: number, tol = 1e-6) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

describe("exact polynomial roots", () => {
  test("linear", () => {
    const roots = solveExactMonic(normalizeMonic([2, -10]))!;
    expect(roots).toHaveLength(1);
    close(roots[0].re, 5, 1e-9);
    close(roots[0].im, 0, 1e-9);
  });

  test("quadratic", () => {
    const roots = solveExactMonic([1, -5, 6])!;
    const rs = roots.map((r) => r.re).sort((a, b) => a - b);
    close(rs[0], 2, 1e-6);
    close(rs[1], 3, 1e-6);
  });

  test("cubic", () => {
    const roots = solveExactMonic([1, -6, 11, -6])!;
    const rs = roots.map((r) => r.re).sort((a, b) => a - b);
    close(rs[0], 1, 1e-5);
    close(rs[1], 2, 1e-5);
    close(rs[2], 3, 1e-5);
  });

  test("quartic", () => {
    const roots = solveExactMonic([1, 0, -5, 0, 4])!; // (x^2-1)(x^2-4)
    const rs = roots.map((r) => r.re).sort((a, b) => a - b);
    close(rs[0], -2, 1e-4);
    close(rs[1], -1, 1e-4);
    close(rs[2], 1, 1e-4);
    close(rs[3], 2, 1e-4);
  });
});
