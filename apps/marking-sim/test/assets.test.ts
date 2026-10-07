import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { animateRescuer, batch, box, cylinder, material, rescueFigure, rescueTruck, roofDetails, sedan, wallDetails } from "../src/scene/assets";

describe("scene assets", () => {
  test("batching preserves mixed indexed and rounded geometry with world transforms", () => {
    const group = new THREE.Group();
    group.position.set(11, 0, -4);
    const mat = material("#b3b3b3");
    const rounded = box(group, [1, 1, 1], [0, 0.5, 0], mat, 0.05);
    const wheel = cylinder(group, 0.3, 0.4, [2, 0.3, 0], mat);
    const expectedVertices = rounded.geometry.getAttribute("position").count + wheel.geometry.index!.count;
    const before = new THREE.Box3().setFromObject(group);
    batch(group);
    expect(group.children).toHaveLength(1);
    expect((group.children[0] as THREE.Mesh).geometry.getAttribute("position").count).toBe(expectedVertices);
    const after = new THREE.Box3().setFromObject(group);
    expect(after.min.distanceTo(before.min)).toBeLessThan(0.00001);
    expect(after.max.distanceTo(before.max)).toBeLessThan(0.00001);
  });

  test("all detailed assets retain finite geometry and cast shadows", () => {
    const assets = [rescueFigure("#f8fafc"), rescueFigure("#2563eb", true), sedan(), rescueTruck(), wallDetails(12, 3.2, 0.25, false, true), roofDetails(12, 9)];
    for (const asset of assets) {
      let meshes = 0;
      asset.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        meshes++;
        expect(object.castShadow).toBe(true);
        const positions = object.geometry.getAttribute("position");
        expect(positions.count).toBeGreaterThan(0);
        expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
      });
      expect(meshes).toBeGreaterThan(0);
    }
  });

  test("walking limbs return to rest and preserve the carrying arm pose", () => {
    const walker = rescueFigure("#f8fafc");
    animateRescuer(walker, Math.PI / 2, true);
    expect(walker.userData.leftLeg.rotation.x).toBeGreaterThan(0);
    expect(walker.userData.rightLeg.rotation.x).toBeLessThan(0);
    animateRescuer(walker, Math.PI / 2, false);
    expect(walker.userData.leftLeg.rotation.x).toBe(0);
    expect(walker.userData.leftArm.rotation.x).toBeCloseTo(0);
    const carrier = rescueFigure("#f8fafc", true);
    const armAngle = carrier.userData.leftArm.rotation.x;
    animateRescuer(carrier, Math.PI / 2, true, true);
    expect(carrier.userData.leftArm.rotation.x).toBe(armAngle);
  });
});
