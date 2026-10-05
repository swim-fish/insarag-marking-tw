// Paints ops onto a canvas with a stroke-by-stroke "spray paint" reveal.
// New ops are queued one after another, so a whole update reads like someone writing on the wall.

import type { Op, Surface } from "./ops";

export const PAINT = "#b94612"; // handbook marking colour (teaching colour, not a mandated one)
const FONT = `"Arial Black", "Microsoft JhengHei", "Noto Sans TC", sans-serif`;

interface Timing {
  start: number;
  dur: number;
}

function duration(op: Op): number {
  if (op.kind === "text") return Math.min(1400, 260 + op.text.length * 110);
  if (op.kind === "rect") return 1100;
  return op.pts.length > 2 ? 520 : 420;
}

function polyLength(pts: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return len;
}

function strokePartial(ctx: CanvasRenderingContext2D, pts: [number, number][], p: number) {
  const target = polyLength(pts) * p;
  let done = 0;
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (done + seg >= target) {
      const t = seg === 0 ? 0 : (target - done) / seg;
      ctx.lineTo(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      break;
    }
    ctx.lineTo(x1, y1);
    done += seg;
  }
  ctx.stroke();
}

export function font(size: number): string {
  return `900 ${size}px ${FONT}`;
}

export class Painter {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ops: Op[] = [];
  private timing = new Map<string, Timing>();
  private queueEnd = 0;
  private dirty = true;
  /** Ratio from surface px to canvas px (keeps textures within GPU-friendly sizes). */
  private scale: number;

  constructor(readonly surface: Surface, maxSide = 2048) {
    this.canvas = document.createElement("canvas");
    this.scale = Math.min(1, maxSide / Math.max(surface.width, surface.height));
    this.canvas.width = Math.round(surface.width * this.scale);
    this.canvas.height = Math.round(surface.height * this.scale);
    this.ctx = this.canvas.getContext("2d")!;
  }

  measure = (text: string, size: number): number => {
    this.ctx.font = font(size);
    return this.ctx.measureText(text).width;
  };

  /** Replace the op list. Unknown keys are queued for animation unless `instant`. */
  set(ops: Op[], now: number, instant: boolean) {
    const keys = new Set(ops.map((o) => o.key));
    for (const k of [...this.timing.keys()]) if (!keys.has(k)) this.timing.delete(k);
    const fresh = ops.filter((o) => !this.timing.has(o.key)).sort((a, b) => a.seq - b.seq);
    let t = Math.max(now, this.queueEnd);
    for (const o of fresh) {
      const dur = duration(o);
      if (instant) this.timing.set(o.key, { start: -Infinity, dur });
      else {
        this.timing.set(o.key, { start: t, dur });
        t += dur + 120;
      }
    }
    if (!instant && fresh.length) this.queueEnd = t;
    this.ops = ops;
    this.dirty = true;
  }

  /** Skip all pending animation. */
  finish() {
    for (const t of this.timing.values()) t.start = -Infinity;
    this.queueEnd = 0;
    this.dirty = true;
  }

  get busy(): boolean {
    return performance.now() < this.queueEnd;
  }

  /** Returns true when the canvas changed (the texture needs upload). */
  draw(now: number): boolean {
    if (!this.dirty && now > this.queueEnd + 50) return false;
    this.dirty = false;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.fillStyle = PAINT;
    ctx.strokeStyle = PAINT;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Soft edge, like overspray.
    ctx.shadowColor = "rgba(185,70,18,0.55)";
    ctx.shadowBlur = 6 * this.scale;

    for (const op of this.ops) {
      const t = this.timing.get(op.key);
      if (!t) continue;
      const p = Math.max(0, Math.min(1, (now - t.start) / t.dur));
      if (p <= 0) continue;
      if (op.kind === "text") {
        ctx.font = font(op.size);
        ctx.textAlign = op.align;
        ctx.textBaseline = "alphabetic";
        const w = ctx.measureText(op.text).width;
        const left = op.align === "center" ? op.x - w / 2 : op.x;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left - 20, op.y - op.size * 1.2, (w + 40) * p, op.size * 1.6);
        ctx.clip();
        ctx.fillText(op.text, op.x, op.y);
        ctx.restore();
      } else if (op.kind === "line") {
        ctx.lineWidth = op.width;
        strokePartial(ctx, op.pts, p);
      } else {
        ctx.lineWidth = op.width;
        const { x, y, w, h } = op;
        strokePartial(ctx, [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], p);
      }
    }
    return true;
  }
}
