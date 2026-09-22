type OpenScadModule = {
  FS: {
    writeFile(path: string, data: string): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
  callMain(args: string[]): number;
};

type OpenScadFactory = (options: Record<string, unknown>) => Promise<OpenScadModule>;
type CompileRequest = { id: number; code: string; baseUrl: string };

let modulePromise: Promise<OpenScadModule> | undefined;
let output: string[] = [];

async function load(baseUrl: string) {
  if (!modulePromise) {
    modulePromise = import(/* @vite-ignore */ `${baseUrl}openscad.js`).then(module => {
      const factory = module.default as OpenScadFactory;
      return factory({
        noInitialRun: true,
        noExitRuntime: true,
        locateFile: (name: string) => `${baseUrl}${name}`,
        print: (line: string) => output.push(line),
        printErr: (line: string) => output.push(line),
      });
    });
  }
  return modulePromise;
}

self.onmessage = async (event: MessageEvent<CompileRequest>) => {
  const { id, code, baseUrl } = event.data;
  output = [];
  try {
    const openscad = await load(baseUrl);
    for (const file of ['/input.scad', '/output.stl']) {
      try { openscad.FS.unlink(file); } catch { /* File may not exist yet. */ }
    }
    openscad.FS.writeFile('/input.scad', code);
    const status = openscad.callMain(['/input.scad', '--enable=manifold', '-o', '/output.stl']);
    if (status !== 0) throw new Error(output.join('\n') || `OpenSCAD exited with status ${status}`);
    const bytes = openscad.FS.readFile('/output.stl');
    const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    self.postMessage({ id, ok: true, stl: exact, log: output.join('\n') }, { transfer: [exact] });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error), log: output.join('\n') });
  }
};

export {};
