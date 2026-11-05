# Form & Signal — Image Evolution

A browser-based WebGPU experiment that evolves a picture from translucent triangles. Candidate genomes are rendered and scored on your GPU, and the best result is shown alongside the target as evolution progresses.

On wide screens, focus and simplification (steps 4 and 5) appear in their own panel to the right of the main controls. At narrower widths, that panel moves below the image and main controls.

## Requirements

- Node.js (no third-party packages are required)
- A recent browser with WebGPU support, such as Chrome or Edge
- A WebGPU-compatible device and driver

The app must be served from a secure context. `localhost` is supported for local development.

## Run locally

From the project directory:

```sh
npm start
```

Open [http://localhost:8080](http://localhost:8080). The server binds to `127.0.0.1` by default. To use a different host or port, set the `HOST` or `PORT` environment variables before running `npm start`.

## Use

1. Choose **Upload image**, **Use camera**, or **Try sample** to set the target. Camera access requires permission; image upload and the built-in sample are alternatives.
2. Set the starting triangle count, mutation strength, structural mutation chance, and candidates per generation.
3. Select **Start evolution**. Pause or resume with the same button; use the reset button to restart with the current settings.
4. Drag a rectangle on the target image to focus some guided mutations on that area. Adjust **Guided mutations in selection** to control how often guided mutations target it; focused proposals mix high-error samples with random samples from the target image, using sampled colors and varied triangle shapes to add detail. Clear the selection to return to global guidance. Fitness still scores the full image.
5. Compare the best candidate with the target. A lower multi-scale error means a closer match. Live statistics are shown below the image comparison.
6. Once a result is available, choose a removal percentage and analyze simplification. The app scores leave-one-triangle-out variants, previews removing the least-impactful triangles, and shows the fitness change. Keep the preview to continue from the smaller genome, or discard it to restore the previous result.
7. Save the evolved image as PNG or export its genome as TOON. Import a TOON file or paste its text to seed a run.

The genome supports up to 512 triangles and the population setting ranges up to 2,048 candidates per generation. Larger values can use substantially more GPU time; reduce the population if the page becomes sluggish. Changing the starting triangle count resets evolution, while population and structural mutation settings can be adjusted during a run.

## Project files

- [`index.html`](./index.html) — Self-contained application: interface, styles, JavaScript, and WGSL GPU shaders.
- [`server.js`](./server.js) — Minimal static-file server used by `npm start`.
- [`package.json`](./package.json) — Project metadata and start script.
- [`plan.md`](./plan.md), [`plan2.md`](./plan2.md), and [`plan3.md`](./plan3.md) — Implementation notes and follow-up ideas.
- [`whatsapp-image-2024-09-12-at-17-15-37_4652b8f4-genome.toon`](./whatsapp-image-2024-09-12-at-17-15-37_4652b8f4-genome.toon) — Example TOON genome.

The application processes images locally in the browser; it does not upload them to a server. There is currently no automated test script in `package.json`.
