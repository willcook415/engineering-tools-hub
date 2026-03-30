import { describe, expect, test } from "vitest";
import { parseBatchCoefficientLines, parseCoefficientText, parsePolynomialExpression } from "./parser";

describe("coefficient parser", () => {
  test("parses comma-separated list", () => {
    const out = parseCoefficientText("1, -5, 6");
    expect(out.ok).toBe(true);
    expect(out.coefficients).toEqual([1, -5, 6]);
  });

  test("parses whitespace and newline list", () => {
    const out = parseCoefficientText("1 0\n-5 6");
    expect(out.ok).toBe(true);
    expect(out.coefficients).toEqual([1, 0, -5, 6]);
  });

  test("parses scientific notation", () => {
    const out = parseCoefficientText("1e3; -2.5e-2; 7");
    expect(out.ok).toBe(true);
    expect(out.coefficients).toEqual([1000, -0.025, 7]);
  });

  test("reports invalid tokens", () => {
    const out = parseCoefficientText("1, foo, 3");
    expect(out.ok).toBe(false);
    expect(out.issues.some((i) => i.token === "foo")).toBe(true);
  });

  test("parses polynomial expression", () => {
    const out = parsePolynomialExpression("x^3 - 6x^2 + 11x - 6 = 0");
    expect(out.ok).toBe(true);
    expect(out.coefficients).toEqual([1, -6, 11, -6]);
  });

  test("parses expression with rhs terms", () => {
    const out = parsePolynomialExpression("2x^2 + 4 = x + 1");
    expect(out.ok).toBe(true);
    expect(out.coefficients).toEqual([2, -1, 3]);
  });

  test("parses batch lines", () => {
    const batch = parseBatchCoefficientLines("1,-5\n1,0,1");
    expect(batch.length).toBe(2);
    expect(batch[0].parsed.ok).toBe(true);
    expect(batch[1].parsed.coefficients).toEqual([1, 0, 1]);
  });
});
