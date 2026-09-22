import type { Artifact } from './hooks/useTauriCommands';

type WorkerResponse = { id: number; ok: boolean; stl?: ArrayBuffer; error?: string; log?: string };
let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<number, { resolve: (value: Artifact) => void; reject: (reason: Error) => void }>();

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./workers/openscad.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (!event.data.ok || !event.data.stl) {
      request.reject(new Error(event.data.error || event.data.log || 'OpenSCAD WebAssembly compilation failed.'));
      return;
    }
    request.resolve({ code: '', name: 'browser-model', stl: toBase64(event.data.stl) });
  };
  worker.onerror = event => {
    const error = new Error(event.message || 'OpenSCAD WebAssembly worker failed.');
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}

export function compileInBrowser(code: string): Promise<Artifact> {
  const id = ++sequence;
  const baseUrl = new URL('openscad/', document.baseURI).href;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: artifact => resolve({ ...artifact, code }), reject });
    getWorker().postMessage({ id, code, baseUrl });
  });
}

export function downloadBrowserFile(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}
