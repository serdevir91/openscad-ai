// Rebuilds an OpenSCAD model as a true boundary representation with OpenCascade.
// Cylinders stay cylinders and spheres stay spheres, so CAD tools get real surfaces
// and exact dimensions instead of the triangles an STL carries.
import { fragments, is2D, matrixOf, roundedOutline, type CsgNode, type Matrix } from './csg';
import { weld, type Mesh } from './mesh';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Occt = any;
type Shape = any;

export type BrepReport = {
  faces: number;
  surfaces: Record<string, number>;
  solids: number;
  volume: number;
  min: [number, number, number];
  max: [number, number, number];
  valid: boolean;
};

/** Stops OCCT temporaries from leaking the WASM heap across a long boolean chain. */
class Scope {
  private held: { delete(): void }[] = [];
  keep<T>(value: T): T { this.held.push(value as { delete(): void }); return value; }
  free() { for (const item of this.held.splice(0)) { try { item.delete(); } catch { /* Already released. */ } } }
}

export class BrepBuilder {
  private scope = new Scope();
  private progress: any;
  constructor(private oc: Occt, private meshes: Map<number, Mesh> = new Map()) {
    this.progress = new oc.Message_ProgressRange();
  }

  private pnt(x: number, y: number, z: number) { return this.scope.keep(new this.oc.gp_Pnt(x, y, z)); }
  private dir(x: number, y: number, z: number) { return this.scope.keep(new this.oc.gp_Dir(x, y, z)); }
  private vec(x: number, y: number, z: number) { return this.scope.keep(new this.oc.gp_Vec(x, y, z)); }

  private transformed(shape: Shape, m: Matrix) {
    const { oc } = this;
    const trsf = this.scope.keep(new oc.gp_Trsf());
    // The .csg text carries six significant digits, so rotations need re-orthogonalising.
    const q = orthonormal(m);
    trsf.SetValues(q[0][0], q[0][1], q[0][2], m[0][3], q[1][0], q[1][1], q[1][2], m[1][3], q[2][0], q[2][1], q[2][2], m[2][3]);
    const op = this.scope.keep(new oc.BRepBuilderAPI_Transform(shape, trsf, true, false));
    return op.Shape();
  }

  private boolean(kind: 'BRepAlgoAPI_Fuse' | 'BRepAlgoAPI_Cut' | 'BRepAlgoAPI_Common', a: Shape, b: Shape): Shape {
    const op = this.scope.keep(new this.oc[kind](a, b, this.progress));
    if (op.HasErrors()) throw new Error(`${kind} failed`);
    return op.Shape();
  }

  private compound(shapes: Shape[]) {
    const { oc } = this;
    const builder = this.scope.keep(new oc.TopoDS_Builder());
    const compound = new oc.TopoDS_Compound();
    builder.MakeCompound(compound);
    for (const shape of shapes) builder.Add(compound, shape);
    return compound;
  }

  private unionAll(shapes: Shape[]): Shape | null {
    let result: Shape | null = null;
    for (const shape of shapes) result = result ? this.boolean('BRepAlgoAPI_Fuse', result, shape) : shape;
    return result;
  }

  private polygonWire(points: number[][]) {
    const { oc } = this;
    const wire = this.scope.keep(new oc.BRepBuilderAPI_MakeWire());
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if (Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0)) < 1e-9) continue;
      const edge = this.scope.keep(new oc.BRepBuilderAPI_MakeEdge(this.pnt(a[0], a[1], a[2] ?? 0), this.pnt(b[0], b[1], b[2] ?? 0)));
      wire.Add(edge.Edge());
    }
    if (!wire.IsDone()) throw new Error('A polygon outline could not be closed.');
    return wire.Wire();
  }

  private polygonFace(points: number[][]) {
    const face = this.scope.keep(new this.oc.BRepBuilderAPI_MakeFace(this.polygonWire(points), true));
    if (!face.IsDone()) throw new Error('A polygon is not planar.');
    return face.Face();
  }

  private circleFace(r: number) {
    const { oc } = this;
    const axis = this.scope.keep(new oc.gp_Ax2(this.pnt(0, 0, 0), this.dir(0, 0, 1)));
    const circle = this.scope.keep(new oc.gp_Circ(axis, r));
    const edge = this.scope.keep(new oc.BRepBuilderAPI_MakeEdge(circle));
    const wire = this.scope.keep(new oc.BRepBuilderAPI_MakeWire(edge.Edge()));
    return this.scope.keep(new oc.BRepBuilderAPI_MakeFace(wire.Wire(), true)).Face();
  }

  /** The convex outline of equal circles: straight tangents joined by true arcs. */
  private roundedFace(centers: number[][], r: number) {
    const { oc } = this;
    const hull = convexHull(centers);
    const arc = (at: number[], from: number, to: number) => {
      const axis = this.scope.keep(new oc.gp_Ax2(this.pnt(at[0], at[1], 0), this.dir(0, 0, 1), this.dir(1, 0, 0)));
      const circle = this.scope.keep(new oc.gp_Circ(axis, r));
      return this.scope.keep(new oc.BRepBuilderAPI_MakeEdge(circle, from, to)).Edge();
    };
    if (hull.length === 1) {
      const whole = this.scope.keep(new oc.BRepBuilderAPI_MakeWire(arc(hull[0], 0, Math.PI * 2)));
      return this.scope.keep(new oc.BRepBuilderAPI_MakeFace(whole.Wire(), true)).Face();
    }
    const normals = hull.map((a, i) => {
      const b = hull[(i + 1) % hull.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return [(b[1] - a[1]) / length, (a[0] - b[0]) / length];
    });
    const wire = this.scope.keep(new oc.BRepBuilderAPI_MakeWire());
    hull.forEach((a, i) => {
      const next = (i + 1) % hull.length, b = hull[next], n = normals[i], m = normals[next];
      const start = this.pnt(a[0] + r * n[0], a[1] + r * n[1], 0), end = this.pnt(b[0] + r * n[0], b[1] + r * n[1], 0);
      wire.Add(this.scope.keep(new oc.BRepBuilderAPI_MakeEdge(start, end)).Edge());
      const from = Math.atan2(n[1], n[0]);
      let to = Math.atan2(m[1], m[0]);
      if (to <= from) to += Math.PI * 2;
      wire.Add(arc(b, from, to));
    });
    if (!wire.IsDone()) throw new Error('A rounded outline could not be closed.');
    return this.scope.keep(new oc.BRepBuilderAPI_MakeFace(wire.Wire(), true)).Face();
  }

  private profile(node: CsgNode): Shape | null {
    switch (node.name) {
      case 'hull': case 'offset': {
        const outline = roundedOutline(node);
        if (!outline) throw new Error(`${node.name} has no exact outline.`);
        return this.roundedFace(outline.centers, outline.r);
      }
      case 'square': {
        const size = node.args.size;
        const [x, y] = Array.isArray(size) ? size as number[] : [Number(size ?? 1), Number(size ?? 1)];
        const ox = node.args.center ? -x / 2 : 0, oy = node.args.center ? -y / 2 : 0;
        return this.polygonFace([[ox, oy], [ox + x, oy], [ox + x, oy + y], [ox, oy + y]]);
      }
      case 'circle': {
        const r = Number(node.args.r ?? 1);
        const sides = fragments(node);
        return sides ? this.polygonFace(regularPolygon(r, sides)) : this.circleFace(r);
      }
      case 'polygon': return this.polygon(node);
      case 'multmatrix': {
        const inner = this.collect2D(node, 'union');
        return inner && this.transformed(inner, matrixOf(node));
      }
      case 'difference': case 'intersection': return this.collect2D(node, node.name);
      default: return this.collect2D(node, 'union');
    }
  }

  private collect2D(node: CsgNode, op: 'union' | 'difference' | 'intersection'): Shape | null {
    const shapes = node.children.map(child => this.profile(child)).filter(Boolean);
    return this.combine(op, shapes);
  }

  private combine(op: 'union' | 'difference' | 'intersection', shapes: Shape[]): Shape | null {
    if (!shapes.length) return null;
    if (op === 'union') return this.unionAll(shapes);
    let result = shapes[0];
    for (const shape of shapes.slice(1)) {
      result = this.boolean(op === 'difference' ? 'BRepAlgoAPI_Cut' : 'BRepAlgoAPI_Common', result, shape);
    }
    return result;
  }

  private polygon(node: CsgNode): Shape {
    const points = node.args.points as number[][];
    const paths = node.args.paths as number[][] | null | undefined;
    if (!paths || !paths.length) return this.polygonFace(points);
    const faces = paths.map(path => this.polygonFace(path.map(i => points[i])));
    return this.combine('difference', faces);
  }

  private cone(r1: number, r2: number, h: number): Shape {
    const { oc } = this;
    const profile = r1 > 0 && r2 > 0 ? [[0, 0, 0], [r1, 0, 0], [r2, 0, h], [0, 0, h]]
      : r1 > 0 ? [[0, 0, 0], [r1, 0, 0], [0, 0, h]] : [[0, 0, 0], [r2, 0, h], [0, 0, h]];
    const axis = this.scope.keep(new oc.gp_Ax1(this.pnt(0, 0, 0), this.dir(0, 0, 1)));
    return this.scope.keep(new oc.BRepPrimAPI_MakeRevol(this.polygonFace(profile), axis, Math.PI * 2, false)).Shape();
  }

  private prism(face: Shape, height: number, offset: number): Shape {
    const shape = this.scope.keep(new this.oc.BRepPrimAPI_MakePrism(face, this.vec(0, 0, height), false, true)).Shape();
    return offset ? this.transformed(shape, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, offset]]) : shape;
  }

  private rotateExtrude(node: CsgNode): Shape | null {
    const { oc } = this;
    const profile = this.collect2D(node, 'union');
    if (!profile) return null;
    const angle = Number(node.args.angle ?? 360);
    const start = Number(node.args.start ?? 0);
    const upright = this.transformed(profile, [[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0]]);
    const axis = this.scope.keep(new oc.gp_Ax1(this.pnt(0, 0, 0), this.dir(0, 0, 1)));
    const whole = Math.abs(angle) >= 360;
    const swept = this.scope.keep(new oc.BRepPrimAPI_MakeRevol(upright, axis, (whole ? 360 : angle) * Math.PI / 180, false)).Shape();
    if (whole || !start) return swept;
    const c = Math.cos(start * Math.PI / 180), s = Math.sin(start * Math.PI / 180);
    return this.transformed(swept, [[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0]]);
  }

  /** Sews faces into solids, then merges coplanar facets back into single faces. */
  facetedSolid(points: ArrayLike<number>, faces: number[][]): Shape {
    const outer: Shape[] = [], inner: Shape[] = [];
    for (const shell of connectedShells(points, faces)) {
      const solid = this.sewnSolid(points, shell.faces);
      (shell.volume < 0 ? inner : outer).push(solid);
    }
    // A polyhedron written with inverted winding reads as all voids, yet it is still a solid.
    if (!outer.length) outer.push(...inner.splice(0));
    if (!outer.length) throw new Error('The mesh did not form a closed solid.');
    let result = outer.length === 1 ? outer[0] : this.compound(outer);
    for (const cavity of inner) result = this.boolean('BRepAlgoAPI_Cut', result, cavity);
    return this.unified(result);
  }

  private sewnSolid(points: ArrayLike<number>, faces: number[][]): Shape {
    const { oc } = this;
    const sewing = this.scope.keep(new oc.BRepBuilderAPI_Sewing(1e-4, true, true, true, false));
    const at = (i: number) => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
    for (const face of faces) sewing.Add(this.polygonFace(face.map(at)));
    sewing.Perform(this.progress);
    const explorer = this.scope.keep(new oc.TopExp_Explorer(sewing.SewedShape(), oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
    if (!explorer.More()) throw new Error('The mesh did not form a closed shell.');
    const solid = this.scope.keep(new oc.BRepBuilderAPI_MakeSolid(oc.TopoDS.Shell(explorer.Current()))).Solid();
    return shapeVolume(oc, solid) < 0 ? solid.Reversed() : solid;
  }

  private unified(shape: Shape): Shape {
    const unify = this.scope.keep(new this.oc.ShapeUpgrade_UnifySameDomain(shape, true, true, false));
    unify.Build();
    return unify.Shape();
  }

  meshBody(mesh: Mesh): Shape {
    const { points, faces } = weld(mesh);
    const list: number[][] = [];
    for (let f = 0; f < faces.length; f += 3) list.push([faces[f], faces[f + 1], faces[f + 2]]);
    return this.facetedSolid(points, list);
  }

  build(node: CsgNode): Shape | null {
    const { oc } = this;
    const mesh = this.meshes.get(node.start);
    if (mesh) return this.meshBody(mesh);
    switch (node.name) {
      case 'cube': {
        const size = node.args.size;
        const [x, y, z] = Array.isArray(size) ? size as number[] : [Number(size ?? 1), Number(size ?? 1), Number(size ?? 1)];
        const c = node.args.center;
        return this.scope.keep(new oc.BRepPrimAPI_MakeBox(this.pnt(c ? -x / 2 : 0, c ? -y / 2 : 0, c ? -z / 2 : 0), x, y, z)).Shape();
      }
      case 'sphere':
        return this.scope.keep(new oc.BRepPrimAPI_MakeSphere(Number(node.args.r ?? 1))).Shape();
      case 'cylinder': {
        const h = Number(node.args.h ?? 1);
        const r1 = Number(node.args.r1 ?? node.args.r ?? 1), r2 = Number(node.args.r2 ?? node.args.r ?? 1);
        const z = node.args.center ? -h / 2 : 0;
        const sides = fragments(node);
        if (sides) return this.prism(this.polygonFace(regularPolygon(r1, sides)), h, z);
        if (r1 === r2) {
          const axis = this.scope.keep(new oc.gp_Ax2(this.pnt(0, 0, z), this.dir(0, 0, 1)));
          return this.scope.keep(new oc.BRepPrimAPI_MakeCylinder(axis, r1, h)).Shape();
        }
        const cone = this.cone(r1, r2, h);
        return z ? this.transformed(cone, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, z]]) : cone;
      }
      case 'hull': {
        const outline = roundedOutline(node);
        if (!outline) throw new Error('hull has no exact outline.');
        return this.prism(this.roundedFace(outline.centers, outline.r), outline.h, outline.z);
      }
      case 'polyhedron': {
        const points = (node.args.points as number[][]).flat();
        return this.facetedSolid(points, (node.args.faces as number[][]).map(face => [...face].reverse()));
      }
      case 'linear_extrude': {
        const h = Number(node.args.height ?? 1);
        const profile = this.collect2D(node, 'union');
        return profile && this.prism(profile, h, node.args.center ? -h / 2 : 0);
      }
      case 'rotate_extrude': return this.rotateExtrude(node);
      case 'multmatrix': {
        const inner = this.children(node, 'union');
        return inner && this.transformed(inner, matrixOf(node));
      }
      case 'difference': case 'intersection': return this.children(node, node.name);
      default: return this.children(node, 'union');
    }
  }

  private children(node: CsgNode, op: 'union' | 'difference' | 'intersection') {
    if (node.children.some(is2D)) throw new Error('A 2D object cannot be exported as a solid.');
    // An empty first child empties a difference, so positions must survive the filter.
    const shapes = node.children.map(child => this.build(child));
    if (op !== 'union' && !shapes[0]) return null;
    if (op === 'intersection' && shapes.some(s => !s)) return null;
    return this.combine(op, shapes.filter(Boolean));
  }

  finish(shape: Shape) { return this.unified(shape); }
  dispose() { this.scope.free(); }
}

/** Splits a face list into connected shells. A negative signed volume marks an internal void. */
function connectedShells(points: ArrayLike<number>, faces: number[][]) {
  const parent = new Map<number, number>();
  const find = (i: number): number => {
    let root = parent.get(i) ?? i;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root)!;
    parent.set(i, root);
    return root;
  };
  for (const face of faces) for (const v of face) parent.set(find(v), find(face[0]));
  const shells = new Map<number, { faces: number[][]; volume: number }>();
  for (const face of faces) {
    const root = find(face[0]);
    let shell = shells.get(root);
    if (!shell) shells.set(root, shell = { faces: [], volume: 0 });
    shell.faces.push(face);
    const [ax, ay, az] = [points[face[0] * 3], points[face[0] * 3 + 1], points[face[0] * 3 + 2]];
    for (let i = 1; i + 1 < face.length; i++) {
      const b = face[i] * 3, c = face[i + 1] * 3;
      shell.volume += (ax * (points[b + 1] * points[c + 2] - points[b + 2] * points[c + 1])
        - ay * (points[b] * points[c + 2] - points[b + 2] * points[c])
        + az * (points[b] * points[c + 1] - points[b + 1] * points[c])) / 6;
    }
  }
  return [...shells.values()];
}

/** Andrew's monotone chain, counter-clockwise, duplicates and collinear points removed. */
function convexHull(points: number[][]) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .filter((p, i, all) => !i || Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) > 1e-9);
  if (sorted.length < 3) return sorted;
  const turn = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: number[][]) => {
    const chain: number[][] = [];
    for (const p of list) {
      while (chain.length > 1 && turn(chain[chain.length - 2], chain[chain.length - 1], p) <= 1e-12) chain.pop();
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

function regularPolygon(r: number, sides: number) {
  return Array.from({ length: sides }, (_, i) => {
    const a = i * 2 * Math.PI / sides;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

/** Removes the rounding noise from the linear part while keeping scale and handedness. */
function orthonormal(m: Matrix) {
  const c = [0, 1, 2].map(j => [m[0][j], m[1][j], m[2][j]]);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const scale = Math.cbrt(Math.abs(
    c[0][0] * (c[1][1] * c[2][2] - c[1][2] * c[2][1]) - c[0][1] * (c[1][0] * c[2][2] - c[1][2] * c[2][0]) + c[0][2] * (c[1][0] * c[2][1] - c[1][1] * c[2][0]),
  ));
  const unit = (v: number[]) => { const n = Math.sqrt(dot(v, v)); return v.map(x => x / n); };
  const e0 = unit(c[0]);
  const e1 = unit(c[1].map((x, i) => x - dot(c[1], e0) * e0[i]));
  const e2 = unit(c[2].map((x, i) => x - dot(c[2], e0) * e0[i] - dot(c[2], e1) * e1[i]));
  return [0, 1, 2].map(r => [e0[r] * scale, e1[r] * scale, e2[r] * scale]);
}

function shapeVolume(oc: Occt, shape: Shape) {
  const props = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
  const mass = props.Mass();
  props.delete();
  return mass;
}

function surfaceName(oc: Occt, type: unknown) {
  const kinds = oc.GeomAbs_SurfaceType as Record<string, unknown>;
  const key = Object.keys(kinds).find(name => kinds[name] === type) ?? String(type);
  return key.replace('GeomAbs_', '').replace('Surface', '').toLowerCase() || 'other';
}

export function reportOn(oc: Occt, shape: Shape): BrepReport {
  const surfaces: Record<string, number> = {};
  let faces = 0, solids = 0;
  const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; explorer.More(); explorer.Next()) {
    const adaptor = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(explorer.Current()), true);
    const name = surfaceName(oc, adaptor.GetType());
    surfaces[name] = (surfaces[name] ?? 0) + 1;
    faces++;
    adaptor.delete();
  }
  explorer.delete();
  const counter = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; counter.More(); counter.Next()) solids++;
  counter.delete();
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  const min = box.CornerMin(), max = box.CornerMax();
  const analyzer = new oc.BRepCheck_Analyzer(shape, true, false);
  const report: BrepReport = {
    faces, surfaces, solids,
    volume: Math.abs(shapeVolume(oc, shape)),
    min: [min.X(), min.Y(), min.Z()],
    max: [max.X(), max.Y(), max.Z()],
    valid: analyzer.IsValid(),
  };
  analyzer.delete();
  box.delete();
  return report;
}

export function writeStep(oc: Occt, shape: Shape, name: string): Uint8Array {
  oc.Interface_Static.SetCVal('write.step.schema', 'AP214IS');
  oc.Interface_Static.SetCVal('write.step.unit', 'MM');
  oc.Interface_Static.SetCVal('write.step.product.name', name);
  const writer = new oc.STEPControl_Writer();
  const progress = new oc.Message_ProgressRange();
  const status = writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progress);
  if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('OpenCascade could not translate the solid to STEP.');
  const path = '/model.step';
  if (writer.Write(path) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('OpenCascade could not write the STEP file.');
  const bytes = oc.FS.readFile(path) as Uint8Array;
  oc.FS.unlink(path);
  writer.delete();
  progress.delete();
  return bytes;
}
