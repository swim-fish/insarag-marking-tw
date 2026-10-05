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
  test("all seven stages apply without rule issues", () => {
    const { state } = runStages(7);
    expect(state.issues).toEqual([]);
    expect(state.stage).toBe("complete");
    expect(state.worksite?.closed).not.toBeNull();
    expect(state.worksite?.records.map((r) => r.level)).toEqual([2, 3, 4]);
    expect(state.worksite?.triage).toBe("C"); // category from ASR 2 is not rewritten
  });

  test("victim counts: L-2 D-1 -> L-1 -> all struck, V kept", () => {
    const s4 = runStages(4).state.victims.V1!;
    expect(s4.lines.map((l) => `${l.kind}-${l.count}${l.struck ? "x" : ""}`)).toEqual(["L-2", "D-1"]);
    const s5 = runStages(5).state.victims.V1!;
    expect(s5.lines.map((l) => `${l.kind}-${l.count}${l.struck ? "x" : ""}`)).toEqual(["L-2x", "D-1", "L-1"]);
    const s6 = runStages(6).state.victims.V1!;
    expect(s6.lines.every((l) => l.struck)).toBe(true);
    expect(s6.lines).toHaveLength(3); // no "L-0" line is written
  });
});

describe("rules", () => {
  test("cannot close while known victims remain", () => {
    const { state } = runStages(5);
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
    expect(activeCount(v, "L")).toBe(3);
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
    const w = runStages(7).state.worksite!;
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
  test("every struck victim line gets a strike op", () => {
    const v = runStages(6).state.victims.V1!;
    const ops = victimOps(v, { id: "V1", width: 550, height: 850 }, measure);
    expect(ops.filter((o) => o.key.startsWith("s"))).toHaveLength(3);
  });
});
