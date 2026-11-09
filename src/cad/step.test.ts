import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import init from 'replicad-opencascadejs';
import { beforeAll, describe, expect, it } from 'vitest';
import { BrepBuilder, reportOn, type BrepReport, type Occt } from './brep';
import { meshedSubtrees, parseCsg, roundedOutline } from './csg';
import { convertToStep, mismatch, planStep } from './step';

let oc: Occt;
beforeAll(async () => { oc = await init(); }, 60_000);

function solid(csg: string): BrepReport {
  const builder = new BrepBuilder(oc);
  try {
    return reportOn(oc, builder.finish(builder.build(parseCsg(csg))));
  } finally {
    builder.dispose();
  }
}

describe('analytic rebuild', () => {
  it('keeps a drilled block exact', () => {
    const report = solid(`difference() {
      cube(size = [40, 30, 10], center = false);
      multmatrix([[1, 0, 0, 20], [0, 1, 0, 15], [0, 0, 1, -1], [0, 0, 0, 1]]) { cylinder($fn = 64, h = 12, r1 = 4, r2 = 4, center = false); }
    }`);
    expect(report.volume).toBeCloseTo(40 * 30 * 10 - Math.PI * 16 * 10, 3);
    expect(report.surfaces.cylinder).toBe(1);
    expect(report.valid).toBe(true);
  });

  it('builds cones, spheres and tori as true surfaces', () => {
    expect(solid('cylinder($fn = 0, $fa = 12, $fs = 2, h = 10, r1 = 5, r2 = 2, center = false);').surfaces.cone).toBe(1);
    expect(solid('sphere($fn = 64, r = 5);').volume).toBeCloseTo(4 / 3 * Math.PI * 125, 2);
    const torus = solid(`rotate_extrude(angle = 360, $fn = 64) {
      multmatrix([[1, 0, 0, 10], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]) { circle($fn = 64, r = 2); }
    }`);
    expect(torus.volume).toBeCloseTo(2 * Math.PI ** 2 * 10 * 4, 2);
  });

  it('turns the hull of four cylinders into a rounded plate', () => {
    const at = (x: number, y: number) => `multmatrix([[1, 0, 0, ${x}], [0, 1, 0, ${y}], [0, 0, 1, 0], [0, 0, 0, 1]]) { cylinder($fn = 48, h = 5, r1 = 3, r2 = 3, center = false); }`;
    const report = solid(`hull() { ${at(0, 0)} ${at(30, 0)} ${at(30, 20)} ${at(0, 20)} }`);
    expect(report.volume).toBeCloseTo((30 * 20 + 2 * 3 * (30 + 20) + Math.PI * 9) * 5, 2);
    expect(report.surfaces.cylinder).toBe(4);
    expect(report.min[0]).toBeCloseTo(-3, 3);
    expect(report.max[1]).toBeCloseTo(23, 3);
  });

  it('turns offset of a square into a rounded profile', () => {
    const report = solid(`linear_extrude(height = 2, center = false, scale = [1, 1]) {
      offset(r = 2, $fn = 32) { square(size = [10, 6], center = true); }
    }`);
    expect(report.volume).toBeCloseTo((60 + 2 * 2 * 16 + Math.PI * 4) * 2, 2);
  });

  it('does not treat a hull of unequal circles as rounded', () => {
    const csg = 'hull() { circle(r = 1); multmatrix([[1, 0, 0, 5], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]) { circle(r = 2); } }';
    expect(roundedOutline(parseCsg(csg).children[0])).toBeNull();
    expect(meshedSubtrees(parseCsg(csg))).toHaveLength(1);
  });

  it('mirrors and scales without losing solidity', () => {
    const mirrored = solid('multmatrix([[-1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]) { cylinder($fn = 32, h = 4, r1 = 2, r2 = 2, center = true); }');
    expect(mirrored.volume).toBeCloseTo(Math.PI * 16, 2);
    expect(mirrored.valid).toBe(true);
    const scaled = solid('multmatrix([[2, 0, 0, 0], [0, 2, 0, 0], [0, 0, 2, 0], [0, 0, 0, 1]]) { cube(size = [1, 2, 3], center = false); }');
    expect(scaled.volume).toBeCloseTo(48, 3);
  });

  it('keeps a low $fn cylinder as the polygon it was drawn as', () => {
    const report = solid('cylinder($fn = 6, h = 3, r1 = 5, r2 = 5, center = false);');
    expect(report.surfaces.cylinder).toBeUndefined();
    expect(report.volume).toBeCloseTo(3 * 3 * Math.sqrt(3) / 2 * 25, 3);
  });
});

describe('mismatch', () => {
  const mesh = { triangles: 1, vertices: 3, min: [0, 0, 0], max: [10, 10, 10], size: [10, 10, 10], center: [5, 5, 5], volume: 1000, area: 600, watertight: true, badEdges: 0, bodies: 1, voids: 0, throughHoles: 0 } as const;
  const solidReport: BrepReport = { faces: 6, surfaces: {}, solids: 1, volume: 1000, min: [0, 0, 0], max: [10, 10, 10], valid: true };
  const copy = { ...mesh, min: [...mesh.min], max: [...mesh.max], size: [...mesh.size], center: [...mesh.center] } as never;

  it('accepts a matching solid', () => { expect(mismatch(solidReport, copy)).toBeNull(); });
  it('rejects wrong volume', () => { expect(mismatch({ ...solidReport, volume: 900 }, copy)).toMatch(/volume/); });
  it('rejects a wrong box', () => { expect(mismatch({ ...solidReport, max: [10, 10, 14] }, copy)).toMatch(/Z axis/); });
  it('rejects invalid solids', () => { expect(mismatch({ ...solidReport, valid: false }, copy)).toMatch(/validity/); });
  it('gives faceted models room for inscribed polygons', () => {
    expect(mismatch({ ...solidReport, volume: 1040 }, copy, 0.03)).toBeNull();
  });
});

const openscad = ['/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD', '/opt/homebrew/bin/openscad', '/usr/bin/openscad'].find(existsSync);

describe.skipIf(!openscad)('real OpenSCAD round trip', () => {
  const run = (code: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'step-'));
    try {
      const compile = (source: string, format: string) => {
        const input = join(dir, 'in.scad'), output = join(dir, `out.${format}`);
        writeFileSync(input, source);
        execFileSync(openscad!, ['-o', output, input], { stdio: 'ignore' });
        return new Uint8Array(readFileSync(output));
      };
      const csg = new TextDecoder().decode(compile(code, 'csg'));
      const meshes = planStep(csg).map(item => ({ start: item.start, stl: compile(item.source, 'stl') }));
      return { result: convertToStep(oc, { csg, meshes, reference: compile(code, 'stl'), name: 'model' }), csg };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const reread = (bytes: Uint8Array) => {
    oc.FS.writeFile('/reread.step', bytes);
    const reader = new oc.STEPControl_Reader();
    expect(reader.ReadFile('/reread.step')).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);
    reader.TransferRoots(new oc.Message_ProgressRange());
    return reportOn(oc, reader.OneShape());
  };

  it('writes a bracket whose STEP reads back identical', () => {
    const { result } = run(`$fn = 64;
      module bracket(w = 60, d = 40, t = 6, hole = 5) {
        difference() {
          union() { cube([w, d, t]); translate([0, 0, 0]) cube([w, t, 30]); }
          for (x = [12, w - 12]) translate([x, d / 2 + 3, -1]) cylinder(d = hole, h = t + 2);
          translate([w / 2, -1, 18]) rotate([-90, 0, 0]) cylinder(d = 10, h = t + 2);
        }
      }
      bracket();`);
    expect(result.kind).toBe('exact');
    expect(result.report.surfaces.cylinder).toBe(3);
    const back = reread(result.bytes);
    expect(back.volume).toBeCloseTo(result.report.volume, 2);
    expect(back.surfaces.cylinder).toBe(3);
  });

  it('keeps surfaces around a faceted feature', () => {
    const { result } = run(`$fn = 48;
      difference() {
        cube([30, 30, 8]);
        translate([15, 15, -1]) cylinder(r = 4, h = 10);
        translate([5, 5, 6]) linear_extrude(3) text("A", size = 6);
      }`);
    expect(result.kind).toBe('mixed');
    expect(result.report.surfaces.cylinder).toBe(1);
  });

  it('survives non-uniform scale and twist', () => {
    const { result } = run(`$fn = 32;
      union() {
        scale([1, 2, 1]) cylinder(r = 5, h = 4);
        translate([20, 0, 0]) linear_extrude(height = 10, twist = 90) square(6, center = true);
      }`);
    expect(['mixed', 'faceted']).toContain(result.kind);
    expect(result.report.valid).toBe(true);
  });

  it('refuses a 2D drawing with a clear reason', () => {
    expect(() => run('square(10);')).toThrow();
  });
});
