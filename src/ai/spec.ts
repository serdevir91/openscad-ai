import { parameters } from '../hooks/useParametric';
import { diagnostics } from '../cad/diagnostics';
import type { MeshMetrics } from '../cad/mesh';

type Source = 'user' | 'assumed';
export type Spec = {
  summary: string;
  envelope: { x: number; y: number; z: number; source: Source } | null;
  parameters: { name: string; value: number; unit?: string; source: Source; why?: string }[];
  features: string[];
  through_holes: number | null;
  bodies: number | null;
  assumptions: string[];
  edit_existing: boolean;
};

export type Check = { id: string; level: 'pass' | 'warn' | 'fail'; label: string; detail?: string };

function numeric(value: unknown) {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function texts(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function source(value: unknown): Source {
  return value === 'user' ? 'user' : 'assumed';
}

/** Finds the JSON object in a reply, ignoring fences and prose around it. */
export function jsonIn(text: string): unknown {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

export function parseSpec(text: string): Spec | null {
  const raw = jsonIn(text) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') return null;
  const box = raw.envelope as Record<string, unknown> | null | undefined;
  const size = box && [numeric(box.x), numeric(box.y), numeric(box.z)];
  const list = Array.isArray(raw.parameters) ? raw.parameters as Record<string, unknown>[] : [];
  return {
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    envelope: size && size.every(value => value !== null && value > 0)
      ? { x: size[0]!, y: size[1]!, z: size[2]!, source: source(box!.source) }
      : null,
    parameters: list.flatMap(item => {
      const value = numeric(item?.value);
      return typeof item?.name === 'string' && value !== null
        ? [{ name: item.name, value, unit: String(item.unit ?? ''), source: source(item.source), why: String(item.why ?? '') }]
        : [];
    }),
    features: texts(raw.features),
    through_holes: numeric(raw.through_holes),
    bodies: numeric(raw.bodies),
    assumptions: texts(raw.assumptions),
    edit_existing: raw.edit_existing === true,
  };
}

const mm = (value: number) => `${Number(value.toFixed(2))} mm`;
export const sizeText = (size: number[]) => size.map(value => Number(value.toFixed(2))).join(' × ') + ' mm';

/** Compares a compiled model with what was asked for. Every check comes from measurement. */
export function verify(metrics: MeshMetrics, code: string, log: string, spec?: Spec | null): Check[] {
  const checks: Check[] = [];
  const add = (id: string, level: Check['level'], label: string, detail?: string) => checks.push({ id, level, label, detail });

  if (!metrics.triangles) {
    add('geometry', 'fail', 'The model is empty', 'OpenSCAD produced no geometry. A cut may have removed everything.');
    return checks;
  }
  add('geometry', 'pass', `${metrics.triangles.toLocaleString('en-US')} triangles compiled`);

  const warnings = diagnostics(log).filter(item => item.severity === 'warning');
  if (warnings.length) {
    const serious = warnings.some(item => /unknown|undefined|ignoring|not be a valid|not a valid|wrong number/i.test(item.message));
    add('warnings', serious ? 'fail' : 'warn', `OpenSCAD reported ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`,
      warnings.slice(0, 5).map(item => (item.line ? `Line ${item.line}: ` : '') + item.message).join('\n'));
  } else add('warnings', 'pass', 'No OpenSCAD warnings');

  if (metrics.watertight) add('watertight', 'pass', 'Closed, watertight solid');
  else add('watertight', 'fail', 'The mesh is not watertight', `${metrics.badEdges} edges are open or shared by more than two faces. Bodies probably touch without overlapping.`);

  if (spec?.envelope) {
    const wanted = [spec.envelope.x, spec.envelope.y, spec.envelope.z].sort((a, b) => a - b);
    const actual = [...metrics.size].sort((a, b) => a - b);
    const off = wanted.findIndex((value, axis) => Math.abs(value - actual[axis]) > Math.max(0.5, value * 0.01));
    const label = `Overall size ${sizeText(metrics.size)}`;
    if (off < 0) add('envelope', 'pass', `${label} matches the plan`);
    else add('envelope', spec.envelope.source === 'user' ? 'fail' : 'warn', `${label} does not match`,
      `The plan asks for ${sizeText([spec.envelope.x, spec.envelope.y, spec.envelope.z])}, in any orientation. One side is ${mm(actual[off])} where ${mm(wanted[off])} is expected.`);
  } else add('envelope', 'pass', `Overall size ${sizeText(metrics.size)}`);

  if (spec?.bodies != null) {
    if (metrics.bodies === spec.bodies) add('bodies', 'pass', `${metrics.bodies} separate bod${metrics.bodies === 1 ? 'y' : 'ies'}, as planned`);
    else add('bodies', 'fail', `${metrics.bodies} separate bodies, planned ${spec.bodies}`, metrics.bodies > spec.bodies ? 'Some parts float free or only touch.' : 'Parts that should be separate have merged.');
  }

  if (spec?.through_holes != null) {
    if (metrics.throughHoles === spec.through_holes) add('holes', 'pass', `${metrics.throughHoles} through hole${metrics.throughHoles === 1 ? '' : 's'}, as planned`);
    else add('holes', metrics.throughHoles < spec.through_holes ? 'fail' : 'warn', `${metrics.throughHoles} through holes, planned ${spec.through_holes}`,
      metrics.throughHoles < spec.through_holes ? 'At least one hole stops short of the far face or is missing.' : undefined);
  }

  if (metrics.voids) add('voids', 'warn', `${metrics.voids} sealed internal cavit${metrics.voids === 1 ? 'y' : 'ies'}`, 'A closed void inside the part cannot be printed or machined as drawn.');

  if (spec) {
    const found = new Map(parameters(code).map(item => [item.name, item.value]));
    for (const item of spec.parameters.filter(parameter => parameter.source === 'user')) {
      const value = found.get(item.name);
      if (value === undefined) add(`parameter-${item.name}`, 'warn', `Parameter ${item.name} is not a top-level value`, `The plan fixes it at ${item.value}.`);
      else if (Math.abs(value - item.value) > 1e-6) add(`parameter-${item.name}`, 'fail', `${item.name} is ${value}, stated ${item.value}`);
    }
  }

  if (metrics.min[2] < -0.01) add('bed', 'warn', 'The part goes below the build plate', `Its lowest point is at Z = ${mm(metrics.min[2])}.`);
  return checks;
}

export function failures(checks: Check[]) {
  return checks.filter(check => check.level === 'fail').map(check => check.detail ? `${check.label}. ${check.detail}` : check.label);
}

/** Lower is better. Failures always outweigh warnings. */
export function penalty(checks: Check[]) {
  return checks.reduce((sum, check) => sum + (check.level === 'fail' ? 100 : check.level === 'warn' ? 1 : 0), 0);
}
