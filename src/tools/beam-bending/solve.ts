import type { SolveResult } from "../_shared/steps/stepTypes";
import type {
  BeamBendingInputs,
  BeamBendingOutputs,
  BeamBendingPlots,
  Load,
  PointLoad,
  UDL,
  PointMoment,
} from "./model";

function linspace(a: number, b: number, n: number) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
  return out;
}

function fmt(x: number, sig = 6) {
  if (!Number.isFinite(x)) return "—";
  const abs = Math.abs(x);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return x.toExponential(3);
  return Number(x.toPrecision(sig)).toString();
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function isPointLoad(l: Load): l is PointLoad {
  return l.type === "point_load";
}
function isUDL(l: Load): l is UDL {
  return l.type === "udl";
}
function isMoment(l: Load): l is PointMoment {
  return l.type === "moment";
}

/**
 * Conventions used here (keep consistent across UI + docs):
 * - Point load P > 0 means DOWNWARD
 * - UDL w > 0 means DOWNWARD (N/m)
 * - Reactions are UPWARD
 * - Point moment M: we treat M > 0 as CLOCKWISE applied moment.
 *
 * Equilibrium for simply supported:
 *   R1 + R2 = ΣP + ΣW
 *   R2*L = Σ(P*x) + Σ(W*x̄) + Σ(Mcw)
 *
 * Shear:
 *   V(x) = R1 - Σ P_i H(x-xi) - Σ w_j * clamp(x-x1, 0, Lj)
 *
 * Moment:
 *   M(x) = R1 x - Σ P_i max(0, x-xi) - Σ (w_j/2)*clamp(x-x1,0,Lj)^2 - Σ M_k H(x-xk)
 *
 * Deflection:
 *   y''(x) = -M(x)/(E I)
 * Numerical integration, enforce y(0)=0 and y(L)=0 by choosing theta0.
 */
export function solveBeamBending(
  inp: BeamBendingInputs
): SolveResult<BeamBendingOutputs, BeamBendingPlots> {
  const { support, L, E, I, loads } = inp;

  if (!Number.isFinite(L) || L <= 0) throw new Error("L must be > 0");
  if (!Number.isFinite(E) || E <= 0) throw new Error("E must be > 0");
  if (!Number.isFinite(I) || I <= 0) throw new Error("I must be > 0");

  if (support !== "simply_supported") {
    throw new Error("Only simply supported is implemented right now (cantilever next).");
  }

  // Clamp/normalise loads into [0,L]
  const pts = loads
    .filter(isPointLoad)
    .map((p) => ({ ...p, x: clamp(p.x, 0, L) }));

  const udls = loads
    .filter(isUDL)
    .map((u) => {
      const x1 = clamp(Math.min(u.x1, u.x2), 0, L);
      const x2 = clamp(Math.max(u.x1, u.x2), 0, L);
      return { ...u, x1, x2 };
    });

  const moms = loads
    .filter(isMoment)
    .map((m) => ({ ...m, x: clamp(m.x, 0, L) }));

  // Total vertical loads
  const totalPoint = pts.reduce((s, p) => s + p.P, 0);
  const totalUdl = udls.reduce((s, u) => s + u.w * (u.x2 - u.x1), 0);
  const totalLoad = totalPoint + totalUdl;

  // Moments about left support (CCW positive):
  // R2*L - Σ(P*x) - Σ(W*xbar) - Σ(Mcw) = 0
  // => R2 = (Σ(P*x) + Σ(W*xbar) + Σ(Mcw)) / L
  const mPoint = pts.reduce((s, p) => s + p.P * p.x, 0);

  const mUdl = udls.reduce((s, u) => {
    const W = u.w * (u.x2 - u.x1);
    const xbar = 0.5 * (u.x1 + u.x2);
    return s + W * xbar;
  }, 0);

  const mCw = moms.reduce((s, m) => s + m.M, 0);

  const R2 = (mPoint + mUdl + mCw) / L;
  const R1 = totalLoad - R2;

  // Sampling along the beam
  const xs = linspace(0, L, 360);

  const sfd = xs.map((x) => {
    let V = R1;

    for (const p of pts) if (x >= p.x) V -= p.P;

    for (const u of udls) {
      const seg = clamp(x - u.x1, 0, u.x2 - u.x1);
      V -= u.w * seg;
    }

    return { x, V };
  });

  const bmd = xs.map((x) => {
    let M = R1 * x;

    for (const p of pts) if (x >= p.x) M -= p.P * (x - p.x);

    for (const u of udls) {
      const seg = clamp(x - u.x1, 0, u.x2 - u.x1);
      M -= (u.w * 0.5) * seg * seg;
    }

    // Clockwise applied moment produces a negative jump in internal M(x)
    for (const m of moms) if (x >= m.x) M -= m.M;

    return { x, M };
  });

  // Deflection via numerical integration:
  // y'' = -M/(EI)
  const kappa = bmd.map((p) => -p.M / (E * I)); // curvature
  const thetaFrom0 = new Array(xs.length).fill(0); // slope with theta(0)=0
  const yFrom0 = new Array(xs.length).fill(0); // deflection with y(0)=0

  for (let i = 1; i < xs.length; i++) {
    const dx = xs[i] - xs[i - 1];
    thetaFrom0[i] = thetaFrom0[i - 1] + 0.5 * (kappa[i - 1] + kappa[i]) * dx;
    yFrom0[i] = yFrom0[i - 1] + 0.5 * (thetaFrom0[i - 1] + thetaFrom0[i]) * dx;
  }

  // Enforce y(L)=0 by choosing initial slope theta0:
  const yL = yFrom0[yFrom0.length - 1];
  const theta0 = -yL / L;

  const deflection = xs.map((x, i) => ({ x, y: yFrom0[i] + theta0 * x }));

  // Extremes
  let yMin = Infinity;
  let xAtYMin = 0;
  for (const p of deflection) {
    if (p.y < yMin) {
      yMin = p.y;
      xAtYMin = p.x;
    }
  }

  let Mmax = -Infinity;
  let xMmax = 0;
  for (const p of bmd) {
    if (p.M > Mmax) {
      Mmax = p.M;
      xMmax = p.x;
    }
  }

  const outputs: BeamBendingOutputs = {
    reactions: {
      R1,
      R2,
    },
    Mmax,
    xMmax,
    yMaxDown: yMin,
    xAtYMaxDown: xAtYMin,
  };

  const steps = [
    { title: "Loads summary" },
    { note: `Support: ${support}` },
    { note: `L=${fmt(L)} m, E=${fmt(E)} Pa, I=${fmt(I)} m^4` },
    {
      note:
        pts.length === 0
          ? "Point loads: none"
          : `Point loads: ${pts.map((p) => `${p.id}: P=${fmt(p.P)} N at x=${fmt(p.x)} m`).join(" | ")}`,
    },
    {
      note:
        udls.length === 0
          ? "UDLs: none"
          : `UDLs: ${udls
              .map((u) => `${u.id}: w=${fmt(u.w)} N/m from ${fmt(u.x1)}→${fmt(u.x2)} m`)
              .join(" | ")}`,
    },
    {
      note:
        moms.length === 0
          ? "Moments: none"
          : `Moments: ${moms.map((m) => `${m.id}: M=${fmt(m.M)} N·m at x=${fmt(m.x)} m`).join(" | ")}`,
    },

    { title: "Reactions (equilibrium)" },
    { latex: `\\sum F_y=0\\Rightarrow R_1+R_2=\\sum P + \\sum W` },
    { latex: `\\sum M_{x=0}=0\\Rightarrow R_2L=\\sum(Px)+\\sum(W\\bar{x})+\\sum(M_{cw})` },
    { latex: `R_2=\\dfrac{${fmt(mPoint)}+${fmt(mUdl)}+${fmt(mCw)}}{${fmt(L)}}=${fmt(R2)}\\ \\mathrm{N}` },
    { latex: `R_1=(${fmt(totalLoad)})-(${fmt(R2)})=${fmt(R1)}\\ \\mathrm{N}` },

    { title: "Shear V(x)" },
    {
      latex: `V(x)=R_1-\\sum P_iH(x-x_i)-\\sum w_j\\,\\mathrm{clamp}(x-x_{1j},0,L_j)`,
    },

    { title: "Moment M(x)" },
    {
      latex:
        moms.length > 0
          ? `M(x)=R_1x-\\sum P_i\\max(0,x-x_i)-\\sum\\frac{w_j}{2}\\,\\mathrm{clamp}(x-x_{1j},0,L_j)^2-\\sum M_kH(x-x_k)`
          : `M(x)=R_1x-\\sum P_i\\max(0,x-x_i)-\\sum\\frac{w_j}{2}\\,\\mathrm{clamp}(x-x_{1j},0,L_j)^2`,
    },

    { title: "Deflection y(x)" },
    { latex: `y''(x)=-\\dfrac{M(x)}{EI}` },
    { note: "Numerical integration with boundary conditions y(0)=0 and y(L)=0." },
    { note: `Max downward deflection: y_min=${fmt(yMin)} m at x=${fmt(xAtYMin)} m` },
  ];

  return {
    outputs,
    steps,
    plots: { sfd, bmd, deflection },
  };
}