import { STEAM_SATURATION_ROWS, type SteamSaturationRow } from "./data";

export function fmt(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return "-";
  const x = Math.abs(value) < 1e-12 ? 0 : value;
  const ax = Math.abs(x);
  if (ax >= 1e6 || (ax > 0 && ax < 1e-4)) return x.toExponential(4);
  return x.toFixed(digits).replace(/\.?0+$/, "");
}

export function fmtSigned(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return "-";
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${fmt(Math.abs(value), digits)}`;
}

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function parseNumeric(raw: Record<string, string>, key: string, issues: string[], label: string, opts?: { min?: number; max?: number; nonZero?: boolean }): number {
  const value = Number(raw[key]);
  if (!Number.isFinite(value)) {
    issues.push(`${label} must be a finite number.`);
    return Number.NaN;
  }
  if (opts?.nonZero && Math.abs(value) < 1e-15) {
    issues.push(`${label} must be non-zero.`);
  }
  if (opts?.min !== undefined && value < opts.min) {
    issues.push(`${label} must be >= ${opts.min}.`);
  }
  if (opts?.max !== undefined && value > opts.max) {
    issues.push(`${label} must be <= ${opts.max}.`);
  }
  return value;
}

export type CsvTable = {
  columns: string[];
  rows: string[][];
};

function splitCsvLine(line: string): string[] {
  return line.split(",").map((cell) => cell.trim());
}

function isNumericToken(token: string): boolean {
  if (token.trim() === "") return false;
  const n = Number(token);
  return Number.isFinite(n);
}

export function parseCsvRows(text: string): CsvTable {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { columns: [], rows: [] };
  }

  const first = splitCsvLine(lines[0]);
  const headerIsText = first.some((token) => !isNumericToken(token));
  const columns = headerIsText ? first : first.map((_, idx) => `col${idx + 1}`);
  const dataLines = headerIsText ? lines.slice(1) : lines;
  const rows = dataLines.map((line) => splitCsvLine(line));

  return { columns, rows };
}

export type XYPoint = { x: number; y: number };

export function parseXYText(text: string): XYPoint[] {
  const out: XYPoint[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const tokens = line.includes(",") ? line.split(",") : line.split(/\s+/);
    if (tokens.length < 2) continue;
    const x = Number(tokens[0].trim());
    const y = Number(tokens[1].trim());
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ x, y });
  }

  return out;
}

export type RegressionResult = {
  predict: (x: number) => number;
  coefficients: number[];
  r2: number;
};

function mean(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function calcR2(points: XYPoint[], predict: (x: number) => number): number {
  const ys = points.map((p) => p.y);
  const yBar = mean(ys);
  const ssTot = ys.reduce((sum, y) => sum + (y - yBar) ** 2, 0);
  const ssRes = points.reduce((sum, p) => sum + (p.y - predict(p.x)) ** 2, 0);
  if (ssTot < 1e-15) return 1;
  return 1 - ssRes / ssTot;
}

export function linearRegression(points: XYPoint[]): RegressionResult {
  const n = points.length;
  const sx = points.reduce((sum, p) => sum + p.x, 0);
  const sy = points.reduce((sum, p) => sum + p.y, 0);
  const sxx = points.reduce((sum, p) => sum + p.x * p.x, 0);
  const sxy = points.reduce((sum, p) => sum + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  const m = Math.abs(denom) < 1e-15 ? 0 : (n * sxy - sx * sy) / denom;
  const b = (sy - m * sx) / Math.max(1, n);
  const predict = (x: number) => m * x + b;
  return { coefficients: [m, b], predict, r2: calcR2(points, predict) };
}

export function solveLinearSystemGauss(matrix: number[][], rhs: number[]): number[] | null {
  const n = matrix.length;
  if (n === 0 || rhs.length !== n) return null;
  const a = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = a[pivot];
      a[pivot] = a[col];
      a[col] = tmp;
    }

    const piv = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] /= piv;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = a[r][col];
      for (let j = col; j <= n; j += 1) a[r][j] -= f * a[col][j];
    }
  }

  return a.map((row) => row[n]);
}

export function polynomial2Regression(points: XYPoint[]): RegressionResult | null {
  if (points.length < 3) return null;
  const n = points.length;
  const sx = points.reduce((s, p) => s + p.x, 0);
  const sx2 = points.reduce((s, p) => s + p.x ** 2, 0);
  const sx3 = points.reduce((s, p) => s + p.x ** 3, 0);
  const sx4 = points.reduce((s, p) => s + p.x ** 4, 0);
  const sy = points.reduce((s, p) => s + p.y, 0);
  const sxy = points.reduce((s, p) => s + p.x * p.y, 0);
  const sx2y = points.reduce((s, p) => s + p.x ** 2 * p.y, 0);

  const solution = solveLinearSystemGauss(
    [
      [sx4, sx3, sx2],
      [sx3, sx2, sx],
      [sx2, sx, n],
    ],
    [sx2y, sxy, sy]
  );
  if (!solution) return null;
  const [a, b, c] = solution;
  const predict = (x: number) => a * x * x + b * x + c;
  return { coefficients: [a, b, c], predict, r2: calcR2(points, predict) };
}

export function exponentialRegression(points: XYPoint[]): RegressionResult | null {
  const filtered = points.filter((p) => p.y > 0);
  if (filtered.length < 2) return null;
  const transformed = filtered.map((p) => ({ x: p.x, y: Math.log(p.y) }));
  const lr = linearRegression(transformed);
  const b = lr.coefficients[0];
  const a = Math.exp(lr.coefficients[1]);
  const predict = (x: number) => a * Math.exp(b * x);
  return { coefficients: [a, b], predict, r2: calcR2(filtered, predict) };
}

export function parseMatrixText(text: string): number[][] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.map((line) =>
    line
      .split(/[\s,;]+/)
      .map((token) => Number(token))
      .filter((v) => Number.isFinite(v))
  );
}

export function parseVectorText(text: string): number[] {
  return text
    .split(/[\s,;\r\n]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => Number(token))
    .filter((v) => Number.isFinite(v));
}

export function determinant(matrix: number[][]): number | null {
  const n = matrix.length;
  if (n === 0) return null;
  if (matrix.some((row) => row.length !== n)) return null;

  const a = matrix.map((row) => [...row]);
  let det = 1;
  let sign = 1;

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return 0;
    if (pivot !== col) {
      const tmp = a[pivot];
      a[pivot] = a[col];
      a[col] = tmp;
      sign *= -1;
    }
    const piv = a[col][col];
    det *= piv;
    for (let r = col + 1; r < n; r += 1) {
      const f = a[r][col] / piv;
      for (let c = col; c < n; c += 1) a[r][c] -= f * a[col][c];
    }
  }

  return det * sign;
}

export function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  if (n === 0 || matrix.some((row) => row.length !== n)) return null;
  const aug = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
    }
    if (Math.abs(aug[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = aug[pivot];
      aug[pivot] = aug[col];
      aug[col] = tmp;
    }
    const piv = aug[col][col];
    for (let c = 0; c < 2 * n; c += 1) aug[col][c] /= piv;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = aug[r][col];
      for (let c = 0; c < 2 * n; c += 1) aug[r][c] -= f * aug[col][c];
    }
  }

  return aug.map((row) => row.slice(n));
}

export type SteamInterpolationMode = "temperature" | "pressure";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolateRow(a: SteamSaturationRow, b: SteamSaturationRow, t: number): SteamSaturationRow {
  return {
    tC: lerp(a.tC, b.tC, t),
    pKPa: lerp(a.pKPa, b.pKPa, t),
    hf: lerp(a.hf, b.hf, t),
    hfg: lerp(a.hfg, b.hfg, t),
    sf: lerp(a.sf, b.sf, t),
    sfg: lerp(a.sfg, b.sfg, t),
    vf: lerp(a.vf, b.vf, t),
    vg: lerp(a.vg, b.vg, t),
  };
}

export function interpolateSteamSaturation(mode: SteamInterpolationMode, value: number): SteamSaturationRow | null {
  if (!Number.isFinite(value)) return null;
  const key = mode === "temperature" ? "tC" : "pKPa";
  const rows = STEAM_SATURATION_ROWS;
  if (rows.length < 2) return null;

  const min = rows[0][key];
  const max = rows[rows.length - 1][key];
  if (value < min || value > max) return null;

  for (let i = 1; i < rows.length; i += 1) {
    const a = rows[i - 1];
    const b = rows[i];
    const va = a[key];
    const vb = b[key];
    if (value >= va && value <= vb) {
      const t = Math.abs(vb - va) < 1e-15 ? 0 : (value - va) / (vb - va);
      return interpolateRow(a, b, t);
    }
  }

  return null;
}

export type TraverseLeg = {
  distance: number;
  bearingDeg: number;
};

export type TraverseAdjustment = {
  closureNorth: number;
  closureEast: number;
  misclosure: number;
  totalLength: number;
  closureRatio: number;
  adjusted: Array<{
    leg: number;
    distance: number;
    bearingDeg: number;
    northing: number;
    easting: number;
    adjNorthing: number;
    adjEasting: number;
    x: number;
    y: number;
  }>;
};

export function computeBowditchAdjustment(legs: TraverseLeg[]): TraverseAdjustment | null {
  if (legs.length === 0) return null;
  if (legs.some((l) => !Number.isFinite(l.distance) || l.distance <= 0 || !Number.isFinite(l.bearingDeg))) return null;

  const components = legs.map((leg) => {
    const angle = toRad(leg.bearingDeg);
    const northing = leg.distance * Math.cos(angle);
    const easting = leg.distance * Math.sin(angle);
    return { ...leg, northing, easting };
  });

  const closureNorth = components.reduce((sum, c) => sum + c.northing, 0);
  const closureEast = components.reduce((sum, c) => sum + c.easting, 0);
  const misclosure = Math.hypot(closureNorth, closureEast);
  const totalLength = components.reduce((sum, c) => sum + c.distance, 0);

  let x = 0;
  let y = 0;
  const adjusted = components.map((component, idx) => {
    const weight = component.distance / Math.max(totalLength, 1e-12);
    const corrN = -closureNorth * weight;
    const corrE = -closureEast * weight;
    const adjNorthing = component.northing + corrN;
    const adjEasting = component.easting + corrE;
    x += adjEasting;
    y += adjNorthing;
    return {
      leg: idx + 1,
      distance: component.distance,
      bearingDeg: component.bearingDeg,
      northing: component.northing,
      easting: component.easting,
      adjNorthing,
      adjEasting,
      x,
      y,
    };
  });

  return {
    closureNorth,
    closureEast,
    misclosure,
    totalLength,
    closureRatio: misclosure === 0 ? Number.POSITIVE_INFINITY : totalLength / misclosure,
    adjusted,
  };
}
