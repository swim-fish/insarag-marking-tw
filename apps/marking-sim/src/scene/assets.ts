import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Shared resources keep repeated props and four-person teams inexpensive to render.
const materials = new Map<string, THREE.MeshStandardMaterial>();
const geometries = new Map<string, THREE.BufferGeometry>();

export function material(color: string, roughness = 0.8, metalness = 0) {
  const key = `${color}/${roughness}/${metalness}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  return materials.get(key)!;
}

function geometry(key: string, create: () => THREE.BufferGeometry) {
  if (!geometries.has(key)) geometries.set(key, create());
  return geometries.get(key)!;
}

export function box(parent: THREE.Object3D, size: [number, number, number], pos: [number, number, number], mat: THREE.Material, radius = 0) {
  const geo = geometry(`box/${size}/${radius}`, () => radius
    ? new RoundedBoxGeometry(...size, 2, radius)
    : new THREE.BoxGeometry(...size));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...pos);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function cylinder(parent: THREE.Object3D, radius: number, height: number, pos: [number, number, number], mat: THREE.Material, top = radius) {
  const mesh = new THREE.Mesh(geometry(`cylinder/${radius}/${height}/${top}`, () => new THREE.CylinderGeometry(top, radius, height, 16)), mat);
  mesh.position.set(...pos);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function sphere(parent: THREE.Object3D, radius: number, pos: [number, number, number], mat: THREE.Material, scale: [number, number, number] = [1, 1, 1]) {
  const mesh = new THREE.Mesh(geometry(`sphere/${radius}`, () => new THREE.SphereGeometry(radius, 20, 12)), mat);
  mesh.position.set(...pos);
  mesh.scale.set(...scale);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function rod(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material) {
  const mesh = cylinder(parent, radius, a.distanceTo(b), [0, 0, 0], mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

/** Merge decorative meshes by material; animated parents and marking anchors stay separate. */
export function batch(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    // RoundedBoxGeometry is non-indexed, while cylinders and ordinary boxes are indexed.
    // Normalize before merging so a shared material never causes geometry to disappear.
    const geo = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geo.applyMatrix4(inverse.clone().multiply(object.matrixWorld));
    const list = buckets.get(object.material) ?? [];
    list.push(geo);
    buckets.set(object.material, list);
  });
  group.clear();
  for (const [mat, list] of buckets) {
    const merged = mergeGeometries(list, false);
    if (!merged) throw new Error("Unable to merge scene asset geometry");
    merged.userData.assetOwned = true;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    for (const geo of list) geo.dispose();
  }
}

/** Release generated geometry when a team or carry leaves; cached primitives remain reusable. */
export function releaseAsset(group: THREE.Object3D) {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh && object.geometry.userData.assetOwned) object.geometry.dispose();
  });
}

/** Deterministic, tileable surface grain, generated locally without asset downloads. */
export function surfaceMaterial(base: string, kind: "concrete" | "asphalt" | "paving") {
  const key = `${kind}/${base}`;
  if (materials.has(key)) return materials.get(key)!;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  let seed = 391;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 14000; i++) {
    ctx.fillStyle = random() > 0.5 ? `rgba(255,255,255,${random() * 0.16})` : `rgba(0,0,0,${random() * 0.17})`;
    ctx.fillRect(random() * 256, random() * 256, 1 + random() * 2, 1 + random() * 2);
  }
  if (kind === "paving") {
    ctx.strokeStyle = "#777c78";
    ctx.lineWidth = 2;
    for (let i = 0; i <= 256; i += 64) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(kind === "asphalt" ? 60 : kind === "paving" ? 5 : 2, kind === "asphalt" ? 3 : 2);
  map.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: kind === "asphalt" ? 0.035 : 0.018, roughness: 0.95 });
  materials.set(key, mat);
  return mat;
}

/** Geometry follows the supplied NFA special search and rescue uniform reference. */
export function rescueFigure(teamColor: string, carrying = false): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const suit = material("#dca64f", 0.94);
  const red = material("#bf4934", 0.9);
  const dark = material("#252e2c", 0.92);
  const straps = material("#4a5040", 0.9);
  const reflective = material("#dddcc0", 0.36, 0.28);
  const skin = material("#c89772");
  const helmet = material("#e7d47d", 0.48);
  const metal = material("#929e9b", 0.32, 0.75);

  box(body, [0.47, 0.58, 0.28], [0, 1.12, 0], suit, 0.08);
  box(body, [0.49, 0.15, 0.3], [0, 1.36, 0], red, 0.04);
  box(body, [0.4, 0.14, 0.27], [0, 0.82, 0], suit, 0.04);
  box(body, [0.46, 0.045, 0.3], [0, 0.88, 0], dark, 0.01);
  box(body, [0.065, 0.05, 0.015], [0, 0.88, 0.158], metal, 0.008);
  // Rescue harness, reflective strips and front utility pockets.
  for (const x of [-0.15, 0.15]) {
    box(body, [0.058, 0.48, 0.023], [x, 1.14, 0.156], dark, 0.006);
    box(body, [0.024, 0.3, 0.025], [x, 1.22, 0.173], reflective);
    box(body, [0.1, 0.13, 0.06], [x, 1.04, 0.19], straps, 0.012);
    box(body, [0.045, 0.15, 0.024], [x * 0.7, 0.73, 0.15], dark);
  }
  box(body, [0.018, 0.42, 0.014], [0, 1.15, 0.15], dark);
  box(body, [0.07, 0.12, 0.05], [-0.13, 1.32, 0.2], dark, 0.009);
  cylinder(body, 0.009, 0.13, [-0.14, 1.435, 0.19], dark);
  // Black technical backpack, red top and webbing.
  box(body, [0.37, 0.49, 0.2], [0, 1.12, -0.235], dark, 0.05);
  box(body, [0.32, 0.1, 0.21], [0, 1.32, -0.24], red, 0.025);
  for (const y of [1.02, 1.21]) box(body, [0.34, 0.024, 0.024], [0, y, -0.34], straps);
  box(body, [0.22, 0.035, 0.014], [0, 1.26, -0.35], reflective);
  cylinder(body, 0.065, 0.2, [0.255, 0.88, -0.05], straps);
  sphere(body, 0.14, [0, 1.56, 0.016], skin, [0.88, 1.13, 0.9]);
  cylinder(body, 0.065, 0.1, [0, 1.425, 0], skin);
  // Pale-yellow helmet, chin straps, goggles and a front headlamp.
  sphere(body, 0.176, [0, 1.685, 0], helmet, [1, 0.7, 1.05]);
  box(body, [0.35, 0.028, 0.36], [0, 1.645, 0.015], helmet, 0.012);
  box(body, [0.31, 0.026, 0.31], [0, 1.704, 0.01], dark, 0.01);
  box(body, [0.15, 0.065, 0.045], [0, 1.725, 0.168], dark, 0.015);
  cylinder(body, 0.022, 0.012, [0, 1.725, 0.197], material("#f5efc8", 0.25)).rotation.x = Math.PI / 2;
  box(body, [0.22, 0.068, 0.04], [0, 1.596, 0.132], dark, 0.015);
  box(body, [0.17, 0.039, 0.013], [0, 1.599, 0.157], material("#708783", 0.18, 0.25), 0.008);
  sphere(body, 0.075, [0, 1.49, 0.136], dark, [1, 0.8, 0.6]);
  for (const x of [-0.085, 0.085]) sphere(body, 0.041, [x, 1.49, 0.13], straps);
  for (const x of [-0.125, 0.125]) rod(body, new THREE.Vector3(x, 1.63, 0), new THREE.Vector3(x * 0.6, 1.46, 0.08), 0.012, dark);
  batch(body);
  group.add(body);

  // Separate limbs provide a natural walking gait without rebuilding meshes.
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.115, 0.8, 0);
    box(leg, [0.19, 0.34, 0.23], [0, -0.15, 0], suit, 0.045);
    box(leg, [0.17, 0.3, 0.21], [0, -0.46, 0], suit, 0.035);
    box(leg, [0.16, 0.14, 0.06], [0, -0.34, 0.13], straps, 0.025);
    box(leg, [0.19, 0.038, 0.23], [0, -0.47, 0], reflective);
    box(leg, [0.195, 0.035, 0.23], [0, -0.25, 0], dark);
    box(leg, [0.2, 0.2, 0.31], [0, -0.67, 0.045], dark, 0.03);
    box(leg, [0.205, 0.045, 0.32], [0, -0.765, 0.045], material("#171c1b"), 0.01);
    batch(leg);
    group.add(leg);
    const arm = new THREE.Group();
    arm.position.set(side * 0.29, 1.34, 0);
    box(arm, [0.16, 0.24, 0.18], [0, -0.09, 0], suit, 0.04);
    box(arm, [0.17, 0.1, 0.19], [0, -0.025, 0], red, 0.025);
    box(arm, [0.18, 0.06, 0.195], [0, -0.14, 0], material(teamColor), 0.015);
    sphere(arm, 0.039, [side * 0.085, -0.04, 0], material("#367b77"), [0.25, 1, 1]);
    const forearm = box(arm, [0.145, 0.23, 0.16], [0, -0.305, carrying ? 0.045 : 0.015], suit, 0.032);
    forearm.rotation.x = carrying ? -0.5 : -0.12;
    box(arm, [0.15, 0.04, 0.17], [0, -0.31, 0.02], reflective);
    sphere(arm, 0.084, [0, -0.44, carrying ? 0.1 : 0.035], straps, [0.8, 1, 0.8]);
    batch(arm);
    if (carrying) arm.rotation.x = -0.35;
    group.add(arm);
    group.userData[side < 0 ? "leftLeg" : "rightLeg"] = leg;
    group.userData[side < 0 ? "leftArm" : "rightArm"] = arm;
  }
  return group;
}

export function animateRescuer(group: THREE.Group, phase: number, walking: boolean, carrying = false) {
  const swing = walking ? Math.sin(phase) * (carrying ? 0.22 : 0.38) : 0;
  (group.userData.leftLeg as THREE.Group).rotation.x = swing;
  (group.userData.rightLeg as THREE.Group).rotation.x = -swing;
  if (!carrying) {
    (group.userData.leftArm as THREE.Group).rotation.x = -swing * 0.65;
    (group.userData.rightArm as THREE.Group).rotation.x = swing * 0.65;
  }
}

/** Sedan with a sloped cabin, recessed windows, panel seams, lights and alloy wheels. */
export function sedan(): THREE.Group {
  const group = new THREE.Group();
  const paint = material("#c3d0d4", 0.32, 0.5);
  const trim = material("#242d31", 0.65);
  const glass = material("#344f5c", 0.15, 0.38);
  const chrome = material("#a5b0b5", 0.25, 0.8);
  box(group, [4.2, 0.65, 1.78], [0, 0.69, 0], paint, 0.14);
  box(group, [4.05, 0.12, 1.8], [0, 0.44, 0], trim, 0.04);
  box(group, [1.05, 0.11, 1.66], [1.45, 1.025, 0], paint, 0.055);
  box(group, [0.64, 0.08, 1.66], [-1.71, 1.035, 0], paint, 0.035);
  // Extruded trapezoid rather than a rectangular cabin.
  const shape = new THREE.Shape();
  shape.moveTo(-1.43, 1.0); shape.lineTo(-0.94, 1.61);
  shape.lineTo(0.47, 1.61); shape.lineTo(1.12, 1.0); shape.closePath();
  const shell = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.53, bevelEnabled: false }), paint);
  shell.position.z = -0.765;
  group.add(shell);
  for (const side of [-1, 1]) {
    // Separate side windows leave visible A/B/C pillars.
    for (const [x, width] of [[-0.81, 0.7], [0.11, 0.86]]) {
      box(group, [width!, 0.42, 0.018], [x!, 1.3, side * 0.778], glass, 0.03);
    }
    box(group, [1.65, 0.055, 0.055], [-0.2, 1.61, side * 0.77], paint, 0.018);
    box(group, [0.05, 0.56, 0.04], [-0.33, 1.3, side * 0.785], trim);
    box(group, [2.22, 0.035, 0.04], [-0.21, 1.04, side * 0.86], chrome);
    for (const x of [-1.23, -0.32, 0.93]) box(group, [0.012, 0.5, 0.015], [x, 0.73, side * 0.897], trim);
    for (const x of [-0.6, 0.58]) box(group, [0.17, 0.035, 0.025], [x, 0.94, side * 0.908], chrome, 0.012);
    box(group, [0.2, 0.13, 0.16], [0.7, 1.16, side * 0.96], paint, 0.035);
    for (const x of [-1.35, 1.35]) {
      const tire = cylinder(group, 0.355, 0.24, [x, 0.365, side * 0.88], material("#202425", 0.94));
      tire.rotation.x = Math.PI / 2;
      const rim = cylinder(group, 0.235, 0.016, [x, 0.365, side * 1.007], chrome);
      rim.rotation.x = Math.PI / 2;
      const hub = cylinder(group, 0.07, 0.023, [x, 0.365, side * 1.019], trim);
      hub.rotation.x = Math.PI / 2;
      for (let i = 0; i < 5; i++) {
        const angle = i * Math.PI * 2 / 5;
        const spoke = box(group, [0.045, 0.17, 0.025], [x + Math.sin(angle) * 0.12, 0.365 + Math.cos(angle) * 0.12, side * 1.024], trim, 0.008);
        spoke.rotation.z = -angle;
      }
    }
  }
  const frontGlass = box(group, [0.76, 0.015, 1.39], [0.785, 1.315, 0], glass, 0.006);
  frontGlass.rotation.z = Math.atan2(-0.61, 0.65);
  const rearGlass = box(group, [0.69, 0.015, 1.39], [-1.185, 1.315, 0], glass, 0.006);
  rearGlass.rotation.z = Math.atan2(0.61, 0.49);
  box(group, [1.38, 0.035, 1.56], [-0.24, 1.635, 0], paint, 0.015);
  for (const side of [-1, 1]) {
    box(group, [0.035, 0.14, 0.38], [2.083, 0.85, side * 0.57], material("#f7f1d2", 0.2), 0.012);
    box(group, [0.035, 0.13, 0.36], [-2.083, 0.87, side * 0.56], material("#a9332d", 0.3), 0.012);
  }
  box(group, [0.04, 0.18, 0.7], [2.105, 0.69, 0], trim, 0.015);
  for (const y of [0.64, 0.69, 0.74]) box(group, [0.045, 0.012, 0.64], [2.129, y, 0], chrome);
  for (const x of [-2.105, 2.105]) box(group, [0.025, 0.1, 0.3], [x, 0.53, 0], material("#eff0e4"), 0.005);
  batch(group);
  return group;
}

/** Raised window frames and balcony rails attach to the moving wall, including during collapse. */
export function wallDetails(width: number, height: number, depth: number, sideWall = false, balconies = false): THREE.Group {
  const group = new THREE.Group();
  const span = sideWall ? depth : width;
  const thickness = sideWall ? width : depth;
  const trim = material("#8c9695", 0.5, 0.4);
  const plaster = material("#c8c4b8");
  const glass = material("#435e67", 0.22, 0.28);
  const count = Math.max(1, Math.floor(span / 2));
  for (const side of [-1, 1]) {
    const face = new THREE.Group();
    face.position.set(sideWall ? side * (thickness / 2 + 0.012) : 0, 0, sideWall ? 0 : side * (thickness / 2 + 0.012));
    face.rotation.y = sideWall ? side * Math.PI / 2 : side < 0 ? Math.PI : 0;
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * (span / count);
      box(face, [1.17, 1.52, 0.075], [x, 0.1, 0.025], trim, 0.015);
      box(face, [1.03, 1.37, 0.018], [x, 0.1, 0.071], glass);
      for (const dx of [-0.52, 0, 0.52]) box(face, [0.035, 1.39, 0.03], [x + dx, 0.1, 0.09], trim);
      box(face, [1.07, 0.04, 0.03], [x, 0.07, 0.09], trim);
      box(face, [1.3, 0.07, 0.23], [x, -0.69, 0.06], plaster);
      if (balconies && side > 0 && i % 2 === 0) {
        box(face, [1.6, 0.11, 0.7], [x, -1.0, 0.33], plaster);
        for (let k = -3; k <= 3; k++) box(face, [0.026, 0.68, 0.025], [x + k * 0.23, -0.61, 0.64], trim);
        box(face, [1.5, 0.035, 0.035], [x, -0.27, 0.64], trim);
        for (const dx of [-0.75, 0.75]) box(face, [0.035, 0.035, 0.61], [x + dx, -0.27, 0.34], trim);
      }
      if (i % 3 === 1 && side > 0) {
        box(face, [0.6, 0.4, 0.32], [x + 0.37, -1.15, 0.2], material("#c2c9c6"), 0.025);
        const fan = cylinder(face, 0.135, 0.015, [x + 0.37, -1.15, 0.365], trim);
        fan.rotation.x = Math.PI / 2;
      }
    }
    for (const y of [-height / 2 + 0.1, height / 2 - 0.08]) box(face, [span, 0.12, 0.07], [0, y, 0.02], plaster);
    group.add(face);
  }
  batch(group);
  return group;
}

export function roofDetails(width: number, depth: number): THREE.Group {
  const group = new THREE.Group();
  const concrete = material("#b6b6ab");
  const steel = material("#a8b6b5", 0.34, 0.65);
  for (const side of [-1, 1]) {
    box(group, [width, 0.55, 0.16], [0, 0.39, side * (depth / 2 - 0.08)], concrete);
    box(group, [0.16, 0.55, depth], [side * (width / 2 - 0.08), 0.39, 0], concrete);
  }
  cylinder(group, 0.7, 1.45, [-3.6, 1.14, -2.5], steel);
  for (const y of [0.48, 0.93, 1.39, 1.82]) cylinder(group, 0.725, 0.035, [-3.6, y, -2.5], steel);
  for (const x of [-4.05, -3.15]) box(group, [0.055, 0.35, 0.055], [x, 0.33, -2.5], steel);
  box(group, [1.6, 0.72, 0.85], [2.6, 0.51, -2], material("#a5afa9"), 0.03);
  for (let i = 0; i < 8; i++) box(group, [1.4, 0.025, 0.025], [2.6, 0.26 + i * 0.07, -1.561], material("#68766e"));
  cylinder(group, 0.028, 2.2, [4.3, 1.25, 2.2], steel);
  for (const y of [1.9, 2.25]) box(group, [1.1, 0.022, 0.022], [4.3, y, 2.2], steel);
  batch(group);
  return group;
}

export function rescueTruck(): THREE.Group {
  const group = new THREE.Group();
  const red = material("#a6382e", 0.38, 0.35);
  const metal = material("#aab5b6", 0.42, 0.65);
  const dark = material("#273237");
  box(group, [5.1, 1.55, 2.12], [-0.5, 1.31, 0], red, 0.06);
  box(group, [1.45, 1.7, 2.1], [2.43, 1.39, 0], red, 0.13);
  box(group, [0.045, 0.68, 1.86], [3.15, 1.74, 0], material("#3d5f6a", 0.18, 0.3), 0.015);
  for (const side of [-1, 1]) {
    box(group, [0.95, 0.6, 0.025], [2.34, 1.78, side * 1.06], material("#3d5f6a", 0.18, 0.3), 0.03);
    box(group, [5.7, 0.12, 0.026], [0.1, 0.87, side * 1.068], material("#ebe4b3", 0.45));
    for (const x of [-1.95, -0.5, 0.95]) {
      box(group, [1.22, 1.13, 0.028], [x, 1.43, side * 1.08], metal, 0.014);
      for (let i = 0; i < 11; i++) box(group, [1.17, 0.015, 0.015], [x, 0.95 + i * 0.093, side * 1.099], dark);
      box(group, [0.22, 0.035, 0.035], [x, 1.01, side * 1.11], metal);
    }
    for (const x of [-2, 2.3]) {
      cylinder(group, 0.45, 0.25, [x, 0.46, side * 1.03], material("#222727")).rotation.x = Math.PI / 2;
      cylinder(group, 0.27, 0.03, [x, 0.46, side * 1.175], metal).rotation.x = Math.PI / 2;
    }
    box(group, [0.08, 0.15, 0.34], [3.165, 1.06, side * 0.73], material("#f3ebcf", 0.2), 0.01);
    box(group, [0.3, 0.12, 0.3], [2.35, 2.28, side * 0.67], material("#337aaf", 0.25), 0.02);
  }
  box(group, [0.13, 0.2, 2.13], [3.2, 0.7, 0], metal, 0.025);
  box(group, [4.5, 0.08, 0.5], [-0.5, 2.14, 0], metal);
  for (const z of [-0.24, 0.24]) box(group, [4.5, 0.07, 0.045], [-0.5, 2.23, z], metal);
  for (let i = 0; i < 14; i++) box(group, [0.035, 0.035, 0.48], [-2.6 + i * 0.32, 2.23, 0], metal);
  batch(group);
  return group;
}

export function cone(): THREE.Group {
  const group = new THREE.Group();
  box(group, [0.42, 0.055, 0.42], [0, 0.03, 0], material("#303835"), 0.02);
  cylinder(group, 0.17, 0.46, [0, 0.29, 0], material("#cf632a"), 0.035);
  cylinder(group, 0.11, 0.09, [0, 0.29, 0], material("#ece5cb"), 0.084);
  batch(group);
  return group;
}
