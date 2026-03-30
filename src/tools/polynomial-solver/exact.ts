import type { Complex } from "./model";
import { c, cAdd, cCbrt, cDiv, cMul, cScale, cSqrt, cSub } from "./complex";

function solveLinearMonic(coeffs: number[]) {
  const [, b] = coeffs;
  return [c(-b, 0)];
}

function solveQuadraticMonic(coeffs: number[]) {
  const [, b, d] = coeffs;
  const disc = cSub(c(b * b, 0), c(4 * d, 0));
  const rootDisc = cSqrt(disc);
  const minusB = c(-b, 0);
  const r1 = cScale(cAdd(minusB, rootDisc), 0.5);
  const r2 = cScale(cSub(minusB, rootDisc), 0.5);
  return [r1, r2];
}

function solveCubicMonic(coeffs: number[]) {
  const [, a, b, cc] = coeffs;
  const p = b - (a * a) / 3;
  const q = (2 * a * a * a) / 27 - (a * b) / 3 + cc;

  const halfQ = c(-q / 2, 0);
  const delta = cAdd(c((q * q) / 4, 0), c((p * p * p) / 27, 0));
  const sqrtDelta = cSqrt(delta);
  const u = cCbrt(cAdd(halfQ, sqrtDelta));
  const v = cCbrt(cSub(halfQ, sqrtDelta));

  const omega = c(-0.5, Math.sqrt(3) / 2);
  const omega2 = c(-0.5, -Math.sqrt(3) / 2);

  const y1 = cAdd(u, v);
  const y2 = cAdd(cMul(omega, u), cMul(omega2, v));
  const y3 = cAdd(cMul(omega2, u), cMul(omega, v));
  const shift = c(a / 3, 0);

  return [cSub(y1, shift), cSub(y2, shift), cSub(y3, shift)];
}

function solveQuadraticComplex(b: Complex, cc: Complex) {
  const disc = cSub(cMul(b, b), cScale(cc, 4));
  const rootDisc = cSqrt(disc);
  const minusB = cScale(b, -1);
  const r1 = cScale(cAdd(minusB, rootDisc), 0.5);
  const r2 = cScale(cSub(minusB, rootDisc), 0.5);
  return [r1, r2];
}

function solveQuarticMonic(coeffs: number[]) {
  const [, a, b, cc, d] = coeffs;

  const p = b - (3 * a * a) / 8;
  const q = cc - (a * b) / 2 + (a * a * a) / 8;
  const r = d - (a * cc) / 4 + (a * a * b) / 16 - (3 * a * a * a * a) / 256;

  // Solve S^3 + 2p S^2 + (p^2 - 4r)S - q^2 = 0  where S = s^2
  const cubic = [1, 2 * p, p * p - 4 * r, -(q * q)];
  const sSquaredCandidates = solveCubicMonic(cubic);
  const sSquared = sSquaredCandidates[0];
  const s = cSqrt(sSquared);

  const eps = 1e-12;
  if (Math.hypot(s.re, s.im) < eps) {
    throw new Error("Ferrari branch singularity");
  }

  const sumTU = cAdd(sSquared, c(p, 0));
  const qOverS = cDiv(c(q, 0), s);
  const t = cScale(cSub(sumTU, qOverS), 0.5);
  const u = cScale(cAdd(sumTU, qOverS), 0.5);

  const rootsA = solveQuadraticComplex(s, t);
  const rootsB = solveQuadraticComplex(cScale(s, -1), u);
  const shift = c(a / 4, 0);
  return [...rootsA, ...rootsB].map((root) => cSub(root, shift));
}

export function solveExactMonic(coeffs: number[]): Complex[] | null {
  const degree = coeffs.length - 1;
  if (degree < 1 || degree > 4) return null;

  if (degree === 1) return solveLinearMonic(coeffs);
  if (degree === 2) return solveQuadraticMonic(coeffs);
  if (degree === 3) return solveCubicMonic(coeffs);
  return solveQuarticMonic(coeffs);
}
