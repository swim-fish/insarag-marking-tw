import { rcmOps, SURFACES, victimOps, worksiteOps, type Surface } from "./marking/ops";
import { Painter } from "./marking/painter";
import { markingDate, teamLabel, TEAMS } from "./model/format";
import { activeCount, apply, check, initialState, replay } from "./model/reducer";
import { DAY1, DAY2, SITE_NUMBER, STAGES, stageIndex, type Focus } from "./model/scenario";
import type { Edition, SimEvent, SimState } from "./model/types";
import { World } from "./scene/world";
import { describe } from "./ui/describe";

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

/** The stretcher clears the breach this long before the count on the wall is updated. */
const CARRY_LEAD = 1600;
const TEAM_COLORS: Record<string, string> = { t1: "#f8fafc", t2: "#2563eb", t3: "#16a34a" };
const SURFACE_LABEL: Record<string, string> = { worksite: "工作場址", V1: "V1", V2: "V2", car: "RCM" };

// ---- app state: the event log is the single source of truth ----
let edition: Edition = "2027";
let events: SimEvent[] = [];
let cursor = 0; // number of events applied
let freshFrom = 0; // first event added by the latest dispatch (drives carry animations)
let state: SimState = initialState(edition);
let autoplay = false;
let autoplayWait = 0;
let currentTab: keyof typeof SURFACES = "worksite";

const world = new World($("#viewport"));
const painters = new Map<string, Painter>();
for (const surface of Object.values(SURFACES) as Surface[]) {
  const p = new Painter(surface);
  painters.set(surface.id, p);
  world.attachSurface(surface, p.canvas);
  world.addMarker(surface.id, SURFACE_LABEL[surface.id]!, () => {
    selectTab(surface.id as keyof typeof SURFACES);
    world.focus(surface.id as Focus);
  });
}

function toast(msg: string) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout((el as any)._t);
  (el as any)._t = setTimeout(() => el.classList.remove("show"), 3800);
}

/** Append events after the cursor (dropping any "future" events). Rejected batches change nothing. */
function dispatch(evs: SimEvent[]): boolean {
  const base = events.slice(0, cursor);
  let s = replay(edition, base);
  for (const e of evs) {
    const problem = check(s, e);
    if (problem) {
      toast(problem);
      return false;
    }
    s = apply(s, e, base.length);
    base.push(e);
  }
  const dropped = events.length - cursor;
  if (dropped > 0) toast(`已從時間軸中點接續操作，捨棄後續 ${dropped} 筆事件。`);
  freshFrom = cursor;
  events = base;
  cursor = events.length;
  render(false);
  return true;
}

function setCursor(n: number) {
  cursor = Math.max(0, Math.min(events.length, n));
  autoplay = false;
  render(true);
}

function render(instant: boolean) {
  state = replay(edition, events, cursor);
  const now = performance.now();
  // Paint after the collapse has settled so the writing is visible.
  const startAt = world.settled || instant ? now : now + 2600;

  world.setCollapsed(state.collapsed, instant);
  const fresh = instant ? [] : events.slice(freshFrom, cursor).map((e, i) => ({ e, seq: freshFrom + i }));
  const removals = fresh.filter((f) => f.e.type === "victim-removed");
  // Removals read as separate steps: carry out, then strike and rewrite the count.
  const pace = removals.length ? { lead: CARRY_LEAD, beat: 2400 } : { beat: 250 };
  const ws = painters.get("worksite")!;
  ws.set(state.worksite ? worksiteOps(state.worksite, edition, ws.measure) : [], startAt, instant, { beat: 250 });
  for (const id of ["V1", "V2"] as const) {
    const p = painters.get(id)!;
    const v = state.victims[id];
    p.set(v ? victimOps(v, SURFACES[id], p.measure) : [], startAt, instant, pace);
    world.setMarkerVisible(id, !!v);
  }
  if (instant) world.clearCarries();
  for (const { e, seq } of removals) {
    if (e.type !== "victim-removed") continue;
    const line = state.victims[e.site]?.lines.findIndex((l) => l.struckSeq === seq) ?? -1;
    const strike = painters.get(e.site)?.startOf(`s${line}`) ?? startAt + CARRY_LEAD;
    for (let k = 0; k < e.count; k++) world.carry(e.kind, strike - CARRY_LEAD + k * 1400);
  }
  const out = { L: 0, D: 0 };
  for (const e of events.slice(0, cursor)) if (e.type === "victim-removed") out[e.kind] += e.count;
  world.setExtracted(out.L, out.D);
  const car = painters.get("car")!;
  car.set(rcmOps(state.rcm.car ?? [], edition), startAt, instant);
  world.setMarkerVisible("car", (state.rcm.car ?? []).length > 0);
  world.setMarkerVisible("worksite", !!state.worksite);

  world.setTeams(state.teamsOnSite.map((k) => ({ key: k, color: TEAM_COLORS[k] ?? "#fff" })));
  world.setGhosts(
    Object.values(state.victims).map((v) => ({ id: v.site, live: activeCount(v, "L"), dead: activeCount(v, "D") })),
    ($("#ghosts") as HTMLInputElement).checked,
  );
  renderPanel();
}

// ---- panel ----
function renderPanel() {
  const idx = stageIndex(state.stage);
  $("#stepper").innerHTML = STAGES.map(
    (s, i) =>
      `<button data-stage="${i}" class="${i < idx ? "done" : i === idx ? "on" : ""}" ${i > idx + 1 ? "disabled" : ""}>` +
      `<span class="n">${i + 1}</span>${s.title}</button>`,
  ).join("");

  const st = STAGES[idx];
  const card = $("#stage-card");
  if (!st) {
    card.innerHTML = `<h2>準備</h2><p class="lead">完整建物，尚未發生災害。按「下一階段」開始。</p>
      <p class="muted">每一階段會依 INSARAG 規則更新現場標記；也可以用下方的操作自由加減受困者人數、追加 ASR 紀錄。</p>`;
  } else {
    const changed = edition === "2027" && st.changed2027?.length
      ? `<ul class="changed">${st.changed2027.map((c) => `<li><span class="tag">2027 異動</span>${c}</li>`).join("")}</ul>`
      : "";
    card.innerHTML = `<h2><span class="n">${idx + 1}</span>${st.title}</h2>
      <p class="lead">${st.lead}</p>
      <ul class="notes">${st.notes.map((n) => `<li>${n}</li>`).join("")}</ul>${changed}
      <p class="refs">來源：${st.refs}</p>`;
  }
  $<HTMLButtonElement>("#next").disabled = idx >= STAGES.length - 1;
  $<HTMLButtonElement>("#prev").disabled = cursor === 0;
  $("#play").textContent = autoplay ? "暫停" : "自動播放";

  // Victim counts.
  const rows = Object.values(state.victims)
    .map((v) => {
      const L = activeCount(v, "L");
      const D = activeCount(v, "D");
      return `<tr><th>${v.site}</th>
        <td><span class="pill live">L ${L}</span><button data-v="${v.site}" data-k="L" data-op="found">＋</button><button data-v="${v.site}" data-k="L" data-op="removed" ${L ? "" : "disabled"}>移出</button></td>
        <td><span class="pill dead">D ${D}</span><button data-v="${v.site}" data-k="D" data-op="found">＋</button><button data-v="${v.site}" data-k="D" data-op="removed" ${D ? "" : "disabled"}>移出</button></td></tr>`;
    })
    .join("");
  $("#counts").innerHTML = rows
    ? `<thead><tr><th></th><th>生還者</th><th>罹難者</th></tr></thead><tbody>${rows}</tbody>`
    : `<tbody><tr><td class="muted">尚未畫 V 標記。</td></tr></tbody>`;
  $<HTMLButtonElement>("#add-v2").disabled = !state.collapsed || !!state.victims.V2;

  const ws = state.worksite;
  for (const id of ["#asr-add", "#hazard-add"]) $<HTMLButtonElement>(id).disabled = !ws || !!ws.closed;
  $<HTMLButtonElement>("#close-site").disabled = !ws || !!ws.closed;
  $<HTMLButtonElement>("#deceased-only").disabled = edition !== "2027";
  $<HTMLButtonElement>("#rcm-enable").disabled = state.rcmEnabled || !state.collapsed;
  $<HTMLButtonElement>("#rcm-d").disabled = !state.rcmEnabled;
  $<HTMLButtonElement>("#rcm-c").disabled = !state.rcmEnabled;

  // Team / date selects follow the edition.
  const teamSel = $<HTMLSelectElement>("#asr-team");
  const keep = teamSel.value || "t3";
  teamSel.innerHTML = Object.keys(TEAMS).map((k) => `<option value="${k}">${teamLabel(k, edition)}</option>`).join("");
  teamSel.value = keep;
  const dateSel = $<HTMLSelectElement>("#asr-date");
  const keepDate = dateSel.value || DAY2;
  dateSel.innerHTML = [DAY1, DAY2].map((d) => `<option value="${d}">${markingDate(d)}</option>`).join("");
  dateSel.value = keepDate;

  // Log and timeline.
  const tl = $<HTMLInputElement>("#timeline");
  tl.max = String(events.length);
  tl.value = String(cursor);
  $("#log").innerHTML = events
    .map((e, i) => `<li data-i="${i + 1}" class="${i < cursor ? "" : "future"} ${e.type === "stage" ? "stage" : ""}">${esc(describe(e, edition))}</li>`)
    .join("");
  const log = $("#log");
  const cur = log.children[cursor - 1] as HTMLElement | undefined;
  if (cur) {
    cur.classList.add("cur");
    // Scroll only the log box, never the panel.
    log.scrollTop = cur.offsetTop - log.clientHeight / 2;
  }
  $("#issues").innerHTML = state.issues.map((i) => `<li>第 ${i.seq + 1} 筆事件未套用：${esc(i.message)}</li>`).join("");
}

function selectTab(id: keyof typeof SURFACES) {
  currentTab = id;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#tabs button")) b.classList.toggle("on", b.dataset.tab === id);
  const host = $("#closeup");
  host.replaceChildren(painters.get(id)!.canvas);
  host.dataset.surface = id;
}

function nextStage(): boolean {
  const idx = stageIndex(state.stage);
  const st = STAGES[idx + 1];
  if (!st) return false;
  const ok = dispatch(st.build(state));
  world.focus(st.focus);
  if (st.focus !== "overview") selectTab(st.focus === "car" ? "car" : (st.focus as keyof typeof SURFACES));
  return ok;
}

function prevStage() {
  // Rewind to just before the latest stage marker that is before the cursor.
  for (let i = cursor - 1; i >= 0; i--) {
    if (events[i]!.type === "stage") {
      setCursor(i);
      const st = STAGES[stageIndex(state.stage)];
      world.focus(st?.focus ?? "overview");
      return;
    }
  }
  setCursor(0);
}

// ---- wiring ----
$("#next").addEventListener("click", () => {
  for (const p of painters.values()) p.finish();
  nextStage();
});
$("#prev").addEventListener("click", prevStage);
$("#reset").addEventListener("click", () => {
  events = [];
  autoplay = false;
  setCursor(0);
  world.focus("overview");
});
$("#play").addEventListener("click", () => {
  autoplay = !autoplay;
  autoplayWait = 0.5;
  renderPanel();
});
$("#stepper").addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest("button");
  if (!b) return;
  const target = Number(b.dataset.stage);
  const idx = stageIndex(state.stage);
  if (target === idx + 1) nextStage();
  else if (target <= idx) {
    // Jump to the end of that stage.
    let seen = -1;
    let end = events.length;
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      if (e.type === "stage") {
        seen = stageIndex(e.stage);
        if (seen === target + 1) {
          end = i;
          break;
        }
      }
    }
    setCursor(end);
    world.focus(STAGES[target]!.focus);
  }
});
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-edition]")) {
  b.addEventListener("click", () => {
    edition = b.dataset.edition as Edition;
    for (const o of document.querySelectorAll<HTMLButtonElement>("[data-edition]")) o.classList.toggle("on", o === b);
    render(true);
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-focus]")) {
  b.addEventListener("click", () => {
    const f = b.dataset.focus as Focus;
    world.focus(f);
    if (f !== "overview") selectTab(f);
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>("#tabs button")) {
  b.addEventListener("click", () => selectTab(b.dataset.tab as keyof typeof SURFACES));
}
$("#ghosts").addEventListener("change", () => render(true));
$("#counts").addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest("button");
  if (!b) return;
  const site = b.dataset.v!;
  const kind = b.dataset.k as "L" | "D";
  dispatch([{ type: b.dataset.op === "found" ? "victim-found" : "victim-removed", site, kind, count: 1 }]);
  selectTab(site as keyof typeof SURFACES);
  world.focus(site as Focus);
});
$("#add-v2").addEventListener("click", () => {
  if (dispatch([{ type: "victim-site", site: "V2", arrow: false }])) {
    selectTab("V2");
    world.focus("V2");
  }
});
$("#asr-add").addEventListener("click", () => {
  const level = Number($<HTMLSelectElement>("#asr-level").value) as 3 | 4 | 5;
  dispatch([{ type: "asr-completed", team: $<HTMLSelectElement>("#asr-team").value, level, date: $<HTMLSelectElement>("#asr-date").value }]);
  selectTab("worksite");
  world.focus("worksite");
});
$("#hazard-add").addEventListener("click", () => {
  const input = $<HTMLInputElement>("#hazard");
  if (dispatch([{ type: "hazard-added", text: input.value }])) input.value = "";
  selectTab("worksite");
  world.focus("worksite");
});
$("#close-site").addEventListener("click", () => {
  dispatch([{ type: "worksite-closed", date: DAY2 }]);
  selectTab("worksite");
  world.focus("worksite");
});
$("#deceased-only").addEventListener("click", () => {
  events = [];
  cursor = 0;
  autoplay = false;
  dispatch([
    { type: "stage", stage: "incident" },
    { type: "collapse" },
    { type: "deceased-only-closed", team: "t1", date: DAY2, siteNumber: SITE_NUMBER + 1 },
  ]);
  selectTab("worksite");
  world.focus("worksite");
  toast("2027 版：確定建物僅有罹難者時，標記只記錄 ASR 5 與完成線。");
});
$("#rcm-enable").addEventListener("click", () => dispatch([{ type: "rcm-enabled" }]));
for (const sym of ["C", "D"] as const) {
  $(`#rcm-${sym.toLowerCase()}`).addEventListener("click", () => {
    dispatch([{ type: "rcm-marked", object: "car", symbol: sym, team: "t3", date: DAY2 }]);
    selectTab("car");
    world.focus("car");
  });
}
$("#timeline").addEventListener("input", (ev) => setCursor(Number((ev.target as HTMLInputElement).value)));
$("#log").addEventListener("click", (ev) => {
  const li = (ev.target as HTMLElement).closest("li");
  if (li) setCursor(Number(li.dataset.i));
});
addEventListener("keydown", (ev: KeyboardEvent) => {
  if ((ev.target as HTMLElement).matches("input, select, textarea")) return;
  if (ev.key === "ArrowRight") $("#next").click();
  if (ev.key === "ArrowLeft") prevStage();
});

// ---- loop ----
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  let busy = false;
  for (const [id, p] of painters) {
    if (p.draw(now)) world.textureChanged(id);
    busy ||= p.busy;
  }
  if (autoplay) {
    if (busy || !world.settled && state.collapsed) autoplayWait = 1.6;
    else if ((autoplayWait -= dt) <= 0) {
      autoplayWait = 1.6;
      if (!nextStage() || stageIndex(state.stage) >= STAGES.length - 1) {
        autoplay = false;
        renderPanel();
      }
    }
  }
  world.update(dt);
  requestAnimationFrame(frame);
}

selectTab(currentTab);
render(true);
requestAnimationFrame(frame);
