import { planStep, type StepResult } from './step';

type Compile = (code: string, format: string) => Promise<{ bytes: Uint8Array }>;

let worker: Worker | undefined;

function convert(input: unknown, transfer: Transferable[], signal?: AbortSignal) {
  worker ??= new Worker(new URL('../workers/step.worker.ts', import.meta.url), { type: 'module' });
  const active = worker;
  return new Promise<StepResult>((resolve, reject) => {
    const stop = () => {
      // OpenCascade cannot be interrupted, so the worker goes with it.
      active.terminate();
      worker = undefined;
      reject(new DOMException('Stopped', 'AbortError'));
    };
    signal?.addEventListener('abort', stop, { once: true });
    const done = () => signal?.removeEventListener('abort', stop);
    active.onmessage = event => {
      done();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    active.onerror = event => {
      done();
      active.terminate();
      worker = undefined;
      reject(new Error(event.message || 'The STEP converter stopped unexpectedly.'));
    };
    active.postMessage(input, transfer);
  });
}

/** Compiles what the converter needs, then builds the STEP file off the main thread. */
export async function buildStep(code: string, name: string, compile: Compile, log: (message: string) => void, mesh?: Uint8Array, signal?: AbortSignal) {
  log('Reading the model tree…');
  const csg = new TextDecoder().decode((await compile(code, 'csg')).bytes);
  const reference = (mesh ?? (await compile(code, 'stl')).bytes).slice();
  const plan = planStep(csg);
  const meshes: { start: number; stl: Uint8Array }[] = [];
  for (const [index, item] of plan.entries()) {
    log(`Meshing ${item.name} feature ${index + 1} of ${plan.length}…`);
    meshes.push({ start: item.start, stl: (await compile(item.source, 'stl')).bytes });
  }
  log('Building the solid with OpenCascade…');
  return convert({ csg, meshes, reference, name }, [reference.buffer, ...meshes.map(item => item.stl.buffer as ArrayBuffer)], signal);
}
