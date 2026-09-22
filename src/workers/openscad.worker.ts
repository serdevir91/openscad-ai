type OpenScadModule = {
  FS: {
    writeFile(path: string, data: string): void;
    readFile(path: string): Uint8Array;
    unlink?(path: string): void;
  };
  callMain(args: string[]): number;
};

type OpenScadFactory = (options: Record<string, unknown>) => Promise<OpenScadModule>;
type CompileRequest = { id: number; code: string; baseUrl: string };

let factoryPromise: Promise<OpenScadFactory> | undefined;
let wasmBinaryPromise: Promise<ArrayBuffer> | undefined;

function getFactory(baseUrl: string): Promise<OpenScadFactory> {
  if (!factoryPromise) {
    factoryPromise = import(/* @vite-ignore */ `${baseUrl}openscad.js`).then(m => m.default as OpenScadFactory);
  }
  return factoryPromise;
}

function getWasmBinary(baseUrl: string): Promise<ArrayBuffer> {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = fetch(`${baseUrl}openscad.wasm`).then(res => {
      if (!res.ok) {
        throw new Error(`Failed to load openscad.wasm (${res.status} ${res.statusText})`);
      }
      return res.arrayBuffer();
    });
  }
  return wasmBinaryPromise;
}

function cleanLog(lines: string[]): string {
  return lines
    .filter(l => {
      const trimmed = l.trim();
      if (!trimmed) return false;
      if (trimmed.includes('Could not initialize localization')) return false;
      return true;
    })
    .join('\n')
    .trim();
}

self.onmessage = async (event: MessageEvent<CompileRequest>) => {
  const { id, code, baseUrl } = event.data;
  const output: string[] = [];

  try {
    const [factory, wasmBinary] = await Promise.all([
      getFactory(baseUrl),
      getWasmBinary(baseUrl),
    ]);

    // Each compilation MUST use a fresh module instance because OpenSCAD's C++
    // static state and AST parser are not re-entrant on the same instance.
    const openscad = await factory({
      wasmBinary,
      noInitialRun: true,
      noExitRuntime: true,
      print: (line: string) => output.push(line),
      printErr: (line: string) => output.push(line),
    });

    openscad.FS.writeFile('/input.scad', code);
    const status = openscad.callMain(['/input.scad', '-o', '/output.stl']);
    const log = cleanLog(output);

    if (status !== 0) {
      throw new Error(log || `OpenSCAD compilation failed (exit code ${status})`);
    }

    let bytes: Uint8Array;
    try {
      bytes = openscad.FS.readFile('/output.stl');
    } catch {
      throw new Error(log || 'OpenSCAD produced no STL output geometry.');
    }

    if (bytes.length === 0) {
      throw new Error('Generated STL model is empty.');
    }

    const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    self.postMessage({ id, ok: true, stl: exact, log }, { transfer: [exact] });
  } catch (error) {
    const log = cleanLog(output);
    const msg = error instanceof Error ? error.message : String(error);
    const errText = (/^\d+$/.test(msg) || !msg ? (log || 'OpenSCAD WebAssembly compilation failed.') : msg);
    self.postMessage({ id, ok: false, error: errText, log });
  }
};

export {};
