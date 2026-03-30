import { describe, expect, test } from "vitest";
import { getToolRuntimeSpec } from "./specs";
import { computeBowditchAdjustment, interpolateSteamSaturation, parseCsvRows } from "./utils";

describe("mvp utility behaviors", () => {
  test("csv parser detects header row", () => {
    const table = parseCsvRows("x,y\n1,2\n3,4");
    expect(table.columns).toEqual(["x", "y"]);
    expect(table.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  test("steam saturation interpolation works inside table range", () => {
    const row = interpolateSteamSaturation("temperature", 110);
    expect(row).toBeTruthy();
    if (!row) return;
    expect(row.tC).toBeGreaterThanOrEqual(100);
    expect(row.tC).toBeLessThanOrEqual(120);
    expect(row.pKPa).toBeGreaterThan(101.325);
    expect(row.pKPa).toBeLessThan(198.67);
  });

  test("bowditch adjustment closes traverse after corrections", () => {
    const adjusted = computeBowditchAdjustment([
      { distance: 120, bearingDeg: 30 },
      { distance: 95, bearingDeg: 105 },
      { distance: 110, bearingDeg: 190 },
      { distance: 102, bearingDeg: 280 },
    ]);
    expect(adjusted).toBeTruthy();
    if (!adjusted) return;
    const last = adjusted.adjusted[adjusted.adjusted.length - 1];
    expect(Math.hypot(last.x, last.y)).toBeLessThan(1e-6);
  });
});

describe("mvp spec dedicated workflows", () => {
  test("csv data tool computes derived columns", () => {
    const spec = getToolRuntimeSpec("data-table-csv-tool");
    expect(spec).toBeTruthy();
    if (!spec) return;

    const raw = {
      csv: "x,y\n2,3\n4,5",
      derived: "z=x*y",
    };
    expect(spec.validate(raw)).toEqual([]);
    const result = spec.compute(raw);
    expect(result.table?.columns).toEqual(["x", "y", "z"]);
    expect(result.table?.rows[0]).toEqual(["2", "3", "6"]);
    expect(result.table?.rows[1]).toEqual(["4", "5", "20"]);
  });

  test("matrix solver flags singular system with stability warnings", () => {
    const spec = getToolRuntimeSpec("matrix-solver");
    expect(spec).toBeTruthy();
    if (!spec) return;

    const raw = {
      A: "1,2\n2,4",
      b: "3\n6",
    };
    expect(spec.validate(raw)).toEqual([]);
    const result = spec.compute(raw);
    expect(result.outputs.find((o) => o.label === "Solution x")?.value).toContain("No unique solution");
    expect(result.warnings.some((w) => w.code === "stability")).toBe(true);
    expect(result.checks.find((c) => c.label === "Invertible")?.pass).toBe(false);
  });

  test("steam properties warns when lookup is outside embedded saturation range", () => {
    const spec = getToolRuntimeSpec("steam-properties");
    expect(spec).toBeTruthy();
    if (!spec) return;

    const raw = {
      mode: "temperature",
      value: "500",
      quality: "0.9",
    };
    expect(spec.validate(raw)).toEqual([]);
    const result = spec.compute(raw);
    expect(result.outputs.length).toBe(0);
    expect(result.warnings.some((w) => w.code === "range")).toBe(true);
  });

  test("traverse adjustment tool returns adjusted coordinate table", () => {
    const spec = getToolRuntimeSpec("survey-traverse-adjustment");
    expect(spec).toBeTruthy();
    if (!spec) return;

    const issues = spec.validate(spec.sampleValid);
    expect(issues).toEqual([]);

    const result = spec.compute(spec.sampleValid);
    expect(result.table).toBeTruthy();
    expect((result.table?.rows.length ?? 0)).toBeGreaterThanOrEqual(2);
    expect(result.outputs.some((o) => o.label === "Misclosure")).toBe(true);
  });
});
