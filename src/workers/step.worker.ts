import init from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { convertToStep, type StepInput } from '../cad/step';
import type { Occt } from '../cad/brep';

let ready: Promise<Occt> | undefined;

function load() {
  // OpenCascade reports every transfer on stdout, which is noise here.
  ready ??= init({ locateFile: () => wasmUrl, print: () => {}, printErr: () => {} } as Parameters<typeof init>[0]) as unknown as Promise<Occt>;
  return ready;
}

self.onmessage = async (event: MessageEvent<StepInput>) => {
  try {
    const result = convertToStep(await load(), event.data);
    const { buffer } = result.bytes;
    self.postMessage({ ok: true, result }, { transfer: [buffer as ArrayBuffer] });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
