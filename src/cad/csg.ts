// Parser and analysis for OpenSCAD's `.csg` output: the fully evaluated model tree,
// with every variable, loop, and module already expanded into plain primitives.

export type CsgValue = number | string | boolean | null | CsgValue[];
export type CsgNode = {
  name: string;
  args: Record<string, CsgValue>;
  positional: CsgValue[];
  children: CsgNode[];
  /** Offsets of this node in the source, for compiling a subtree on its own. */
  start: number;
  end: number;
  /** Set when the node carries the `%` background modifier and adds no geometry. */
  background?: boolean;
};

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENT = /[$A-Za-z_][\w$]*/y;

export function parseCsg(source: string): CsgNode {
  let i = 0;
  const fail = (message: string): never => { throw new Error(`CSG parse error at ${i}: ${message}`); };
  const space = () => { while (i < source.length && /\s/.test(source[i])) i++; };
  const match = (re: RegExp) => {
    re.lastIndex = i;
    const m = re.exec(source);
    if (m) i = re.lastIndex;
    return m?.[0];
  };
  const value = (): CsgValue => {
    space();
    const c = source[i];
    if (c === '[') {
      i++;
      const list: CsgValue[] = [];
      for (;;) {
        space();
        if (source[i] === ']') { i++; return list; }
        list.push(value());
        space();
        if (source[i] === ',') i++;
        else if (source[i] !== ']') fail('expected , or ]');
      }
    }
    if (c === '"') {
      let out = '';
      for (i++; i < source.length && source[i] !== '"'; i++) {
        if (source[i] === '\\') i++;
        out += source[i];
      }
      i++;
      return out;
    }
    const number = match(NUMBER);
    if (number !== undefined) return Number(number);
    const word = match(IDENT);
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'undef') return null;
    if (word === 'inf') return Infinity;
    if (word === 'nan') return NaN;
    return fail(`unexpected value ${word ?? c}`);
  };
  const node = (): CsgNode | null => {
    space();
    const start = i;
    let background = false;
    while ('%#!*'.includes(source[i])) {
      if (source[i] === '!') fail('the root modifier is not supported');
      if (source[i] === '%' || source[i] === '*') background = true;
      i++;
      space();
    }
    const name = match(IDENT) ?? fail('expected a node name');
    space();
    if (source[i] !== '(') fail('expected (');
    i++;
    const args: Record<string, CsgValue> = {};
    const positional: CsgValue[] = [];
    for (;;) {
      space();
      if (source[i] === ')') { i++; break; }
      const mark = i;
      const key = match(IDENT);
      space();
      if (key && source[i] === '=' && source[i + 1] !== '=') {
        i++;
        args[key] = value();
      } else {
        i = mark;
        positional.push(value());
      }
      space();
      if (source[i] === ',') i++;
      else if (source[i] !== ')') fail('expected , or )');
    }
    space();
    const children: CsgNode[] = [];
    if (source[i] === ';') i++;
    else if (source[i] === '{') {
      i++;
      for (;;) {
        space();
        if (source[i] === '}') { i++; break; }
        if (i >= source.length) fail('unterminated block');
        const child = node();
        if (child && !child.background) children.push(child);
      }
    } else fail('expected ; or {');
    return { name: name as string, args, positional, children, start, end: i, background };
  };

  const children: CsgNode[] = [];
  for (space(); i < source.length; space()) {
    const child = node();
    if (child && !child.background) children.push(child);
  }
  return { name: 'group', args: {}, positional: [], children, start: 0, end: source.length };
}

export type Matrix = number[][];

export function matrixOf(node: CsgNode): Matrix {
  const m = (node.args.m ?? node.positional[0]) as Matrix | undefined;
  if (!Array.isArray(m) || m.length < 3) throw new Error('multmatrix has no matrix.');
  return m;
}

/** A rotation, translation, uniform scale, or mirror: the transforms that keep circles circular. */
export function isSimilarity(m: Matrix, tolerance = 2e-5) {
  if (m[3] && (m[3][0] !== 0 || m[3][1] !== 0 || m[3][2] !== 0 || m[3][3] !== 1)) return false;
  const col = (j: number) => [m[0][j], m[1][j], m[2][j]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const c = [col(0), col(1), col(2)];
  const s = dot(c[0], c[0]);
  if (s < 1e-12) return false;
  return [dot(c[1], c[1]), dot(c[2], c[2])].every(v => Math.abs(v / s - 1) < tolerance * 4)
    && [dot(c[0], c[1]), dot(c[0], c[2]), dot(c[1], c[2])].every(v => Math.abs(v / s) < tolerance * 4);
}

const CONTAINERS = new Set(['group', 'union', 'difference', 'intersection', 'render', 'color', 'multmatrix']);
const TWO_D = new Set(['square', 'circle', 'polygon', 'text', 'offset', 'projection']);

/** OpenSCAD draws circles with fewer than this many sides as deliberate polygons, such as hex nuts. */
export const MIN_ROUND_FN = 16;

export function fragments(node: CsgNode) {
  const fn = Number(node.args.$fn ?? 0);
  return fn > 0 && fn < MIN_ROUND_FN ? Math.max(3, Math.round(fn)) : 0;
}

export function is2D(node: CsgNode): boolean {
  if (TWO_D.has(node.name)) return true;
  if (CONTAINERS.has(node.name) || node.name === 'hull' || node.name === 'minkowski' || node.name === 'resize') {
    return node.children.some(is2D);
  }
  return false;
}

function radiusPair(node: CsgNode): [number, number] {
  const r = node.args.r as number | undefined;
  return [Number(node.args.r1 ?? r ?? 1), Number(node.args.r2 ?? r ?? 1)];
}

export type RoundedOutline = { centers: number[][]; r: number; h: number; z: number };

/** Collects the translated leaves of a hull, or null when anything else appears inside it. */
function translatedLeaves(node: CsgNode, x: number, y: number, z: number, out: { node: CsgNode; at: number[] }[]): boolean {
  if (node.name === 'multmatrix') {
    const m = matrixOf(node);
    const identity = [0, 1, 2].every(r => [0, 1, 2].every(c => Math.abs(m[r][c] - (r === c ? 1 : 0)) < 1e-9));
    return identity && node.children.every(child => translatedLeaves(child, x + m[0][3], y + m[1][3], z + m[2][3], out));
  }
  if (node.name === 'group' || node.name === 'union' || node.name === 'color') {
    return node.children.every(child => translatedLeaves(child, x, y, z, out));
  }
  out.push({ node, at: [x, y, z] });
  return true;
}

/**
 * Recognises the usual ways of drawing a rounded rectangle: the hull of equal circles or
 * upright cylinders, and `offset(r)` of a square. Both are a polygon with circular corners.
 */
export function roundedOutline(node: CsgNode): RoundedOutline | null {
  const leaves: { node: CsgNode; at: number[] }[] = [];
  if (node.name === 'offset') {
    const r = Number(node.args.r ?? 0);
    if (!(r > 0) || fragments(node) || !node.children.every(child => translatedLeaves(child, 0, 0, 0, leaves))) return null;
    if (leaves.length !== 1 || leaves[0].node.name !== 'square') return null;
    const size = leaves[0].node.args.size;
    const [w, d] = Array.isArray(size) ? size as number[] : [Number(size ?? 1), Number(size ?? 1)];
    const [x, y] = leaves[0].at;
    const ox = x - (leaves[0].node.args.center ? w / 2 : 0), oy = y - (leaves[0].node.args.center ? d / 2 : 0);
    return { centers: [[ox, oy], [ox + w, oy], [ox + w, oy + d], [ox, oy + d]], r, h: 0, z: 0 };
  }
  if (node.name !== 'hull' || !node.children.every(child => translatedLeaves(child, 0, 0, 0, leaves)) || !leaves.length) return null;
  const first = leaves[0].node;
  if (first.name !== 'circle' && first.name !== 'cylinder') return null;
  const key = (leaf: CsgNode) => {
    const [r1, r2] = radiusPair(leaf);
    return r1 === r2 && r1 > 0 && !fragments(leaf) ? `${leaf.name}|${r1}|${leaf.args.h ?? ''}|${Boolean(leaf.args.center)}` : '';
  };
  const shape = key(first);
  if (!shape || leaves.some(leaf => key(leaf.node) !== shape || leaf.at[2] !== leaves[0].at[2])) return null;
  const h = Number(first.args.h ?? 0);
  return {
    centers: leaves.map(leaf => leaf.at.slice(0, 2)),
    r: radiusPair(first)[0],
    h,
    z: leaves[0].at[2] - (first.args.center ? h / 2 : 0),
  };
}

function exactProfile(node: CsgNode): boolean {
  switch (node.name) {
    case 'square': case 'circle': case 'polygon': return true;
    case 'hull': case 'offset': return roundedOutline(node) !== null;
    case 'group': case 'union': case 'difference': case 'intersection': case 'render': case 'color':
      return node.children.every(exactProfile);
    case 'multmatrix':
      return isSimilarity(matrixOf(node)) && node.children.every(exactProfile);
    default: return false;
  }
}

function exactLeaf(node: CsgNode): boolean {
  switch (node.name) {
    case 'cube': case 'polyhedron': return true;
    case 'hull': return roundedOutline(node) !== null;
    case 'sphere': return fragments(node) === 0;
    case 'cylinder': {
      const [r1, r2] = radiusPair(node);
      return fragments(node) === 0 || r1 === r2;
    }
    case 'linear_extrude': {
      const scale = node.args.scale;
      const unit = scale === undefined || scale === 1 || (Array.isArray(scale) && scale.every(s => s === 1));
      return unit && !Number(node.args.twist ?? 0) && node.children.every(exactProfile);
    }
    case 'rotate_extrude':
      return fragments(node) === 0 && node.children.every(exactProfile);
    default: return false;
  }
}

/**
 * Finds the subtrees with no analytic B-rep equivalent, such as hull or text.
 * They are compiled to meshes by OpenSCAD and join the solid as faceted bodies.
 */
export function meshedSubtrees(root: CsgNode): CsgNode[] {
  const found: CsgNode[] = [];
  const visit = (node: CsgNode) => {
    if (node.name === 'multmatrix') {
      if (isSimilarity(matrixOf(node))) node.children.forEach(visit);
      else found.push(node);
    } else if (CONTAINERS.has(node.name)) {
      node.children.forEach(visit);
    } else if (!exactLeaf(node)) {
      found.push(node);
    }
  };
  visit(root);
  return found;
}

function roundFragments(r: number, node: CsgNode) {
  const fn = Number(node.args.$fn ?? 0), fa = Number(node.args.$fa ?? 12), fs = Number(node.args.$fs ?? 2);
  return fn > 0 ? Math.max(fn, 3) : Math.ceil(Math.max(Math.min(360 / fa, r * 2 * Math.PI / fs), 5));
}

/**
 * The largest share of area a faceted circle in this model loses against a true one.
 * OpenSCAD inscribes its polygons, so an exact solid is legitimately bigger than the mesh.
 */
export function faceting(root: CsgNode) {
  let worst = 0;
  const visit = (node: CsgNode) => {
    const round = node.name === 'circle' || node.name === 'sphere' ? Number(node.args.r ?? 1)
      : node.name === 'cylinder' ? Math.max(...radiusPair(node)) : 0;
    if (round > 0 && !fragments(node)) {
      const n = roundFragments(round, node);
      worst = Math.max(worst, 1 - n / (2 * Math.PI) * Math.sin(2 * Math.PI / n));
    }
    node.children.forEach(visit);
  };
  visit(root);
  return worst;
}
