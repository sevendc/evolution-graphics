# Project Guidelines

## Architecture

- The application is intentionally self-contained in `index.html`; its UI, CSS, JavaScript, and WGSL shaders live together. Keep changes consistent with this structure unless the project scope changes.
- `server.js` is a dependency-free static server. `npm start` serves the project root on `127.0.0.1:8080` by default; `HOST` and `PORT` are configurable.
- Evolution and image processing run locally in the browser using WebGPU. Camera use requires browser permission and a secure context.

## Conventions

- Preserve the no-build, no-third-party-dependency setup. Do not introduce a framework or build step for isolated changes.
- Keep the TOON export and import formats compatible with each other and the included example genome.
- Surface browser, WebGPU, and input errors through the existing status/notice UI rather than silently ignoring them.
- Keep user-provided files local; do not add network uploads or transmit image/genome content.

## Validation

- There is no automated test script. For server changes, run `node --check server.js` and smoke-test `npm start` with a browser or HTTP request.
- For application changes, also manually verify in a WebGPU-capable browser: target loading, starting and pausing evolution, reset, and relevant import/export or settings behavior.
