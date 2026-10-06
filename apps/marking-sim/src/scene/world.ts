import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { PX_PER_CM, type Surface } from "../marking/ops";
import type { Focus } from "../model/scenario";

// World units are metres. Building footprint 12 m (x) by 9 m (z), three storeys of 3.2 m.
// Side 1 (street side, with the address) faces +z.
const W = 12;
const D = 9;
const H = 3.2;
const FRONT_Z = D / 2;
// Interior cross wall of the standing ground storey. Victims are trapped in the crushed void behind it (+x).
const XW = -1;
const BREACH = { z0: -0.2, z1: 0.7, top: 1.3 };
const DOOR_X = -4.6;
// Casualty collection point, west of the entrance.
const CCP = new THREE.Vector3(-9.8, 0, FRONT_Z + 1.4);
const CARRY_SPEED = 2.2; // m/s
const EMERGE = 1.2; // s for the stretcher to come out of the breach

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Piece {
  mesh: THREE.Object3D;
  from: { p: THREE.Vector3; q: THREE.Quaternion };
  to: { p: THREE.Vector3; q: THREE.Quaternion };
  delay: number; // seconds after collapse start
  fall: number; // seconds
  appear?: boolean; // hidden while intact (debris)
}

const easeFall = (t: number) => {
  // Accelerate like a fall, then a small settle.
  if (t < 0.82) return (t / 0.82) ** 2;
  const k = (t - 0.82) / 0.18;
  return 1 + Math.sin(k * Math.PI) * 0.03;
};

function facadeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#c9c2b6";
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = "#4d5b63";
  for (let i = 0; i < 6; i++) g.fillRect(12 + i * 41, 18, 24, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface TeamVisual {
  key: string;
  color: string;
}

interface Carry {
  group: THREE.Group;
  back: THREE.Object3D;
  kind: "L" | "D";
  start: number; // performance.now() ms
  path: THREE.Vector3[];
}

function figure(color: string, helmet: string): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.9, 4, 8), new THREE.MeshStandardMaterial({ color }));
  body.position.y = 0.75;
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: helmet }));
  hat.position.y = 1.47;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshStandardMaterial({ color: "#e0b892" }));
  head.position.y = 1.4;
  g.add(body, head, hat);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

/** Stretcher with a lying casualty; live = green blanket, deceased = covered in grey. */
function stretcher(kind: "L" | "D"): THREE.Group {
  const g = new THREE.Group();
  const bed = new THREE.Mesh(new THREE.BoxGeometry(2, 0.08, 0.6), new THREE.MeshStandardMaterial({ color: "#e66a1f" }));
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.2, 1.2, 4, 8),
    new THREE.MeshStandardMaterial({ color: kind === "L" ? "#22c55e" : "#64748b" }),
  );
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.2;
  g.add(bed, body);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

interface Walker {
  group: THREE.Group;
  target: THREE.Vector3;
  leaving: boolean;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  readonly controls: OrbitControls;

  private pieces: Piece[] = [];
  private collapseT = -1; // seconds since collapse started; <0 means intact
  private collapsed = false;
  private dust: THREE.Points;
  private dustVel: Float32Array;
  private surfaces = new Map<string, { mesh: THREE.Mesh; tex: THREE.CanvasTexture }>();
  private anchors = new Map<string, THREE.Object3D>();
  private walkers = new Map<string, Walker[]>();
  private ghosts = new THREE.Group();
  private camGoal: { anchor: THREE.Object3D | null; offset: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private carries: Carry[] = [];
  private ccp = new THREE.Group();
  private ccpLabel!: CSS2DObject;
  private extracted = { L: 0, D: 0 };
  private shownCcp = "";
  private markers: CSS2DObject[] = [];
  private sideLabels: CSS2DObject[] = [];
  private ghostArgs: { sites: { id: string; live: number; dead: number }[]; visible: boolean } = { sites: [], visible: false };
  private wasSettled = false;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = "labels";
    host.appendChild(this.labels.domElement);

    this.scene.background = new THREE.Color("#cfd8dc");
    this.scene.fog = new THREE.Fog("#cfd8dc", 45, 120);
    this.camera.position.set(17, 13, 24);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 2, 0);
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 70;
    this.controls.enableDamping = true;
    this.controls.addEventListener("start", () => (this.camGoal = null));

    this.buildLights();
    this.buildGround();
    this.buildBuilding();
    this.buildCar();
    this.dustVel = new Float32Array(0);
    this.dust = this.buildDust();
    this.ghosts.renderOrder = 10;
    this.scene.add(this.ghosts);
    this.buildSideLabels();
    this.buildCcp();

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight("#eef3f6", "#6b6256", 1.4));
    const sun = new THREE.DirectionalLight("#fff4e0", 2.2);
    sun.position.set(18, 30, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -25;
    s.right = 25;
    s.top = 25;
    s.bottom = -25;
    this.scene.add(sun);
    // Work light inside the standing ground storey, where the V marking is painted.
    const work = new THREE.PointLight("#fff1d6", 22, 9, 2);
    work.position.set(-3.6, 2.1, 1.2);
    this.scene.add(work);
  }

  private buildGround() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: "#8f8a80" }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(200, 7), new THREE.MeshStandardMaterial({ color: "#4a4d50" }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.01, FRONT_Z + 6.5);
    road.receiveShadow = true;
    this.scene.add(road);
    for (let i = -10; i <= 10; i++) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.18), new THREE.MeshBasicMaterial({ color: "#e8e2c8" }));
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(i * 5, 0.02, FRONT_Z + 6.5);
      this.scene.add(dash);
    }
  }

  private addPiece(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    from: THREE.Vector3,
    to: THREE.Vector3 | null,
    toEuler: THREE.Euler | null,
    delay = 0,
    fall = 1.2,
    appear = false,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(from);
    this.scene.add(mesh);
    const q0 = new THREE.Quaternion();
    this.pieces.push({
      mesh,
      from: { p: from.clone(), q: q0 },
      to: { p: (to ?? from).clone(), q: toEuler ? new THREE.Quaternion().setFromEuler(toEuler) : q0.clone() },
      delay,
      fall,
      appear,
    });
    if (appear) mesh.visible = false;
    return mesh;
  }

  private buildBuilding() {
    const r = rng(7);
    const concrete = new THREE.MeshStandardMaterial({ color: "#b3ada3", flatShading: true });
    const slabMat = new THREE.MeshStandardMaterial({ color: "#9e988d", flatShading: true });
    const facade = new THREE.MeshStandardMaterial({ map: facadeTexture() });
    const wallLight = new THREE.MeshStandardMaterial({ color: "#d4cec4" });
    const t = 0.25;

    // Ground slab and the standing part of the ground storey (left side, with the entrance).
    const base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.3, D + 0.6), slabMat);
    base.position.y = 0.15;
    base.receiveShadow = true;
    this.scene.add(base);

    // Front ground-storey wall split around the door (door x = -4.6, width 1.3), standing part ends at x = 1.
    const frontLeft = [
      { x0: -W / 2, x1: -5.25 },
      { x0: -3.95, x1: 1 },
    ];
    for (const seg of frontLeft) {
      const w = seg.x1 - seg.x0;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, t), wallLight);
      m.position.set((seg.x0 + seg.x1) / 2, H / 2 + 0.3, FRONT_Z - t / 2);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, t), wallLight);
    lintel.position.set(-4.6, H + 0.3 - 0.4, FRONT_Z - t / 2);
    this.scene.add(lintel);
    const sideL = new THREE.Mesh(new THREE.BoxGeometry(t, H, D), wallLight);
    sideL.position.set(-W / 2 + t / 2, H / 2 + 0.3, 0);
    sideL.castShadow = sideL.receiveShadow = true;
    this.scene.add(sideL);
    const backL = new THREE.Mesh(new THREE.BoxGeometry(7, H, t), wallLight);
    backL.position.set(-W / 2 + 3.5, H / 2 + 0.3, -FRONT_Z + t / 2);
    this.scene.add(backL);
    // Interior cross wall with a breach; the rescue route runs through it to the entrance.
    const crossSegs = [
      { z0: -FRONT_Z + t, z1: BREACH.z0, y0: 0.3, y1: 2.3 },
      { z0: BREACH.z1, z1: FRONT_Z - t, y0: 0.3, y1: 2.3 },
      { z0: BREACH.z0, z1: BREACH.z1, y0: BREACH.top, y1: 2.3 },
    ];
    for (const c of crossSegs) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(t, c.y1 - c.y0, c.z1 - c.z0), wallLight);
      m.position.set(XW, (c.y0 + c.y1) / 2, (c.z0 + c.z1) / 2);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }
    // V1/V2: on the interior face of the cross wall (facing the entrance), nearest the trapped victims.
    for (const [id, z] of [["V1", 1.75], ["V2", -2.4]] as const) {
      const v = new THREE.Object3D();
      v.position.set(XW - t / 2 - 0.01, 1.3, z);
      v.rotation.y = -Math.PI / 2;
      this.scene.add(v);
      this.anchors.set(id, v);
    }
    const anchor = new THREE.Object3D();
    anchor.position.set(-1.6, 2.05, FRONT_Z + 0.01);
    this.scene.add(anchor);
    this.anchors.set("worksite", anchor);

    // Falling ground-storey walls (right part).
    const tilt = Math.atan2(H - 0.4, W - 1);
    this.addPiece(new THREE.BoxGeometry(5, H, t), wallLight, new THREE.Vector3(3.5, H / 2 + 0.3, FRONT_Z - t / 2), new THREE.Vector3(3.6, 0.5, FRONT_Z + 1.3), new THREE.Euler(1.35, 0.1, 0.05), 0.35);
    this.addPiece(new THREE.BoxGeometry(t, H, D), wallLight, new THREE.Vector3(W / 2 - t / 2, H / 2 + 0.3, 0), new THREE.Vector3(W / 2 + 1.4, 0.45, 0.3), new THREE.Euler(0, 0, -1.4), 0.4);

    // Upper floor slabs pancake: left edge rests on the standing wall, right edge on the ground.
    for (let i = 1; i <= 3; i++) {
      this.addPiece(
        new THREE.BoxGeometry(W, 0.3, D),
        slabMat,
        new THREE.Vector3(0, i * H + 0.3, 0),
        new THREE.Vector3(0.5, (H + 0.3 + 0.6) / 2 + (i - 1) * 0.38 + 0.1, -0.1 * i),
        new THREE.Euler(0.02 * (i - 2), 0, -tilt),
        0.15 * (3 - i),
        1.1 + i * 0.12,
      );
    }

    // Upper storey walls: facades fall outward, the rest falls into the pile.
    for (let s = 1; s <= 2; s++) {
      const y = s * H + 0.3 + H / 2;
      const walls: { size: [number, number, number]; pos: [number, number, number]; out: THREE.Vector3; rot: THREE.Euler; mat: THREE.Material }[] = [
        { size: [W, H, t], pos: [0, y, FRONT_Z - t / 2], out: new THREE.Vector3(2.5 + s, 0.4 + s * 0.3, FRONT_Z + 2.2 + s * 0.8), rot: new THREE.Euler(1.45, 0.25 * s, 0.1), mat: facade },
        { size: [W, H, t], pos: [0, y, -FRONT_Z + t / 2], out: new THREE.Vector3(1, 0.4 + s * 0.3, -FRONT_Z - 2 - s), rot: new THREE.Euler(-1.42, -0.15, 0.05), mat: facade },
        { size: [t, H, D], pos: [-W / 2 + t / 2, y, 0], out: new THREE.Vector3(-W / 2 - 1.8 - s * 0.6, 0.5 + s * 0.3, -0.5), rot: new THREE.Euler(0.05, 0.1, 1.38), mat: wallLight },
        { size: [t, H, D], pos: [W / 2 - t / 2, y, 0], out: new THREE.Vector3(W / 2 + 2.8 + s, 0.5 + s * 0.3, -0.8), rot: new THREE.Euler(0.1, -0.2, -1.45), mat: wallLight },
      ];
      for (const w of walls) {
        this.addPiece(new THREE.BoxGeometry(...w.size), w.mat, new THREE.Vector3(...w.pos), w.out, w.rot, 0.1 + r() * 0.3, 1.3 + s * 0.2);
      }
    }

    // Debris chunks appear and settle into piles around the collapse.
    for (let i = 0; i < 90; i++) {
      const s = 0.3 + r() * 0.9;
      const geo = new THREE.BoxGeometry(s * (0.6 + r()), s * 0.6, s * (0.6 + r()));
      const from = new THREE.Vector3(-2 + r() * 8, 3 + r() * 7, -4 + r() * 8);
      const side = r();
      const to =
        side < 0.45
          ? new THREE.Vector3(1 + r() * 7, 0.3 + r() * 0.8, FRONT_Z + 0.3 + r() * 2.2)
          : side < 0.75
            ? new THREE.Vector3(W / 2 + 0.3 + r() * 2.5, 0.3 + r() * 1.2, -3.5 + r() * 7)
            : new THREE.Vector3(-2 + r() * 9, 0.4 + r() * 0.8, -FRONT_Z - 0.5 - r() * 2.5);
      this.addPiece(geo, concrete, from, to, new THREE.Euler(r() * 3, r() * 3, r() * 3), 0.3 + r() * 0.8, 0.9 + r() * 0.6, true);
    }
  }

  private buildCar() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.9, 1.8), new THREE.MeshStandardMaterial({ color: "#d7dde0", metalness: 0.2, roughness: 0.5 }));
    body.position.y = 0.75;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.75, 1.62), new THREE.MeshStandardMaterial({ color: "#3e4b52" }));
    cabin.position.set(-0.2, 1.55, 0);
    g.add(body, cabin);
    for (const [x, z] of [[-1.35, 0.9], [1.35, 0.9], [-1.35, -0.9], [1.35, -0.9]] as const) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.25, 16), new THREE.MeshStandardMaterial({ color: "#222" }));
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.36, z);
      g.add(w);
    }
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    g.position.set(11.5, 0, FRONT_Z + 4.6);
    g.rotation.y = 0.04;
    this.scene.add(g);
    const anchor = new THREE.Object3D();
    anchor.position.set(0.3, 0.82, 0.905);
    g.add(anchor);
    this.anchors.set("car", anchor);
  }

  private buildDust(): THREE.Points {
    const n = 900;
    const pos = new Float32Array(n * 3);
    this.dustVel = new Float32Array(n * 3);
    const r = rng(11);
    for (let i = 0; i < n; i++) {
      this.dustVel[i * 3] = (r() - 0.5) * 9;
      this.dustVel[i * 3 + 1] = r() * 3;
      this.dustVel[i * 3 + 2] = (r() - 0.5) * 9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: "#d9d2c5", size: 2.2, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthWrite: false }),
    );
    pts.visible = false;
    this.scene.add(pts);
    return pts;
  }

  private buildSideLabels() {
    const sides: [string, THREE.Vector3][] = [
      ["第 1 面（正面）", new THREE.Vector3(-4, 0.2, FRONT_Z + 3)],
      ["第 2 面", new THREE.Vector3(-W / 2 - 3.5, 0.2, 0)],
      ["第 3 面", new THREE.Vector3(0, 0.2, -FRONT_Z - 5)],
      ["第 4 面", new THREE.Vector3(W / 2 + 6, 0.2, 0)],
    ];
    for (const [text, p] of sides) {
      const el = document.createElement("div");
      el.className = "side-label";
      el.textContent = text;
      const o = new CSS2DObject(el);
      o.position.copy(p);
      this.scene.add(o);
      this.sideLabels.push(o);
    }
  }

  /** Clickable floating label over a marking surface. */
  addMarker(id: string, text: string, onClick: () => void) {
    const anchor = this.anchors.get(id);
    if (!anchor) return;
    const el = document.createElement("button");
    el.className = "marker";
    el.textContent = text;
    el.addEventListener("click", onClick);
    const o = new CSS2DObject(el);
    o.position.set(0, id === "worksite" ? 1.4 : 0, id === "worksite" ? 0 : 0.9);
    o.userData.id = id;
    anchor.add(o);
    this.markers.push(o);
  }

  setMarkerVisible(id: string, on: boolean) {
    for (const m of this.markers) if (m.userData.id === id) m.userData.wanted = on;
  }

  /** Attach a painter canvas as a decal on its anchor. */
  attachSurface(surface: Surface, canvas: HTMLCanvasElement) {
    const anchor = this.anchors.get(surface.id);
    if (!anchor) return;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      roughness: 0.9,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(surface.width / PX_PER_CM / 100, surface.height / PX_PER_CM / 100), mat);
    mesh.receiveShadow = true;
    anchor.add(mesh);
    this.surfaces.set(surface.id, { mesh, tex });
  }

  textureChanged(id: string) {
    const s = this.surfaces.get(id);
    if (s) s.tex.needsUpdate = true;
  }

  setCollapsed(on: boolean, instant: boolean) {
    if (on === this.collapsed) return;
    this.collapsed = on;
    this.collapseT = on ? (instant ? 99 : 0) : -1;
    if (on && !instant) {
      const pos = this.dust.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, (i % 13) - 6 + Math.random(), 1 + Math.random() * 6, ((i * 7) % 9) - 4.5);
      pos.needsUpdate = true;
      this.dust.visible = true;
    }
    this.applyPieces();
  }

  private applyPieces() {
    for (const p of this.pieces) {
      if (this.collapseT < 0) {
        p.mesh.position.copy(p.from.p);
        p.mesh.quaternion.copy(p.from.q);
        p.mesh.visible = !p.appear;
        continue;
      }
      const k = easeFall(Math.max(0, Math.min(1, (this.collapseT - p.delay) / p.fall)));
      p.mesh.position.lerpVectors(p.from.p, p.to.p, k);
      p.mesh.quaternion.slerpQuaternions(p.from.q, p.to.q, Math.min(k, 1));
      p.mesh.visible = !p.appear || this.collapseT > p.delay;
    }
  }

  /** Marking surfaces and labels only exist after the collapse finished falling. */
  get settled(): boolean {
    return this.collapsed && this.collapseT > 2.4;
  }

  setTeams(teams: TeamVisual[]) {
    const present = new Set(teams.map((t) => t.key));
    for (const [key, list] of this.walkers) {
      if (!present.has(key)) for (const w of list) {
        w.leaving = true;
        w.target.set(-16 + Math.random(), 0, FRONT_Z + 8 + Math.random() * 2);
      }
    }
    teams.forEach((t, ti) => {
      if (this.walkers.get(t.key)?.some((w) => !w.leaving)) return;
      this.removeWalkers(t.key);
      const list: Walker[] = [];
      for (let i = 0; i < 4; i++) {
        const g = figure("#c2410c", t.color);
        g.position.set(-18 - i * 0.8, 0, FRONT_Z + 8 + (i % 2));
        this.scene.add(g);
        list.push({ group: g, target: new THREE.Vector3(-5.4 + i * 0.9 + ti * 0.3, 0, FRONT_Z + 1.6 + (i % 2) * 0.9 + ti * 1.1), leaving: false });
      }
      this.walkers.set(t.key, list);
    });
  }

  private removeWalkers(key: string) {
    for (const w of this.walkers.get(key) ?? []) this.scene.remove(w.group);
    this.walkers.delete(key);
  }

  /** Instructor view: figures for victims still in place (green = live, grey = deceased). */
  setGhosts(sites: { id: string; live: number; dead: number }[], visible: boolean) {
    this.ghostArgs = { sites, visible };
    this.ghosts.clear();
    this.ghosts.visible = visible && this.settled;
    if (!this.settled) return;
    for (const s of sites) {
      const anchor = this.anchors.get(s.id);
      if (!anchor) continue;
      const base = new THREE.Vector3();
      anchor.getWorldPosition(base);
      const all = [...Array(s.live).fill("L"), ...Array(s.dead).fill("D")];
      all.forEach((k, i) => {
        const m = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.2, 1.1, 4, 8),
          new THREE.MeshBasicMaterial({ color: k === "L" ? "#22c55e" : "#64748b", transparent: true, opacity: 0.75, depthTest: false }),
        );
        m.rotation.x = Math.PI / 2;
        // Lying in the void behind the cross wall.
        m.position.set(base.x + 0.9 + (i % 2) * 0.8, 0.55, base.z - 0.4 + Math.floor(i / 2) * 0.75);
        m.renderOrder = 10;
        this.ghosts.add(m);
      });
    }
  }

  private buildCcp() {
    const tarp = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3), new THREE.MeshStandardMaterial({ color: "#2f6fb0" }));
    tarp.rotation.x = -Math.PI / 2;
    tarp.position.set(CCP.x, 0.02, CCP.z);
    tarp.receiveShadow = true;
    this.scene.add(tarp, this.ccp);
    const el = document.createElement("div");
    el.className = "ccp-label";
    this.ccpLabel = new CSS2DObject(el);
    this.ccpLabel.position.set(CCP.x, 1.6, CCP.z);
    this.scene.add(this.ccpLabel);
    this.renderCcp();
  }

  /** Total casualties removed so far; carries still under way are not yet at the collection point. */
  setExtracted(live: number, dead: number) {
    this.extracted = { L: live, D: dead };
    this.renderCcp();
  }

  /** Drop pending carries (timeline jumps). */
  clearCarries() {
    for (const c of this.carries) this.scene.remove(c.group);
    this.carries = [];
    this.renderCcp();
  }

  /** Two rescuers bring one casualty out through the breach and the entrance to the collection point. */
  carry(kind: "L" | "D", start: number) {
    const group = new THREE.Group();
    const bed = stretcher(kind);
    bed.position.y = 0.75;
    const front = figure("#1d4ed8", "#facc15");
    front.position.x = 1.25;
    const back = figure("#1d4ed8", "#facc15");
    back.position.x = -1.25;
    group.add(bed, front, back);
    group.visible = false;
    this.scene.add(group);
    const path = [
      new THREE.Vector3(XW + 1.3, 0.3, (BREACH.z0 + BREACH.z1) / 2),
      new THREE.Vector3(XW - 1.6, 0.3, (BREACH.z0 + BREACH.z1) / 2),
      new THREE.Vector3(DOOR_X, 0.3, 2.6),
      new THREE.Vector3(DOOR_X, 0, FRONT_Z + 1.6),
      new THREE.Vector3(CCP.x + 1.5, 0, CCP.z - 0.6),
    ];
    this.carries.push({ group, back, kind, start, path });
    this.renderCcp();
  }

  private renderCcp() {
    const pending = { L: 0, D: 0 };
    for (const c of this.carries) pending[c.kind]++;
    const L = Math.max(0, this.extracted.L - pending.L);
    const D = Math.max(0, this.extracted.D - pending.D);
    const key = `${L}/${D}`;
    if (key === this.shownCcp) return;
    this.shownCcp = key;
    this.ccp.clear();
    const place = (kind: "L" | "D", i: number, row: number) => {
      const b = stretcher(kind);
      // Live casualties in the left column, deceased in the right one.
      b.position.set(CCP.x - 1.1 + row * 2.2, 0.08, CCP.z - 1.1 + i * 0.75);
      this.ccp.add(b);
    };
    for (let i = 0; i < L; i++) place("L", i, 0);
    for (let i = 0; i < D; i++) place("D", i, 1);
    this.ccpLabel.element.textContent = `傷患集中點　已移出 L ${L}／D ${D}`;
  }

  private updateCarries(now: number) {
    let arrived = false;
    for (const c of [...this.carries]) {
      const t = (now - c.start) / 1000;
      if (t < 0) continue;
      c.group.visible = true;
      const a = c.path[0]!;
      const b = c.path[1]!;
      let pos: THREE.Vector3;
      let dir: THREE.Vector3;
      if (t < EMERGE) {
        // The stretcher slides out of the breach; the rear rescuer stays hidden behind the wall.
        pos = a.clone().lerp(b, t / EMERGE);
        dir = b.clone().sub(a);
        c.back.visible = false;
      } else {
        c.back.visible = true;
        let dist = (t - EMERGE) * CARRY_SPEED;
        let i = 1;
        pos = new THREE.Vector3();
        dir = new THREE.Vector3(1, 0, 0);
        for (; i < c.path.length - 1; i++) {
          const seg = c.path[i + 1]!.clone().sub(c.path[i]!);
          const len = seg.length();
          if (dist <= len) {
            pos = c.path[i]!.clone().addScaledVector(seg, dist / len);
            dir = seg;
            break;
          }
          dist -= len;
        }
        if (i === c.path.length - 1) {
          this.scene.remove(c.group);
          this.carries.splice(this.carries.indexOf(c), 1);
          arrived = true;
          continue;
        }
      }
      c.group.position.copy(pos);
      c.group.rotation.y = Math.atan2(-dir.z, dir.x);
      c.group.position.y += Math.abs(Math.sin(now / 140)) * 0.04;
    }
    if (arrived) this.renderCcp();
  }

  focus(f: Focus) {
    if (f === "overview") {
      this.camGoal = { anchor: null, offset: new THREE.Vector3(14, 13, 25), target: new THREE.Vector3(-2.5, 2, 1) };
      return;
    }
    // V sites are viewed from a corner of the standing storey, so the stretcher route to the entrance stays in view.
    const offsets: Record<string, THREE.Vector3> = {
      worksite: new THREE.Vector3(1.2, 0.8, 7.5),
      car: new THREE.Vector3(-0.6, 1.2, 4.2),
      V1: new THREE.Vector3(-4.16, 0.45, -5.25),
      V2: new THREE.Vector3(-4.16, 0.45, 1.9),
    };
    const offset = offsets[f]!.clone();
    // Track the anchor every frame: it may still be moving while the building collapses.
    this.camGoal = { anchor: this.anchors.get(f) ?? null, offset, target: new THREE.Vector3() };
  }

  update(dt: number) {
    if (this.collapseT >= 0 && this.collapseT < 4) {
      this.collapseT += dt;
      this.applyPieces();
      const pos = this.dust.geometry.getAttribute("position") as THREE.BufferAttribute;
      const mat = this.dust.material as THREE.PointsMaterial;
      if (this.dust.visible) {
        for (let i = 0; i < pos.count; i++) {
          pos.setXYZ(
            i,
            pos.getX(i) + this.dustVel[i * 3]! * dt * 0.6,
            Math.max(0.2, pos.getY(i) + (this.dustVel[i * 3 + 1]! - 1.2) * dt * 0.5),
            pos.getZ(i) + this.dustVel[i * 3 + 2]! * dt * 0.6,
          );
        }
        pos.needsUpdate = true;
        mat.opacity = Math.max(0, 0.75 * Math.sin(Math.min(1, this.collapseT / 4) * Math.PI));
        if (this.collapseT >= 4) this.dust.visible = false;
      }
    }
    for (const s of this.surfaces.values()) s.mesh.visible = this.settled;
    if (this.settled !== this.wasSettled) {
      this.wasSettled = this.settled;
      this.setGhosts(this.ghostArgs.sites, this.ghostArgs.visible);
    }
    const far = this.camera.position.distanceTo(this.controls.target) > 14;
    // CSS2DRenderer drives element display from Object3D.visible.
    for (const l of this.sideLabels) l.visible = far;
    // Labels show through walls, so inside the standing storey only the V labels are shown.
    const p = this.camera.position;
    const inside = p.x > -W / 2 && p.x < XW && Math.abs(p.z) < FRONT_Z && p.y < H;
    for (const m of this.markers) {
      const interior = m.userData.id === "V1" || m.userData.id === "V2";
      m.visible = this.settled && !!m.userData.wanted && (interior || !inside);
    }

    this.updateCarries(performance.now());
    for (const [key, list] of this.walkers) {
      let gone = 0;
      for (const w of list) {
        const d = w.target.clone().sub(w.group.position);
        d.y = 0;
        const dist = d.length();
        if (dist > 0.05) {
          const step = Math.min(dist, dt * 3.2);
          w.group.position.addScaledVector(d.normalize(), step);
          w.group.rotation.y = Math.atan2(d.x, d.z);
          w.group.position.y = Math.abs(Math.sin(performance.now() / 120)) * 0.06;
        } else if (w.leaving) gone++;
      }
      if (gone === list.length) this.removeWalkers(key);
    }

    if (this.camGoal) {
      const g = this.camGoal;
      if (g.anchor) g.anchor.getWorldPosition(g.target);
      const pos = g.anchor ? g.target.clone().add(g.offset) : g.offset;
      const k = 1 - Math.exp(-dt * 3);
      this.camera.position.lerp(pos, k);
      this.controls.target.lerp(g.target, k);
      if (this.camera.position.distanceTo(pos) < 0.05 && (!g.anchor || this.settled)) this.camGoal = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
