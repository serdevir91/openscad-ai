// Measures the design pipeline against prompts with known answers, using a real model
// and a real OpenSCAD. It spends model quota, so it is not part of `npm test`.
//   EVAL_PROVIDER=opencode|claude-code [EVAL_MODEL=...] [EVAL_SET=hard] [EVAL_OUT=file.json] npm run eval
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'vitest';
import { design, type Compiled, type Completion, type Design } from '../src/ai/pipeline';

type Case = { name: string; prompt: string; size: number[]; holes: number; bodies?: number; hard?: boolean; loose?: boolean };

const CASES: Case[] = [
  { name: 'plate', prompt: 'A rectangular mounting plate 120 x 80 x 6 mm with four 5 mm through holes, each 8 mm in from both edges at the corners.', size: [120, 80, 6], holes: 4 },
  { name: 'bushing', prompt: 'A flanged bushing: flange 40 mm diameter and 5 mm thick on a 20 mm diameter body, 30 mm total height, with a 10 mm bore all the way through.', size: [40, 40, 30], holes: 1 },
  { name: 'bracket', prompt: 'An L bracket with legs 60 mm and 40 mm long, 30 mm wide, 4 mm thick, with two 6 mm through holes in each leg.', size: [60, 30, 40], holes: 4 },
  { name: 'standoff', prompt: 'A hexagonal standoff 10 mm across flats and 25 mm long with a 4.2 mm hole through its length.', size: [11.547, 10, 25], holes: 1 },
  { name: 'box', prompt: 'An open-top box, outer size 100 x 60 x 40 mm, with 2.5 mm walls and floor.', size: [100, 60, 40], holes: 0 },
  { name: 'steps', prompt: 'A stepped shaft of three stacked cylinders with diameters 50, 35, and 20 mm, each 10 mm tall.', size: [50, 50, 30], holes: 0 },
  { name: 'ring', prompt: 'A flat ring with 30 mm outer diameter, 20 mm inner diameter, 8 mm tall.', size: [30, 30, 8], holes: 1 },
  { name: 'spacers', prompt: 'Two separate round spacers side by side with a 5 mm gap: each 20 mm diameter, 10 mm tall, with a 6 mm centre hole.', size: [45, 20, 10], holes: 2, bodies: 2 },
  { name: 'flange', hard: true, prompt: 'A pipe flange: 120 mm outside diameter, 12 mm thick, with a raised face 70 mm in diameter standing 2 mm proud. A 50 mm centre bore goes through everything, and six 11 mm bolt holes sit evenly on a 90 mm bolt circle.', size: [120, 120, 14], holes: 7 },
  { name: 'lid', hard: true, prompt: 'An enclosure lid: plate 80 x 50 x 4 mm with a rectangular locating lip on the underside, inset 1.5 mm from all edges, 3 mm tall and 1.5 mm thick, hollow inside. Four 3.4 mm screw holes 5 mm in from the corners, each counterbored 6.5 mm wide and 2 mm deep from the top.', size: [80, 50, 7], holes: 4 },
  { name: 'coupler', hard: true, prompt: 'A shaft coupler: cylinder 30 mm diameter and 40 mm long with a 12 mm bore along its axis, and one 4 mm radial hole through one wall only, at mid height, reaching the bore.', size: [30, 30, 40], holes: 2 },
  { name: 'elbow', hard: true, prompt: 'A 90 degree pipe elbow: 30 mm outer diameter, 24 mm inner diameter, 40 mm centreline bend radius, with no straight ends.', size: [55, 55, 30], holes: 1 },
  { name: 'gear', hard: true, prompt: 'A spur gear with 24 teeth, module 2, 8 mm wide, with an 8 mm bore. The tip diameter is 52 mm.', size: [52, 52, 8], holes: 1 },
  { name: 'tray', hard: true, prompt: 'A parts tray, outer 200 x 120 x 30 mm, 2 mm walls and floor, with internal dividers making 3 by 2 equal compartments, and one 5 mm hanging hole through the floor in the middle of each compartment.', size: [200, 120, 30], holes: 6 },
  { name: 'links', hard: true, prompt: 'Two interlocked but separate flat rings, like chain links: each 40 mm outer diameter, 30 mm inner diameter, 5 mm thick. One lies flat, the other stands upright through it, and they do not touch.', size: [70, 40, 40], holes: 2, bodies: 2, loose: true },
];

const OPENSCAD = process.env.OPENSCAD ?? '/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD';
const PROVIDER = process.env.EVAL_PROVIDER ?? 'opencode';
const MODEL = process.env.EVAL_MODEL;
const folder = mkdtempSync(join(tmpdir(), 'scad-eval-'));

function run(file: string, args: string[], input?: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(file, args, { maxBuffer: 1 << 26, timeout: 300_000, cwd: folder }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.killed ? 'timed out' : 'failed'}: ${stderr}`.slice(-1000)));
      else resolve({ stdout, stderr });
    });
    child.stdin?.end(input ?? '');
  });
}

async function complete(request: Completion) {
  const text = `${request.system}\n\n${request.prompt}`;
  if (PROVIDER === 'claude-code') {
    return (await run('claude', ['-p', '--output-format', 'text', '--tools', '', ...(MODEL ? ['--model', MODEL] : [])], text)).stdout;
  }
  return (await run(`${process.env.HOME}/.opencode/bin/opencode`, ['run', ...(MODEL ? ['-m', MODEL] : []), text])).stdout;
}

async function compile(code: string): Promise<Compiled> {
  const source = join(folder, 'model.scad'), target = join(folder, 'model.stl');
  writeFileSync(source, code);
  rmSync(target, { force: true });
  const { stderr } = await run(OPENSCAD, [source, '-o', target, '--export-format', 'binstl', '--backend=manifold']);
  return { bytes: readFileSync(target), log: stderr };
}

function score(result: Design | undefined, expected: Case) {
  if (!result) return { size: false, holes: false, bodies: false, solid: false };
  const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
  const want = sorted(expected.size), got = sorted(result.metrics.size);
  return {
    size: expected.loose || want.every((value, axis) => Math.abs(value - got[axis]) <= 0.25),
    holes: result.metrics.throughHoles === expected.holes,
    bodies: result.metrics.bodies === (expected.bodies ?? 1),
    solid: result.metrics.watertight,
  };
}

it('scores both modes', async () => {
  const rows = [];
  for (const mode of ['fast', 'precise'] as const) {
    for (const item of CASES.filter(entry => process.env.EVAL_SET !== 'hard' || entry.hard)) {
      let calls = 0, result: Design | undefined, error = '';
      const started = Date.now();
      try {
        result = await design({ prompt: item.prompt, code: '', skills: [], repairs: 3, precise: mode === 'precise', vision: false }, {
          complete: request => { calls++; return complete(request); },
          compile,
          docs: async () => '',
          log: () => {},
        });
      } catch (reason) {
        error = String(reason).slice(-300);
      }
      const marks = score(result, item);
      const row = { mode, name: item.name, pass: Object.values(marks).every(Boolean), ...marks, calls, seconds: Math.round((Date.now() - started) / 1000), measured: result?.metrics.size.map(value => Number(value.toFixed(2))), holes_found: result?.metrics.throughHoles, error };
      rows.push(row);
      console.log(JSON.stringify(row));
      if (process.env.EVAL_OUT) writeFileSync(process.env.EVAL_OUT, JSON.stringify(rows, null, 1));
    }
  }
  for (const mode of ['fast', 'precise']) {
    const part = rows.filter(row => row.mode === mode);
    console.log(`${PROVIDER} ${mode}: ${part.filter(row => row.pass).length}/${part.length} exact, ${part.reduce((sum, row) => sum + row.calls, 0)} model calls`);
  }
  rmSync(folder, { recursive: true, force: true });
});
