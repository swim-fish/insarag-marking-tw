import { describe, expect, test } from "bun:test";
import { worksiteId, teamLabel } from "../src/model/format";
import { activeCount, check, replay } from "../src/model/reducer";
import { STAGES } from "../src/model/scenario";
import type { SimEvent, SimState } from "../src/model/types";
import { victimOps, worksiteOps } from "../src/marking/ops";

const measure = (t: string, size: number) => t.length * size * 0.6;

function runStages(n: number): { events: SimEvent[]; state: SimState } {
  const events: SimEvent[] = [];
  let state = replay("2027", events);
  for (const st of STAGES.slice(0, n)) {
    events.push(...st.build(state));
    state = replay("2027", events);
  }
  return { events, state };
}

describe("formats", () => {
  test("2027 worksite ID is team ID + 4 digits, team ID has no hyphen", () => {
    expect(worksiteId("t1", 5, "2027")).toBe("AAA01-0005");
    expect(teamLabel("t1", "2027")).toBe("AAA01");
  });
  test("2020 uses sector letter + number", () => {
    expect(worksiteId("t1", 5, "2020")).toBe("C-5");
    expect(teamLabel("t1", "2020")).toBe("AAA-01");
  });
});

describe("scenario", () => {
  test("all eight stages apply without rule issues", () => {
    const { state } = runStages(8);
    expect(state.issues).toEqual([]);
    expect(state.stage).toBe("complete");
    expect(state.worksite?.closed).not.toBeNull();
    expect(state.worksite?.records.map((r) => r.level)).toEqual([2, 3, 4]);
    expect(state.worksite?.triage).toBe("C"); // category from ASR 2 is not rewritten
  });

  test("victim counts: L-3 D-1 -> L-2 -> L-1 one at a time -> all struck, V kept", () => {
    const show = (n: number) => runStages(n).state.victims.V1!.lines.map((l) => `${l.kind}-${l.count}${l.struck ? "x" : ""}`);
    expect(show(4)).toEqual(["L-3", "D-1"]);
    expect(show(5)).toEqual(["L-3x", "D-1", "L-2x", "L-1"]);
    const extraction = runStages(5).events.filter((e) => e.type === "victim-removed");
    expect(extraction.map((e) => e.type === "victim-removed" && e.count)).toEqual([1, 1]);
    expect(show(6)).toEqual(show(5)); // ASR 3 record only
    const s7 = runStages(7).state.victims.V1!;
    expect(s7.lines.every((l) => l.struck)).toBe(true);
    expect(s7.lines).toHaveLength(4); // no "L-0" line is written
  });
});

describe("rules", () => {
  test("cannot close while known victims remain", () => {
    const { state } = runStages(6);
    expect(check(state, { type: "worksite-closed", date: "2026-10-06" })).toContain("受困者");
  });
  test("cannot close with only the ASR 2 record", () => {
    const { state } = runStages(2);
    expect(check(state, { type: "worksite-closed", date: "2026-10-06" })).not.toBeNull();
  });
  test("cannot remove more victims than remain", () => {
    const { state } = runStages(4);
    expect(check(state, { type: "victim-removed", site: "V1", kind: "D", count: 2 })).not.toBeNull();
  });
  test("found adds to the remaining count and strikes the old line", () => {
    const events = [...runStages(4).events, { type: "victim-found", site: "V1", kind: "L", count: 1 } as SimEvent];
    const v = replay("2027", events).victims.V1!;
    expect(activeCount(v, "L")).toBe(4);
    expect(v.lines[0]!.struck).toBe(true);
  });
  test("RCM needs LEMA, and C may follow D but not the other way", () => {
    let { events } = runStages(1);
    const mark = (symbol: "C" | "D"): SimEvent => ({ type: "rcm-marked", object: "car", symbol, team: "t3", date: "2026-10-06" });
    expect(check(replay("2027", events), mark("D"))).toContain("LEMA");
    events = [...events, { type: "rcm-enabled" }, mark("D")];
    expect(check(replay("2027", events), mark("C"))).toBeNull();
    events.push(mark("C"));
    expect(check(replay("2027", events), mark("D"))).not.toBeNull();
  });
  test("deceased-only marking exists only in 2027", () => {
    const evs: SimEvent[] = [{ type: "collapse" }, { type: "deceased-only-closed", team: "t1", date: "2026-10-06", siteNumber: 6 }];
    expect(replay("2027", evs).worksite?.records.map((r) => r.level)).toEqual([5]);
    expect(replay("2020", evs).worksite).toBeNull();
  });
});

describe("marking ops", () => {
  test("completion line sits below the ID and above the first ASR record", () => {
    const w = runStages(8).state.worksite!;
    const ops = worksiteOps(w, "2027", measure);
    const id = ops.find((o) => o.key === "id")!;
    const rec = ops.find((o) => o.key === "rec0")!;
    const line = ops.find((o) => o.key === "closed")!;
    if (id.kind !== "text" || rec.kind !== "text" || line.kind !== "line") throw new Error("kinds");
    const y = line.pts[0]![1];
    expect(y).toBeGreaterThan(id.y);
    expect(y).toBeLessThan(rec.y - rec.size);
    // spans the whole marking (wider than the box)
    const box = ops.find((o) => o.key === "box")!;
    if (box.kind !== "rect") throw new Error("box");
    expect(line.pts[0]![0]).toBeLessThan(box.x);
    expect(line.pts[1]![0]).toBeGreaterThan(box.x + box.w);
  });
  test("worksite ops follow the handbook order: ID, record, box, then hazard and triage", () => {
    const w = runStages(2).state.worksite!;
    expect(worksiteOps(w, "2027", measure).map((o) => o.key).slice(0, 5)).toEqual(["id", "rec0", "box", "hz0", "triage"]);
  });
  test("ASR 2 box reserves rows for ASR 3-5, and later records fill them without resizing", () => {
    const box = (n: number) => {
      const ops = worksiteOps(runStages(n).state.worksite!, "2027", measure);
      const b = ops.find((o) => o.key === "box")!;
      if (b.kind !== "rect") throw new Error("box");
      return { h: b.h, guides: ops.filter((o) => o.kind === "guide").length };
    };
    expect(box(2)).toEqual({ h: box(2).h, guides: 3 });
    expect(box(6).h).toBe(box(2).h); // ASR 3 record written in a reserved row
    expect(box(6).guides).toBe(2);
    expect(box(8).h).toBe(box(2).h);
    expect(box(8).guides).toBe(0); // no guides once the completion line is drawn
  });
  test("every struck victim line gets a strike op", () => {
    const v = runStages(7).state.victims.V1!;
    const ops = victimOps(v, { id: "V1", width: 550, height: 850 }, measure);
    expect(ops.filter((o) => o.key.startsWith("s"))).toHaveLength(4);
  });
});
