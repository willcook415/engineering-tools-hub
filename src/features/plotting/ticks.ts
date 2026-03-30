export function niceStep(L: number) {
  const targetTicks = 6; // ~6 major ticks
  const rough = L / targetTicks;

  const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-12))));
  const n = rough / pow10;

  let base = 1;
  if (n <= 1) base = 1;
  else if (n <= 2) base = 2;
  else if (n <= 2.5) base = 2.5;
  else if (n <= 5) base = 5;
  else base = 10;

  return base * pow10;
}

export function xTicks(L: number) {
  if (!Number.isFinite(L) || L <= 0) return [0, 1];

  const step = niceStep(L);
  const ticks: number[] = [];
  for (let x = 0; x < L - 1e-9; x += step) ticks.push(roundNice(x));
  ticks.push(roundNice(L));
  return Array.from(new Set(ticks));
}

function roundNice(x: number) {
  return Math.round(x * 1e6) / 1e6;
}

export function yDomainPad(min: number, max: number, padFrac = 0.12) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return ["auto", "auto"] as const;
  if (min === max) {
    const d = Math.abs(min) || 1;
    return [min - d * 0.2, max + d * 0.2] as const;
  }
  const span = max - min;
  return [min - span * padFrac, max + span * padFrac] as const;
}