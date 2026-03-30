import type { Complex } from "./model";

export function c(re = 0, im = 0): Complex {
  return { re, im };
}

export function cAdd(a: Complex, b: Complex): Complex {
  return c(a.re + b.re, a.im + b.im);
}

export function cSub(a: Complex, b: Complex): Complex {
  return c(a.re - b.re, a.im - b.im);
}

export function cMul(a: Complex, b: Complex): Complex {
  return c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

export function cScale(a: Complex, s: number): Complex {
  return c(a.re * s, a.im * s);
}

export function cDiv(a: Complex, b: Complex): Complex {
  const den = b.re * b.re + b.im * b.im;
  if (den < 1e-24) return c(0, 0);
  return c((a.re * b.re + a.im * b.im) / den, (a.im * b.re - a.re * b.im) / den);
}

export function cAbs(a: Complex): number {
  return Math.hypot(a.re, a.im);
}

export function cConj(a: Complex): Complex {
  return c(a.re, -a.im);
}

export function cArg(a: Complex): number {
  return Math.atan2(a.im, a.re);
}

export function cSqrt(a: Complex): Complex {
  const r = cAbs(a);
  if (r < 1e-24) return c(0, 0);
  const theta = cArg(a) / 2;
  return c(Math.sqrt(r) * Math.cos(theta), Math.sqrt(r) * Math.sin(theta));
}

export function cPowReal(a: Complex, p: number): Complex {
  const r = cAbs(a);
  if (r < 1e-24) return c(0, 0);
  const theta = cArg(a);
  const rp = Math.pow(r, p);
  const tp = theta * p;
  return c(rp * Math.cos(tp), rp * Math.sin(tp));
}

export function cCbrt(a: Complex): Complex {
  return cPowReal(a, 1 / 3);
}

export function cDist(a: Complex, b: Complex): number {
  return cAbs(cSub(a, b));
}

export function evalPoly(coeffs: number[], z: Complex): Complex {
  let acc = c(coeffs[0], 0);
  for (let i = 1; i < coeffs.length; i += 1) {
    acc = cAdd(cMul(acc, z), c(coeffs[i], 0));
  }
  return acc;
}

export function evalPolyDerivative(coeffs: number[], z: Complex): Complex {
  const n = coeffs.length - 1;
  if (n <= 0) return c(0, 0);
  let acc = c(coeffs[0] * n, 0);
  for (let i = 1; i < n; i += 1) {
    const power = n - i;
    acc = cAdd(cMul(acc, z), c(coeffs[i] * power, 0));
  }
  return acc;
}

export function normalizeMonic(coeffs: number[]) {
  const lead = coeffs[0];
  return coeffs.map((v) => v / lead);
}

export function rootsFromConjugatePairs(roots: Complex[]) {
  const used = new Array(roots.length).fill(false);
  let pairId = 1;
  const pairs = new Map<number, number>();
  for (let i = 0; i < roots.length; i += 1) {
    if (used[i]) continue;
    const a = roots[i];
    if (Math.abs(a.im) < 1e-10) continue;
    for (let j = i + 1; j < roots.length; j += 1) {
      if (used[j]) continue;
      const b = roots[j];
      if (Math.abs(a.re - b.re) <= 1e-6 && Math.abs(a.im + b.im) <= 1e-6) {
        pairs.set(i, pairId);
        pairs.set(j, pairId);
        used[i] = true;
        used[j] = true;
        pairId += 1;
        break;
      }
    }
  }
  return pairs;
}
