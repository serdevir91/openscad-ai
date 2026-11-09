# Third-party notices

## OpenSCAD WebAssembly runtime

The GitHub Pages build downloads and redistributes the official headless OpenSCAD WebAssembly runtime:

- Project: [OpenSCAD](https://github.com/openscad/openscad)
- WebAssembly build tooling: [openscad/openscad-wasm](https://github.com/openscad/openscad-wasm)
- Runtime build: `OpenSCAD-2025.03.25.wasm24456-WebAssembly-web.zip`
- Runtime source: `https://files.openscad.org/playground/OpenSCAD-2025.03.25.wasm24456-WebAssembly-web.zip`
- License: GNU General Public License v2.0

## OpenCascade Technology

STEP export rebuilds the OpenSCAD CSG tree in OpenCascade Technology, which is distributed through `replicad-opencascadejs`:

- Package: [replicad-opencascadejs](https://www.npmjs.com/package/replicad-opencascadejs) 1.2.1
- Upstream project: [OpenCascade Technology](https://github.com/Open-Cascade-SAS/OCCT)
- License: LGPL-2.1 with the OCCT exception

The OpenCascade WebAssembly file is shipped unmodified as a separate file, so users can replace it with their own build of the same library.

## Anthropic SDK

The app uses this SDK for Anthropic provider calls:

- Package: [@anthropic-ai/sdk](https://www.npmjs.com/package/@anthropic-ai/sdk)
- License: MIT

OpenSCAD, OpenCascade Technology, and the other packages above are separate third-party works. Their copyright and license terms remain with their respective authors. Source and build instructions are available from the linked upstream repositories.
