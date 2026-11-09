// Turns an evaluated OpenSCAD model into a STEP file and proves it matches the mesh.
// The orchestration lives apart from any worker so that it can run under plain Node tests.
import { BrepBuilder, reportOn, writeStep, type BrepReport, type Occt } from './brep';
import { faceting, meshedSubtrees, parseCsg } from './csg';
import { measure, parseStl, type MeshMetrics } from './mesh';

export type StepInput = {
  csg: string;
  /** Binary or ASCII STL for every subtree `planStep` asked for, keyed by source offset. */
  meshes: { start: number; stl: Uint8Array }[];
  /** STL of the whole model: the geometry the user sees, and the ground truth for validation. */
  reference: Uint8Array;
  name: string;
};

export type StepKind = 'exact' | 'mixed' | 'faceted';
export type StepResult = { bytes: Uint8Array; kind: StepKind; report: BrepReport; reference: MeshMetrics; notes: string[] };

/** A sewn mesh costs about one OCCT face per triangle, which stops being practical past this size. */
const MAX_FACETED_TRIANGLES = 60_000;

export function planStep(csg: string) {
  return meshedSubtrees(parseCsg(csg)).map(node => ({ start: node.start, name: node.name, source: csg.slice(node.start, node.end) }));
}

/** Explains why a solid does not match the mesh, or returns null when it does. */
export function mismatch(report: BrepReport, mesh: MeshMetrics, facetLoss = 0): string | null {
  if (!report.valid) return 'the solid failed the OpenCascade validity check';
  if (!report.solids) return 'no closed solid came out of the rebuild';
  const volumeTolerance = 0.01 + Math.min(facetLoss, 0.15) * 1.5;
  const drift = Math.abs(report.volume - mesh.volume) / Math.max(mesh.volume, 1e-9);
  if (drift > volumeTolerance) return `the volume differs from the mesh by ${(drift * 100).toFixed(1)}%`;
  const diagonal = Math.hypot(...mesh.size);
  const boxTolerance = diagonal * (0.01 + Math.min(facetLoss, 0.15) * 0.5);
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(report.min[axis] - mesh.min[axis]) > boxTolerance || Math.abs(report.max[axis] - mesh.max[axis]) > boxTolerance) {
      return `the bounding box differs from the mesh on the ${'XYZ'[axis]} axis`;
    }
  }
  return null;
}

export function convertToStep(oc: Occt, input: StepInput): StepResult {
  const reference = parseStl(input.reference);
  const metrics = measure(reference);
  if (!reference.triangles) throw new Error('The model has no 3D geometry to export. A 2D drawing has no solid form.');
  const notes: string[] = [];

  const root = parseCsg(input.csg);
  const meshes = new Map(input.meshes.map(item => [item.start, parseStl(item.stl)]));
  const exact = new BrepBuilder(oc, meshes);
  try {
    const built = exact.build(root);
    if (!built) throw new Error('the model tree is empty');
    const shape = exact.finish(built);
    const report = reportOn(oc, shape);
    const problem = mismatch(report, metrics, faceting(root));
    if (!problem) {
      if (meshes.size) notes.push(`${meshes.size} feature${meshes.size === 1 ? '' : 's'} with no analytic form stayed faceted.`);
      return { bytes: writeStep(oc, shape, input.name), kind: meshes.size ? 'mixed' : 'exact', report, reference: metrics, notes };
    }
    notes.push(`Exact rebuild rejected: ${problem}.`);
  } catch (error) {
    notes.push(`Exact rebuild failed: ${errorText(error)}.`);
  } finally {
    exact.dispose();
  }

  // The mesh is what OpenSCAD proved, so a faceted solid is always faithful to it.
  if (metrics.triangles > MAX_FACETED_TRIANGLES) {
    throw new Error(`${notes.join(' ')} The mesh has ${metrics.triangles} triangles, too many to sew into a solid. Lower $fn and try again.`);
  }
  const faceted = new BrepBuilder(oc);
  try {
    const shape = faceted.meshBody(reference);
    const report = reportOn(oc, shape);
    const problem = mismatch(report, metrics);
    if (problem) throw new Error(`${notes.join(' ')} The faceted solid was rejected too: ${problem}.`);
    notes.push('The STEP file holds a faceted solid: exact dimensions at mesh resolution, without analytic surfaces.');
    return { bytes: writeStep(oc, shape, input.name), kind: 'faceted', report, reference: metrics, notes };
  } finally {
    faceted.dispose();
  }
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === 'number' ? 'OpenCascade raised an internal exception' : String(error);
}
