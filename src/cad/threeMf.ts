// A 3MF file is a zip of three small XML parts. The OpenSCAD WebAssembly build writes
// empty 3MF output, so the file is assembled here from the mesh for every platform.
import { parseStl, weld } from './mesh';

const encoder = new TextEncoder();

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
const RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

function modelXml(stl: Uint8Array) {
  const { points, faces } = weld(parseStl(stl));
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>'];
  const text = (value: number) => Number(value.toFixed(6));
  for (let i = 0; i < points.length; i += 3) parts.push(`<vertex x="${text(points[i])}" y="${text(points[i + 1])}" z="${text(points[i + 2])}"/>`);
  parts.push('</vertices><triangles>');
  for (let i = 0; i < faces.length; i += 3) parts.push(`<triangle v1="${faces[i]}" v2="${faces[i + 1]}" v3="${faces[i + 2]}"/>`);
  parts.push('</triangles></mesh></object></resources><build><item objectid="1"/></build></model>');
  return parts.join('');
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value;
});

function crc32(bytes: Uint8Array) {
  let crc = ~0;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return ~crc >>> 0;
}

async function deflate(bytes: Uint8Array) {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function zip(files: [string, string][]) {
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const path = encoder.encode(name), raw = encoder.encode(text), data = await deflate(raw);
    const shared = (view: DataView, at: number) => {
      view.setUint16(at, 20, true);
      view.setUint16(at + 4, 8, true);
      view.setUint32(at + 10, crc32(raw), true);
      view.setUint32(at + 14, data.length, true);
      view.setUint32(at + 18, raw.length, true);
      view.setUint16(at + 22, path.length, true);
    };
    const local = new Uint8Array(30 + path.length + data.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    shared(header, 4);
    local.set(path, 30);
    local.set(data, 30 + path.length);
    const central = new Uint8Array(46 + path.length);
    const entry = new DataView(central.buffer);
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    shared(entry, 6);
    entry.setUint32(42, offset, true);
    central.set(path, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const size = centrals.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const tail = new DataView(end.buffer);
  tail.setUint32(0, 0x06054b50, true);
  tail.setUint16(8, files.length, true);
  tail.setUint16(10, files.length, true);
  tail.setUint32(12, size, true);
  tail.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, at); at += part.length; }
  return out;
}

export function stlTo3mf(stl: Uint8Array) {
  return zip([['[Content_Types].xml', CONTENT_TYPES], ['_rels/.rels', RELATIONSHIPS], ['3D/3dmodel.model', modelXml(stl)]]);
}
