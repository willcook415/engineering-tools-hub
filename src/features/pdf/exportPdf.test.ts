import { describe, expect, test } from "vitest";
import { paginateHeights } from "./exportPdf";

describe("pdf pagination helper", () => {
  test("paginates sections without splitting section blocks", () => {
    const pages = paginateHeights([40, 45, 70, 20, 50], 100);
    expect(pages).toEqual([[0, 1], [2, 3], [4]]);
  });

  test("keeps a single large section on its own page", () => {
    const pages = paginateHeights([120], 100);
    expect(pages).toEqual([[0]]);
  });
});
