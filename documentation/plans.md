# Ideas, fixes, and future plans

This is the living backlog for proposed features, improvements, and fixes. Ideas are not promises or descriptions of current behavior. Update a status only when the work is actually implemented and verified.

## Status key

- **Idea** — worth exploring; scope and feasibility still need to be decided.
- **Planned** — accepted for implementation, but not started.
- **In progress** — implementation has started.
- **Done** — implemented and verified; include a link to the relevant change or documentation.
- **Deferred** — intentionally postponed; note why.

When adding an entry, include the user problem, a small proposed solution, notable risks or open questions, and measurable acceptance criteria. Keep implementation details flexible until the feature is scheduled.

## Ideas

### Export a standalone JavaScript canvas renderer

**Status: Idea**

Export the current best genome as JavaScript source that draws the image into a supplied HTML canvas, instead of requiring the app or a TOON importer to view it. The generated artifact should be portable and usable in a small page or another local project.

**Possible workflow**

1. Add a **Download JavaScript** action next to PNG and TOON export.
2. Generate a self-contained `.js` file with a documented entry point, for example `render(ctx, width, height)`.
3. Normalize genome coordinates to the requested canvas dimensions and draw shapes in their original order with their color and opacity, preserving the app's compositing behavior.
4. Include a small usage example in the file header or README. Keep the existing TOON format as the editable, re-importable genome format.

**Design questions and safeguards**

- Confirm whether the output should be a renderer function only or a complete standalone HTML file as a second export option.
- The export must not embed or fetch the source image, contact a server, or execute user-provided strings. Serialize validated numeric genome data as data, not generated executable fragments.
- Preserve arbitrary polygon point counts, transparency, draw order, and aspect ratio. Define whether callers may choose a background color or transparent output.
- Decide whether to use the Canvas 2D API for compatibility or include an optional WebGPU renderer. A Canvas 2D export is the simplest portable baseline.
- Compare the exported render pixel-for-pixel (or within a documented tolerance) with the app's canvas/PNG output at multiple sizes.

**Acceptance criteria**

- A downloaded file renders the exported genome without app code, network access, or dependencies.
- Rendering at different canvas sizes preserves geometry and aspect ratio without clipping or distortion.
- Polygon order, color, and opacity match the source genome; output is deterministic.
- Invalid or empty genomes produce a clear export error rather than malformed JavaScript.

### Import video and evolve a temporally coherent sequence

**Status: Idea — exploratory; plan the pipeline before implementation**

Let a user choose a local video, inspect and select frames, evolve the first frame, then use each accepted result as the starting genome for a later frame. Save a sequence that can be rendered back into an animation. This is a larger project than image import: it needs frame selection, temporal continuity, keyframe planning, progress/cancellation, and a reliable sequence export format.

**Proposed workflow**

1. Load a video locally in the browser and show a scrubber with duration, preview, and selected working resolution. Do not upload or persist the source video.
2. Let the user choose a time range, output frame rate or sample interval, and frame budget. Start with explicit sampled frames rather than processing every source frame.
3. Analyze sampled frames to suggest keyframes at scene cuts and substantial visual changes. Show proposed keyframes on the timeline and let the user add, remove, or move them before a run.
4. Evolve the first selected frame using the existing search. At each subsequent sample, initialize from the nearest accepted prior genome (or prior keyframe) and measure improvement against the new frame.
5. Promote a frame to a full keyframe when a scene cut occurs, the visual difference exceeds a threshold, or continuing from the prior genome cannot meet the chosen quality target within a budget. Keep thresholds visible and user-adjustable; avoid silently dropping difficult frames.
6. Save a sequence manifest with timestamps, dimensions, frame rate, keyframe genomes, and per-frame changes or checkpoints. Render a preview from this saved data before offering export.

**Keyframe detection and continuity**

- Begin with inexpensive image comparisons between sampled frames, such as downscaled color difference plus a scene-cut threshold. Consider perceptual hashes or feature-based comparisons only if a simple metric is insufficient.
- Separate **scene cuts** from gradual motion. Cuts should start a new keyframe rather than force mutations to carry across unrelated scenes.
- A new genome should start from the previous result to reuse stable shapes, but unrestricted evolution can change shapes enough to flicker. Investigate temporal regularization that penalizes unnecessary changes while still allowing the result to match the current frame.
- Determine whether intermediate frames should be evolved independently, interpolated between keyframe genomes, or represented as sparse per-frame genome deltas. Do not assume array-index correspondence between genomes unless stable shape identity is explicitly designed.
- Measure both per-frame image error and temporal stability; a low image error alone can still produce distracting flicker.

**Sequence preview and export options**

- Keep the initial sequence format simple and lossless: a downloadable manifest plus genome checkpoints and original timestamps. It should be possible to reopen the project and reproduce the preview without the source video.
- Offer a rendered frame sequence (for example PNGs in a ZIP) as a dependable first export. A single video export can follow once codec and memory limits are understood.
- Evaluate `MediaRecorder` as a broad browser option and WebCodecs as a capability-gated option; report unsupported codecs and export failures in the UI.
- If an export includes audio, make the user's choice explicit and preserve it only through a local browser pipeline. Audio is not required for the first version.
- Revoke temporary object URLs and release video, canvas, and GPU resources when the user closes or replaces a project.

**Risks and open questions**

- Browser codec support, video seeking accuracy, memory use, GPU throughput, and long-running task responsiveness vary widely.
- Decide whether runs optimize selected frames only or every output frame; define behavior when a frame misses its quality target or the user cancels.
- Establish whether the output timeline follows source timestamps, a constant frame rate, or both.
- Plan recovery from tab closure, GPU/device loss, decode errors, and insufficient storage without discarding completed keyframes.
- Keep all source video, frames, and generated genomes on-device. Clearly communicate storage and export size before processing long videos.

**Suggested milestones**

1. Prototype local video loading, seeking, and a manually selected list of frames; verify that frame extraction works across supported browsers.
2. Add manual keyframes and sequential frame evolution from the previous genome, with per-frame progress, cancellation, and saved checkpoints.
3. Add suggested scene-cut/change detection and editable suggestions; test on both hard cuts and gradual motion.
4. Add temporal-stability measurements and compare independent-frame evolution against seeded evolution and any proposed regularization.
5. Add a reproducible sequence project and PNG-frame export.
6. Consider encoded video export only after memory, throughput, codec, and cancellation behavior are validated.

**Acceptance criteria**

- Video decoding and processing stay local; replacing a video releases its resources and invalidates stale work.
- Users can inspect and edit sampled/keyframe timestamps before starting and can cancel without losing completed results.
- Scene cuts can start separate keyframes; gradual changes remain available for seeded continuation.
- A saved sequence can be previewed and rendered without the original video.
- The UI reports frame progress, quality, and errors; it never reports a partial or failed sequence as complete.
- Tests on representative videos measure both per-frame fidelity and temporal flicker.

## Additional ideas

### Portable vector export

**Status: Idea**

Offer SVG as an alternative to raster PNG for polygon-based genomes. Preserve shape order and opacity, and test that the SVG rendering agrees with the app's output. SVG may be useful for editing and scaling, but browser rasterization differences mean it should be a separate, explicitly approximate export unless equivalence can be demonstrated.

### Reopenable project bundle

**Status: Idea**

Bundle a genome, working settings, target metadata, and optional user-approved target image into a versioned local project file. Make inclusion of the target image opt-in, since it is user-provided content. Validate imports and retain compatibility as the genome format evolves.

### Quality and performance presets

**Status: Idea**

Provide clear presets that trade resolution, candidate count, and shape complexity against runtime. Use measured candidates per second rather than GPU vendor assumptions, and explain when a setting may make the page less responsive.

### Accessible progress and keyboard controls

**Status: Idea**

Review the full workflow for keyboard operation, visible focus, understandable status announcements, and non-color-only status indicators. Avoid announcing every generation to assistive technology; summarize meaningful milestones instead.

## Fixes and investigation backlog

No unverified defects are recorded here. Add a fix only when it has a reproducible symptom and include affected browsers or steps, expected behavior, and a regression check. Current areas to investigate:

- **Idea:** Add focused automated checks for TOON import/export round trips and malformed-input handling while preserving the no-build, no-dependency setup.
- **Idea:** Exercise app startup, relative asset/module loading, and basic controls on the GitHub Pages repository path as well as localhost.
- **Idea:** Test interruption and cleanup paths for long GPU work, target replacement, video decoding, and export so stale operations cannot overwrite newer results.
- **Idea:** Establish representative performance and output-quality checks for low- and high-capability WebGPU devices before adding adaptive algorithms.

