import type { ReactNode } from "react";
import { CAREER, DEFAULT_WEIGHTS, PILLARS, PILLAR_LABELS, type MajorInfo, type Weights } from "@/lib/career-ranking";

export type Flags = { col: boolean; va: boolean; stretch: boolean };
export const DEFAULT_FLAGS: Flags = { col: true, va: false, stretch: false };

const FLAG_TEXT: { k: keyof Flags; label: string; help: string }[] = [
  { k: "col", label: "Adjust pay for cost of living", help: "Divides pay by the price level where graduates live." },
  { k: "va", label: "Adjust for who gets in", help: "Compares each school's pay with what its admit rate predicts, leaving the school's own effect." },
  { k: "stretch", label: "Count competitive switches", help: "Also counts majors that need a competitive application after you enroll. Long shots never count." },
];

type Props = {
  majors: MajorInfo[];
  targets: string[];
  onTargets: (t: string[]) => void;
  weights: Weights;
  onWeights: (w: Weights) => void;
  flags: Flags;
  onFlags: (f: Flags) => void;
  showTargets: boolean;
  children?: ReactNode;
};

export default function CareerSettings({ majors, targets, onTargets, weights, onWeights, flags, onFlags, showTargets, children }: Props) {
  const tot = PILLARS.reduce((a, k) => a + weights[k], 0) || 1;
  const career = Math.round((100 * CAREER.reduce((a, k) => a + weights[k], 0)) / tot);
  const toggle = (k: string) => {
    const next = targets.includes(k) ? targets.filter((x) => x !== k) : [...targets, k];
    if (next.length) onTargets(majors.filter((m) => next.includes(m.key)).map((m) => m.key));
  };
  return (
    <details className="rk-details rk-settings">
      <summary>
        Adjust the ranking <span className="rk-settings__sum">career {career}% · campus {100 - career}%{flags.col ? " · cost of living on" : ""}{flags.va ? " · adjusted for who gets in" : ""}{flags.stretch ? " · competitive switches on" : ""}</span>
      </summary>
      {showTargets && (
        <div className="rk-settings__group">
          <h4>Majors you want to end up in</h4>
          <div className="rk-pills" role="group" aria-label="Majors you want to end up in">
            {majors.map((m) => (
              <button key={m.key} type="button" className="rk-pill" aria-pressed={targets.includes(m.key)} onClick={() => toggle(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
          <p>Each school is scored on the one you can reach where it does best against that major at other schools. A major you applied to counts directly. Otherwise it counts if switching in after you enroll is open, has a grade bar, or admits most applicants. Saved in this browser only.</p>
        </div>
      )}
      <div className="rk-settings__group">
        <h4>Weights</h4>
        <div className="rk-sliders">
          {PILLARS.map((k) => (
            <label key={k} className="rk-slider">
              <span>{PILLAR_LABELS[k][0]}<small>{PILLAR_LABELS[k][1]}</small></span>
              <input type="range" min={0} max={50} step={5} value={weights[k]} onChange={(e) => { const next = { ...weights, [k]: Number(e.target.value) }; if (PILLARS.some((p) => next[p] > 0)) onWeights(next); }} />
              <output>{Math.round((100 * weights[k]) / tot)}%</output>
            </label>
          ))}
        </div>
      </div>
      <div className="rk-settings__group">
        <div className="rk-pills">
          {FLAG_TEXT.map((f) => (
            <button key={f.k} type="button" className="rk-pill" title={f.help} aria-pressed={flags[f.k]} onClick={() => onFlags({ ...flags, [f.k]: !flags[f.k] })}>
              {f.label}
            </button>
          ))}
          <button type="button" className="rk-link-btn" onClick={() => { onWeights({ ...DEFAULT_WEIGHTS }); onFlags({ ...DEFAULT_FLAGS }); }}>
            Reset
          </button>
        </div>
      </div>
      {children}
    </details>
  );
}
