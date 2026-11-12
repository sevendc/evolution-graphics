# Project Guidelines

## Architecture

- `index.html` is the application entry point. Keep markup there, styles in `styles.css`, and JavaScript modules in `js/` (including `js/gpu/` and `js/ui/`); WGSL shaders are in `js/gpu/shaders.js`.
- `server.js` is a dependency-free static server. `npm start` serves the project root on `127.0.0.1:8080` by default; `HOST` and `PORT` are configurable.
- The static site is also hosted at https://sevendc.github.io/evolution-graphics/. Keep stylesheet, module, and asset URLs relative so they work under the repository path on GitHub Pages.
- Evolution and image processing run locally in the browser using WebGPU. User-provided images and genomes must remain local; do not add network uploads or transmit their contents.
- README artwork belongs in `assets/` and is served as a static file alongside the app.
- Put new future feature ideas and fix investigations in `documentation/plans.md`; label proposals clearly and include risks and verifiable acceptance criteria.

## Conventions

- Preserve the no-build, no-third-party-dependency setup. Do not introduce a framework or build step for isolated changes.
- Keep the TOON export and import formats compatible with each other and the included example genome.
- Surface browser, WebGPU, and input errors through the existing status/notice UI rather than silently ignoring them.
- Keep README artwork static and stored in the repository; do not load it from a third-party host.

## Validation

- There is no automated test script. For server changes, run `node --check server.js` and smoke-test `npm start` with a browser or HTTP request.
- For application changes, also manually verify in a WebGPU-capable browser: the GitHub Pages path and asset loading, target loading, starting and pausing evolution, reset, and relevant import/export or settings behavior.
