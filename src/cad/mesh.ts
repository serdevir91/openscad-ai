// STL parsing and exact mesh metrology. Pure code: runs in the browser, workers, and Node tests.

export type Mesh = { positions: Float32Array; triangles: number };

export type MeshMetrics = {
  triangles: number;
  vertices: number;
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  center: [number, number, number];
  /** Absolute enclosed volume in mm³. Only meaningful when `watertight` is true. */
  volume: number;
  /** Surface area in mm². */
  area: number;
  watertight: boolean;
  /** Edges not shared by exactly two faces. */
  badEdges: number;
  /** Disconnected solid bodies, not counting internal voids. */
  bodies: number;
  /** Internal cavities: shells with inward-facing winding. */
  voids: number;
  /** Sum of body genus: the number of through-holes and handles. */
  throughHoles: number;
};

function isAsciiStl(bytes: Uint8Array) {
  if (bytes.length < 84) return true;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expected = 84 + view.getUint32(80, true) * 50;
  if (expected === bytes.length) return false;
  return new TextDecoder().decode(bytes.subarray(0, 5)) === 'solid';
}

export function parseStl(bytes: Uint8Array): Mesh {
  if (isAsciiStl(bytes)) {
    const text = new TextDecoder().decode(bytes);
    const values: number[] = [];
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) values.push(Number(match[1]), Number(match[2]), Number(match[3]));
    if (values.length % 9 !== 0 || values.some(v => !Number.isFinite(v))) throw new Error('The STL data is malformed.');
    return { positions: Float32Array.from(values), triangles: values.length / 9 };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = view.getUint32(80, true);
  const positions = new Float32Array(triangles * 9);
  for (let t = 0; t < triangles; t++) {
    const offset = 84 + t * 50 + 12;
    for (let i = 0; i < 9; i++) positions[t * 9 + i] = view.getFloat32(offset + i * 4, true);
  }
  return { positions, triangles };
}

/** Merges coincident vertices and drops zero-area triangles. Returns index triples. */
export function weld(mesh: Mesh, tolerance = 1e-4) {
  const ids = new Map<string, number>();
  const points: number[] = [];
  const faces: number[] = [];
  const scale = 1 / tolerance;
  const vertex = (t: number, c: number) => {
    const o = t * 9 + c * 3;
    const x = mesh.positions[o], y = mesh.positions[o + 1], z = mesh.positions[o + 2];
    const key = `${Math.round(x * scale)},${Math.round(y * scale)},${Math.round(z * scale)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = points.length / 3;
      ids.set(key, id);
      points.push(x, y, z);
    }
    return id;
  };
  for (let t = 0; t < mesh.triangles; t++) {
    const a = vertex(t, 0), b = vertex(t, 1), c = vertex(t, 2);
    if (a !== b && b !== c && a !== c) faces.push(a, b, c);
  }
  return { points: Float64Array.from(points), faces: Uint32Array.from(faces) };
}

export function measure(mesh: Mesh): MeshMetrics {
  const { points, faces } = weld(mesh);
  const vertexCount = points.length / 3;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i++) {
    const axis = i % 3;
    if (points[i] < min[axis]) min[axis] = points[i];
    if (points[i] > max[axis]) max[axis] = points[i];
  }
  if (!vertexCount) throw new Error('The mesh contains no geometry.');

  // Directed-edge bookkeeping: a closed oriented surface uses every edge once in each direction.
  const edges = new Map<number, number>();
  const parent = new Int32Array(vertexCount).map((_, i) => i);
  const find = (i: number) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const addEdge = (a: number, b: number) => {
    const key = a < b ? a * vertexCount + b : b * vertexCount + a;
    edges.set(key, (edges.get(key) ?? 0) + (a < b ? 1 : 65536));
    parent[find(a)] = find(b);
  };
  const triangleCount = faces.length / 3;
  for (let f = 0; f < faces.length; f += 3) {
    addEdge(faces[f], faces[f + 1]);
    addEdge(faces[f + 1], faces[f + 2]);
    addEdge(faces[f + 2], faces[f]);
  }
  let badEdges = 0;
  for (const count of edges.values()) if (count !== 65537) badEdges++;

  const shells = new Map<number, { vertices: number; edges: number; faces: number; volume: number }>();
  const shell = (root: number) => {
    let entry = shells.get(root);
    if (!entry) shells.set(root, entry = { vertices: 0, edges: 0, faces: 0, volume: 0 });
    return entry;
  };
  const used = new Uint8Array(vertexCount);
  for (let f = 0; f < faces.length; f++) used[faces[f]] = 1;
  for (let v = 0; v < vertexCount; v++) if (used[v]) shell(find(v)).vertices++;
  for (const key of edges.keys()) shell(find(Math.floor(key / vertexCount))).edges++;

  let area = 0;
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f] * 3, b = faces[f + 1] * 3, c = faces[f + 2] * 3;
    const ax = points[a], ay = points[a + 1], az = points[a + 2];
    const bx = points[b] - ax, by = points[b + 1] - ay, bz = points[b + 2] - az;
    const cx = points[c] - ax, cy = points[c + 1] - ay, cz = points[c + 2] - az;
    const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
    area += Math.hypot(nx, ny, nz) / 2;
    const entry = shell(find(faces[f]));
    entry.faces++;
    entry.volume += (ax * nx + ay * ny + az * nz) / 6;
  }

  let volume = 0, bodies = 0, voids = 0, throughHoles = 0;
  for (const entry of shells.values()) {
    volume += entry.volume;
    if (entry.volume < 0) voids++; else bodies++;
    const genus = (2 - (entry.vertices - entry.edges + entry.faces)) / 2;
    if (Number.isInteger(genus) && genus > 0) throughHoles += genus;
  }
  const size = [0, 1, 2].map(i => max[i] - min[i]) as [number, number, number];
  const center = [0, 1, 2].map(i => (max[i] + min[i]) / 2) as [number, number, number];
  return {
    triangles: triangleCount, vertices: vertexCount, min, max, size, center,
    volume: Math.abs(volume), area, watertight: badEdges === 0, badEdges, bodies, voids, throughHoles,
  };
}
