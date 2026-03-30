export function fmtSi(v: number, digits = 3) {
  if (!Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  if (abs === 0) return "0";
  if (abs >= 1e9) return `${(v / 1e9).toFixed(digits)}G`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(digits)}k`;
  if (abs >= 1e-3) return v.toFixed(digits);
  return v.toExponential(2);
}

export function fmtDeflection(v: number) {
  if (!Number.isFinite(v)) return "";
  const ax = Math.abs(v);
  if (ax >= 1e-3) return `${(v * 1e3).toFixed(3)} mm`;
  if (ax >= 1e-6) return `${(v * 1e6).toFixed(3)} um`;
  if (ax >= 1e-9) return `${(v * 1e9).toFixed(3)} nm`;
  return `${v.toExponential(2)} m`;
}
