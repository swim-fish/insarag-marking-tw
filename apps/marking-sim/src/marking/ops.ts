// Converts marking state into ordered drawing operations on a canvas.
// Scale: 5 px = 1 cm on the real surface, so sizes follow S5 (ID ~40 cm, records ~10 cm, V ~50 cm).

import { markingDate, teamLabel, worksiteId } from "../model/format";
import type { Edition, RcmMark, VictimSiteState, WorksiteState } from "../model/types";

export const PX_PER_CM = 5;
const cm = (n: number) => n * PX_PER_CM;

export type Op =
  | { kind: "text"; key: string; seq: number; x: number; y: number; text: string; size: number; align: "center" | "left" }
  | { kind: "line"; key: string; seq: number; pts: [number, number][]; width: number }
  | { kind: "rect"; key: string; seq: number; x: number; y: number; w: number; h: number; width: number };

export type Measure = (text: string, size: number) => number;

export interface Surface {
  id: string;
  width: number; // canvas px
  height: number;
}

export const SURFACES = {
  worksite: { id: "worksite", width: cm(400), height: cm(215) },
  V1: { id: "V1", width: cm(110), height: cm(170) },
  V2: { id: "V2", width: cm(110), height: cm(170) },
  car: { id: "car", width: cm(150), height: cm(50) },
} satisfies Record<string, Surface>;

function arrow(key: string, seq: number, x1: number, y1: number, x2: number, y2: number, width: number): Op[] {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const h = width * 4.5;
  return [
    { kind: "line", key: `${key}:shaft`, seq, pts: [[x1, y1], [x2, y2]], width },
    {
      kind: "line",
      key: `${key}:head`,
      seq,
      pts: [
        [x2 + h * Math.cos(a + 2.6), y2 + h * Math.sin(a + 2.6)],
        [x2, y2],
        [x2 + h * Math.cos(a - 2.6), y2 + h * Math.sin(a - 2.6)],
      ],
      width,
    },
  ];
}

/**
 * Worksite triage marking, drawn in the order of handbook p.2:
 * ID -> team/ASR/date -> box -> hazard (top) -> triage (bottom) -> arrow.
 * Later records are appended; the completion line goes below the ID and above the ASR records (S5).
 */
export function worksiteOps(w: WorksiteState, edition: Edition, measure: Measure): Op[] {
  const S = SURFACES.worksite;
  const cx = S.width / 2 + cm(20);
  const idSize = cm(40);
  const recSize = cm(10);
  const recGap = cm(14);
  const pad = cm(14);
  const id = worksiteId(w.team, w.siteNumber, edition);
  const records = w.records.map(
    (r) => `${teamLabel(r.team, edition)}   ASR ${r.level}   ${markingDate(r.date)}`,
  );

  const hazardTop = cm(8);
  const boxTop = hazardTop + cm(16) * Math.max(1, w.hazards.length) + cm(4);
  const idBaseline = boxTop + pad + idSize * 0.85;
  const lineY = idBaseline + cm(11);
  const firstRec = lineY + cm(8) + recSize;
  const boxH = firstRec - boxTop + (Math.max(records.length, 1) - 1) * recGap + pad;
  const textW = Math.max(measure(id, idSize), ...records.map((r) => measure(r, recSize)));
  const boxW = Math.max(textW + pad * 2, cm(120));
  const boxX = cx - boxW / 2;

  const ops: Op[] = [{ kind: "text", key: "id", seq: w.seq, x: cx, y: idBaseline, text: id, size: idSize, align: "center" }];
  w.records.forEach((r, i) => {
    ops.push({ kind: "text", key: `rec${i}`, seq: r.seq, x: cx, y: firstRec + i * recGap, text: records[i]!, size: recSize, align: "center" });
  });
  // The box is drawn after the first record; it grows when later records are appended.
  ops.splice(2, 0, { kind: "rect", key: "box", seq: w.seq, x: boxX, y: boxTop, w: boxW, h: boxH, width: cm(1.6) });
  w.hazards.forEach((h, i) => {
    ops.push({ kind: "text", key: `hz${i}`, seq: h.seq, x: cx, y: boxTop - cm(5) - (w.hazards.length - 1 - i) * cm(16), text: h.text, size: cm(11), align: "center" });
  });
  if (!w.deceasedOnly) {
    ops.push({ kind: "text", key: "triage", seq: w.seq, x: cx, y: boxTop + boxH + cm(24), text: w.triage, size: cm(20), align: "center" });
  }
  if (w.arrow) ops.push(...arrow("arrow", w.seq, boxX - cm(10), boxTop + boxH * 0.55, boxX - cm(60), boxTop + boxH * 0.55 + cm(30), cm(2)));
  if (w.closed) {
    ops.push({ kind: "line", key: "closed", seq: w.closed.seq, pts: [[boxX - cm(14), lineY], [boxX + boxW + cm(14), lineY]], width: cm(2.4) });
  }
  return ops;
}

/** Victim marking (handbook p.5): V, optional arrow, L/D lines; old counts are struck, never erased. */
export function victimOps(v: VictimSiteState, surface: Surface, measure: Measure): Op[] {
  const cx = surface.width / 2 + cm(8);
  const vSize = cm(50);
  const lineSize = cm(13);
  const ops: Op[] = [{ kind: "text", key: "V", seq: v.seq, x: cx, y: cm(8) + vSize * 0.85, text: "V", size: vSize, align: "center" }];
  if (v.arrow) ops.push(...arrow("arrow", v.seq, cx - cm(26), cm(30), cx - cm(48), cm(48), cm(2)));
  v.lines.forEach((l, i) => {
    const y = cm(8) + vSize + cm(10) + i * cm(17);
    const text = `${l.kind}-${l.count}`;
    ops.push({ kind: "text", key: `l${i}`, seq: l.seq, x: cx, y, text, size: lineSize, align: "center" });
    if (l.struck && l.struckSeq !== null) {
      const half = measure(text, lineSize) / 2 + cm(3);
      ops.push({ kind: "line", key: `s${i}`, seq: l.struckSeq, pts: [[cx - half, y - lineSize * 0.75], [cx + half, y + cm(1)]], width: cm(1.2) });
    }
  });
  return ops;
}

/** RCM (handbook p.6): diamond with C or D, team and date below; a later C is added beside D. */
export function rcmOps(marks: RcmMark[], edition: Edition): Op[] {
  const ops: Op[] = [];
  const d = cm(10); // half diagonal -> about 20 x 20 cm
  marks.forEach((m, i) => {
    const cx = cm(38) + i * cm(70);
    const cy = cm(14);
    ops.push({ kind: "line", key: `d${i}`, seq: m.seq, pts: [[cx, cy - d], [cx + d, cy], [cx, cy + d], [cx - d, cy], [cx, cy - d]], width: cm(1) });
    ops.push({ kind: "text", key: `t${i}`, seq: m.seq, x: cx, y: cy + cm(4), text: m.symbol, size: cm(11), align: "center" });
    ops.push({ kind: "text", key: `m${i}`, seq: m.seq, x: cx, y: cy + d + cm(9), text: `${teamLabel(m.team, edition)} ${markingDate(m.date)}`, size: cm(5.5), align: "center" });
  });
  return ops;
}
