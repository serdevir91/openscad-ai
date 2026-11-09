import { describe, expect, it, vi } from 'vitest';
import { design, extractCode, type Tools } from './pipeline';
import { failures, parseSpec, verify, type Spec } from './spec';
import { diagnostics } from '../cad/diagnostics';
import type { MeshMetrics } from '../cad/mesh';

function stlBox(x: number, y: number, z: number) {
  const v = (i: number) => [i & 1 ? x : 0, i & 2 ? y : 0, i & 4 ? z : 0];
  const faces = [[0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4], [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5]];
  const out = new DataView(new ArrayBuffer(84 + faces.length * 50));
  out.setUint32(80, faces.length, true);
  faces.forEach((face, f) => face.forEach((corner, c) => v(corner).forEach((value, axis) => out.setFloat32(84 + f * 50 + 12 + c * 12 + axis * 4, value, true))));
  return new Uint8Array(out.buffer);
}

const metrics = (over: Partial<MeshMetrics> = {}): MeshMetrics => ({
  triangles: 12, vertices: 8, min: [0, 0, 0], max: [80, 60, 20], size: [80, 60, 20], center: [40, 30, 10],
  volume: 96000, area: 15200, watertight: true, badEdges: 0, bodies: 1, voids: 0, throughHoles: 0, ...over,
});
const spec = (over: Partial<Spec> = {}): Spec => ({
  summary: '', envelope: { x: 80, y: 60, z: 20, source: 'user' }, parameters: [], features: [], through_holes: 0, bodies: 1, assumptions: [], edit_existing: false, ...over,
});

describe('reading model output', () => {
  it('takes fenced code with any tag, or the whole reply', () => {
    expect(extractCode('```openscad\ncube(3);\n```')).toBe('cube(3);');
    expect(extractCode('sphere(2);')).toBe('sphere(2);');
    expect(extractCode('Here it is:\n```\ncube(1);\n```\nEnjoy.')).toBe('cube(1);');
    expect(extractCode('```c\nx = 1;\n```\nand\n```scad\ncube(10);\nsphere(5);\n```')).toBe('cube(10);\nsphere(5);');
    expect(extractCode('```scad\ncube(1);')).toBe('cube(1);');
  });
  it('reads a plan wrapped in prose and rejects junk', () => {
    const plan = parseSpec('Sure:\n```json\n{"summary":"tray","envelope":{"x":"80","y":60,"z":20,"source":"user"},"parameters":[{"name":"wall","value":3,"source":"user"},{"value":1}],"bodies":1,"through_holes":null}\n```');
    expect(plan?.envelope?.x).toBe(80);
    expect(plan?.parameters.map(item => item.name)).toEqual(['wall']);
    expect(plan?.through_holes).toBeNull();
    expect(parseSpec('no json here')).toBeNull();
    expect(parseSpec('{"envelope":{"x":0,"y":1,"z":1}}')?.envelope).toBeNull();
  });
  it('finds the line of an OpenSCAD error', () => {
    const found = diagnostics("ERROR: Parser error: syntax error in file input.scad, line 3\nWARNING: Ignoring unknown variable 'a' in file input.scad, line 12\nTRACE: called by 'x'\nECHO: 1");
    expect(found).toEqual([
      { severity: 'error', line: 3, message: 'Parser error: syntax error' },
      { severity: 'warning', line: 12, message: "Ignoring unknown variable 'a'" },
    ]);
  });
});

describe('verification', () => {
  it('passes a model that meets the plan in any orientation', () => {
    expect(failures(verify(metrics({ size: [20, 60, 80] }), '', '', spec()))).toEqual([]);
  });
  it('fails a wrong size, but only warns about an assumed one', () => {
    expect(failures(verify(metrics({ size: [80, 60, 25] }), '', '', spec()))).toHaveLength(1);
    const assumed = spec({ envelope: { x: 80, y: 60, z: 20, source: 'assumed' } });
    expect(failures(verify(metrics({ size: [80, 60, 25] }), '', '', assumed))).toEqual([]);
  });
  it('allows the tolerance on overall size', () => {
    expect(failures(verify(metrics({ size: [80.4, 60, 20] }), '', '', spec()))).toEqual([]);
  });
  it('fails open meshes, missing holes, and extra bodies', () => {
    expect(failures(verify(metrics({ watertight: false, badEdges: 4 }), '', '', spec()))).toHaveLength(1);
    expect(failures(verify(metrics(), '', '', spec({ through_holes: 4 })))).toHaveLength(1);
    expect(failures(verify(metrics({ bodies: 3 }), '', '', spec()))).toHaveLength(1);
  });
  it('fails a stated parameter with the wrong value', () => {
    const plan = spec({ parameters: [{ name: 'wall', value: 3, source: 'user' }] });
    expect(failures(verify(metrics(), 'wall = 2;\ncube(1);', '', plan))).toEqual(['wall is 2, stated 3']);
    expect(failures(verify(metrics(), 'wall = 3;\ncube(1);', '', plan))).toEqual([]);
  });
  it('treats an unknown variable as a failure', () => {
    expect(failures(verify(metrics(), '', "WARNING: Ignoring unknown variable 'x' in file a, line 2", null))).toHaveLength(1);
    expect(failures(verify(metrics(), '', 'WARNING: Object may not be a valid 2-manifold', null))).toHaveLength(1);
  });
  it('fails an empty model', () => {
    expect(failures(verify(metrics({ triangles: 0 }), '', '', null))).toHaveLength(1);
  });
});

function tools(replies: string[], compile: Tools['compile']): Tools & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    complete: vi.fn(async request => { prompts.push(request.prompt); return replies.shift() ?? 'cube(1);'; }),
    compile,
    docs: async () => '',
    log: () => {},
  };
}
const request = { prompt: 'an 80 x 60 x 20 block', code: '', skills: [], repairs: 2, precise: true, vision: false };
const PLAN = JSON.stringify({ summary: 'block', envelope: { x: 80, y: 60, z: 20, source: 'user' }, parameters: [], bodies: 1, through_holes: 0 });

describe('design loop', () => {
  it('repairs a model that measures wrong and tells the model what was measured', async () => {
    const io = tools([PLAN, 'cube([80,60,25]);', 'cube([80,60,20]);'], async code => ({
      bytes: code.includes('25') ? stlBox(80, 60, 25) : stlBox(80, 60, 20), log: '',
    }));
    const result = await design(request, io);
    expect(result.code).toBe('cube([80,60,20]);');
    expect(io.prompts[2]).toContain('80 × 60 × 25 mm');
    expect(result.checks.every(check => check.level !== 'fail')).toBe(true);
  });
  it('repairs a compile error', async () => {
    const io = tools([PLAN, 'cube(', 'cube([80,60,20]);'], async code => {
      if (code === 'cube(') throw new Error('ERROR: Parser error in file x, line 1');
      return { bytes: stlBox(80, 60, 20), log: '' };
    });
    expect((await design(request, io)).code).toBe('cube([80,60,20]);');
    expect(io.prompts[2]).toContain('Parser error');
  });
  it('keeps the best design when later attempts get worse', async () => {
    const io = tools([PLAN, 'a', 'b', 'c'], async code => {
      if (code === 'a') return { bytes: stlBox(80, 60, 21), log: '' };
      throw new Error('ERROR: broken');
    });
    expect((await design(request, io)).code).toBe('a');
  });
  it('still designs when the plan cannot be read', async () => {
    const io = tools(['not json', 'cube(1);'], async () => ({ bytes: stlBox(1, 1, 1), log: '' }));
    const result = await design(request, io);
    expect(result.spec).toBeUndefined();
    expect(result.code).toBe('cube(1);');
  });
  it('fails only when nothing ever compiled', async () => {
    const io = tools([PLAN], async () => { throw new Error('ERROR: broken'); });
    await expect(design(request, io)).rejects.toThrow('No attempt compiled');
  });
  it('fast mode skips the plan and accepts what compiles', async () => {
    const io = tools(['cube(5);'], async () => ({ bytes: stlBox(5, 5, 5), log: '' }));
    await design({ ...request, precise: false }, io);
    expect(io.complete).toHaveBeenCalledTimes(1);
  });
  it('applies the visual review once', async () => {
    const io = tools([PLAN, 'a', '{"matches":false,"problems":["the slot is missing"]}', 'b'], async () => ({ bytes: stlBox(80, 60, 20), log: '' }));
    io.views = async () => [{ mime: 'image/png', data: 'QQ==' }];
    const result = await design({ ...request, vision: true }, io);
    expect(result.code).toBe('b');
    expect(io.prompts[3]).toContain('the slot is missing');
    expect(io.complete).toHaveBeenCalledTimes(4);
  });
  it('stops at once when cancelled', async () => {
    const io = tools([], async () => ({ bytes: stlBox(1, 1, 1), log: '' }));
    io.complete = async () => { throw new DOMException('Stopped', 'AbortError'); };
    await expect(design(request, io)).rejects.toThrow('Stopped');
  });
});
