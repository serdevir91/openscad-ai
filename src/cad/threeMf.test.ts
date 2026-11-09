import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { stlTo3mf } from './threeMf';

const facet = (a: number[], b: number[], c: number[]) =>
  `facet normal 0 0 0\nouter loop\nvertex ${a.join(' ')}\nvertex ${b.join(' ')}\nvertex ${c.join(' ')}\nendloop\nendfacet\n`;
const stl = new TextEncoder().encode(`solid t\n${
  facet([0, 0, 0], [0, 10, 0], [10, 0, 0]) + facet([0, 0, 0], [10, 0, 0], [0, 0, 10]) + facet([0, 0, 0], [0, 0, 10], [0, 10, 0]) + facet([10, 0, 0], [0, 10, 0], [0, 0, 10])
}endsolid t\n`);

function entries(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: Record<string, string> = {};
  for (let at = 0; view.getUint32(at, true) === 0x04034b50;) {
    const size = view.getUint32(at + 18, true), length = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + length));
    found[name] = inflateRawSync(bytes.subarray(at + 30 + length, at + 30 + length + size)).toString();
    at += 30 + length + size;
  }
  return found;
}

describe('stlTo3mf', () => {
  it('packs the three parts a 3MF reader needs', async () => {
    const files = entries(await stlTo3mf(stl));
    expect(Object.keys(files)).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
    expect(files['_rels/.rels']).toContain('/3D/3dmodel.model');
  });

  it('shares vertices between triangles and states millimetres', async () => {
    const model = entries(await stlTo3mf(stl))['3D/3dmodel.model'];
    expect(model).toContain('unit="millimeter"');
    expect(model.match(/<vertex /g)).toHaveLength(4);
    expect(model.match(/<triangle /g)).toHaveLength(4);
  });
});
