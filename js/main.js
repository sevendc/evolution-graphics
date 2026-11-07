import { mutationShader, evaluationShader, finalizeShader, rasterShader, guideShader } from "./gpu/shaders.js";
import { downloadBlob, parseToonGenome, safeFilename, serializeToonGenome } from "./genome.js";
import { drawSourceCover, loadImageFile as loadTargetImage, makeSampleArtwork } from "./media.js";

let SIZE = 160;
let IMAGE_BYTES_PER_ROW = Math.ceil(SIZE * 4 / 256) * 256;
const REPORT_EVERY = 5;
const MAX_POPULATION = 2048;
const MAX_SHAPES = 512;
const MAX_VERTICES = 16;
const SHAPE_FLOATS = MAX_VERTICES * 2 + 8;
const SHAPE_BYTES = SHAPE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const SCORE_NORMALIZER = 160 * 160 * 4 * 10000;
const CANDIDATE_BATCH_SIZE = 512;
const MAX_ATLAS_PIXELS = 23 * 23 * 160 * 160;
const targetCanvas = document.querySelector("#targetCanvas");
const resultCanvas = document.querySelector("#resultCanvas");
const targetContext = targetCanvas.getContext("2d", { willReadFrequently: true });
const resultContext = resultCanvas.getContext("2d");
const imageInput = document.querySelector("#imageInput");
const resolutionSelect = document.querySelector("#resolutionSelect");
const runButton = document.querySelector("#runButton");
const resetButton = document.querySelector("#resetButton");
const notice = document.querySelector("#notice");
const gpuStatus = document.querySelector("#gpuStatus");
const gpuStatusText = document.querySelector("#gpuStatusText");
const triangleRange = document.querySelector("#triangleRange");
const mutationRange = document.querySelector("#mutationRange");
const structureRange = document.querySelector("#structureRange");
const complexityRange = document.querySelector("#complexityRange");
const populationRange = document.querySelector("#populationRange");
const decimateRange = document.querySelector("#decimateRange");
const focusRange = document.querySelector("#focusRange");
const selectionOverlay = document.querySelector("#selectionOverlay");
const selectionBox = document.querySelector("#selectionBox");
const toonText = document.querySelector("#toonText");
const toonFileInput = document.querySelector("#toonFileInput");






let adapter;
let device;
let gpu = null;
let generation = 0;
let bestError = Infinity;
let initialError = Infinity;
let running = false;
let targetLoaded = false;
let targetBitmap = null;
let sampleTarget = true;
let resolutionChanging = false;
let cameraStream = null;
let busy = false;
let lastReportTime = 0;
let lastReportGeneration = 0;
let generationTimes = [];
let candidateRates = [];
let candidateEvaluations = 0;
let lastReportCandidateEvaluations = 0;
let seed = Math.floor(Math.random() * 0xffffffff);
let selectedImageName = "sample";
let pendingGenome = null;
let focusRegion = null;
let selectionStart = null;
let selectionPointerId = null;
let draftFocusRegion = null;
let decimationBusy = false;
let decimationPreview = null;
let resumeAfterDecimation = false;

function setNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("error", isError);
}

function setGpuState(state, label) {
  gpuStatus.classList.toggle("ready", state === "ready");
  gpuStatus.classList.toggle("error", state === "error");
  gpuStatusText.textContent = label;
}

function updateControlLabels() {
  const count = Number(triangleRange.value);
  document.querySelector("#triangleValue").textContent = count;
  document.querySelector("#footerTriangleCount").textContent = count;
  updateGenomeSize(count);
  document.querySelector("#mutationValue").textContent = Number(mutationRange.value).toFixed(3);
  document.querySelector("#structureValue").textContent = `${Number(structureRange.value).toFixed(1)}%`;
  document.querySelector("#complexityValue").textContent = complexityRange.value;
  document.querySelector("#populationValue").textContent = populationRange.value;
  document.querySelector("#decimateValue").textContent = `${decimateRange.value}%`;
  document.querySelector("#focusValue").textContent = `${focusRange.value}%`;
  syncFocusControls();
  syncDecimationControls();
}

function syncDecimationControls() {
  const locked = decimationBusy || decimationPreview !== null || resolutionChanging;
  const unavailable = !gpu?.ready || !Number.isFinite(bestError);
  selectionOverlay.setAttribute("aria-disabled", String(!targetLoaded || locked));
  for (const id of ["uploadButton", "sampleButton", "toonUploadButton", "toonImportButton", "imageInput", "toonFileInput", "toonText"]) {
    const control = document.querySelector(`#${id}`);
    if (control) control.disabled = locked;
  }
  runButton.disabled = locked || !gpu?.ready;
  resetButton.disabled = locked || !gpu?.ready;
  triangleRange.disabled = locked || running;
  resolutionSelect.disabled = locked || running || !gpu?.ready;
  mutationRange.disabled = locked;
  structureRange.disabled = locked;
  complexityRange.disabled = locked;
  populationRange.disabled = locked;
  decimateRange.disabled = locked;
  document.querySelector("#decimateButton").disabled = locked || unavailable || gpu.count < 2;
  document.querySelector("#keepDecimationButton").disabled = !decimationPreview || decimationBusy;
  document.querySelector("#discardDecimationButton").disabled = !decimationPreview || decimationBusy;
  document.querySelector("#saveImageButton").disabled = locked || unavailable;
  document.querySelector("#saveDnaButton").disabled = locked || unavailable;
  syncFocusControls(locked);
}

function syncFocusControls(locked = decimationBusy || decimationPreview !== null) {
  document.querySelector("#clearFocusButton").disabled = !focusRegion || locked;
  focusRange.disabled = !focusRegion || locked;
  document.querySelector("#focusHelp").textContent = focusRegion
    ? "Focus area selected. Drag on the target to replace it, or clear it to return to global guidance."
    : "Drag a rectangle on the target image to guide mutations toward that area.";
  const region = draftFocusRegion || focusRegion;
  selectionBox.style.display = region ? "block" : "none";
  if (region) {
    selectionBox.style.left = `${region.x0 * 100}%`;
    selectionBox.style.top = `${region.y0 * 100}%`;
    selectionBox.style.width = `${(region.x1 - region.x0) * 100}%`;
    selectionBox.style.height = `${(region.y1 - region.y0) * 100}%`;
  }
}

function normalizedSelectionPoint(event) {
  const bounds = selectionOverlay.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
  };
}

function finishFocusSelection(event, keepSelection) {
  if (selectionPointerId !== event.pointerId) return;
  const point = normalizedSelectionPoint(event);
  if (keepSelection && selectionStart) {
    updateDraftFocusRegion(point);
    const region = draftFocusRegion;
    if (region.x1 - region.x0 >= 1 / SIZE && region.y1 - region.y0 >= 1 / SIZE) {
      focusRegion = region;
      setNotice("Focus area selected. Guided proposals mix high-error hotspots and random target-image samples there.");
    }
  }
  selectionStart = null;
  selectionPointerId = null;
  draftFocusRegion = null;
  syncDecimationControls();
}

function updateDraftFocusRegion(point) {
  draftFocusRegion = {
    x0: Math.min(selectionStart.x, point.x),
    y0: Math.min(selectionStart.y, point.y),
    x1: Math.max(selectionStart.x, point.x),
    y1: Math.max(selectionStart.y, point.y)
  };
  syncFocusControls();
}

function writeFocusParams(view) {
  const region = focusRegion || { x0: 0, y0: 0, x1: 1, y1: 1 };
  view.setUint32(36, focusRegion ? 1 : 0, true);
  view.setFloat32(40, Number(focusRange.value) / 100, true);
  view.setFloat32(48, region.x0, true);
  view.setFloat32(52, region.y0, true);
  view.setFloat32(56, region.x1, true);
  view.setFloat32(60, region.y1, true);
}

function updateGenomeSize(count) {
  document.querySelector("#genomeStat").textContent = `${(count * SHAPE_BYTES / 1024).toFixed(2)} KB DNA`;
}

function makeSample() {
  targetBitmap?.close();
  targetBitmap = null;
  sampleTarget = true;
  makeSampleArtwork(targetContext, SIZE);
  selectedImageName = "sample";
  targetReady().catch(reportError);
}

function setTargetBitmap(bitmap) {
  targetBitmap?.close();
  targetBitmap = bitmap;
  sampleTarget = false;
}

function getCandidateAtlasLayout() {
  const maxDimension = device.limits.maxTextureDimension2D;
  if (SIZE > maxDimension) {
    throw new Error(`The selected ${SIZE} × ${SIZE} working size is not supported by this GPU.`);
  }
  const maxColumns = Math.floor(maxDimension / SIZE);
  const maxCells = maxColumns * maxColumns;
  const pixelBudgetCells = Math.floor(MAX_ATLAS_PIXELS / (SIZE * SIZE));
  const batchSize = Math.max(1, Math.min(CANDIDATE_BATCH_SIZE, maxCells, pixelBudgetCells));
  const atlasColumns = Math.min(maxColumns, Math.ceil(Math.sqrt(batchSize)));
  const atlasRows = Math.ceil(batchSize / atlasColumns);
  return { batchSize, atlasColumns, atlasRows };
}

async function changeWorkingResolution() {
  if (!Array.from(resolutionSelect.options).some((option) => option.value === resolutionSelect.value)) {
    resolutionSelect.value = String(SIZE);
    setNotice("Choose one of the listed working image sizes.", true);
    return;
  }
  const newSize = Number(resolutionSelect.value);
  if (newSize === SIZE) return;
  resolutionChanging = true;
  setRunning(false);
  syncDecimationControls();
  try {
    await waitForEvolutionToStop();
    SIZE = newSize;
    IMAGE_BYTES_PER_ROW = Math.ceil(SIZE * 4 / 256) * 256;
    targetCanvas.width = SIZE;
    targetCanvas.height = SIZE;
    resultCanvas.width = SIZE;
    resultCanvas.height = SIZE;
    if (targetBitmap) {
      drawSourceCover(targetBitmap, targetContext, SIZE);
    } else if (sampleTarget) {
      makeSampleArtwork(targetContext, SIZE);
    } else {
      setNotice("The original target image is no longer available. Upload it again to change working size.", true);
      return;
    }
    await targetReady();
  } finally {
    resolutionChanging = false;
    syncDecimationControls();
  }
}

async function waitForEvolutionToStop() {
  while (busy) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function disposeGpu() {
  if (!gpu) return;
  gpu.targetTexture.destroy();
  gpu.outputTexture.destroy();
  gpu.candidateAtlas.destroy();
  gpu.candidateBuffer.destroy();
  gpu.bestBuffer.destroy();
  gpu.scoreBuffer.destroy();
  gpu.bestScoreBuffer.destroy();
  gpu.candidateCountsBuffer.destroy();
  gpu.bestCountBuffer.destroy();
  gpu.errorMapBuffer.destroy();
  gpu.paramsBuffer.destroy();
  gpu.scoreReadback.destroy();
  gpu.countReadback.destroy();
  gpu.imageReadback.destroy();
  gpu.dnaReadback.destroy();
  gpu.decimationScoreReadback.destroy();
  gpu = null;
}

async function targetReady() {
  setRunning(false);
  decimationPreview = null;
  decimationBusy = false;
  resumeAfterDecimation = false;
  focusRegion = null;
  draftFocusRegion = null;
  selectionStart = null;
  selectionPointerId = null;
  document.querySelector("#decimateReview").hidden = true;
  document.querySelector("#decimateSummary").textContent = "";
  targetLoaded = true;
  const count = Number(triangleRange.value);
  resultContext.clearRect(0, 0, SIZE, SIZE);
  document.querySelector("#fitnessValue").textContent = "—";
  document.querySelector("#fitnessNote").innerHTML = "Lower is closer<br>to the target";
  document.querySelector("#generationStat").textContent = "0";
  document.querySelector("#liveTriangleStat").textContent = count;
  document.querySelector("#improvementStat").textContent = "—";
  document.querySelector("#rateStat").textContent = "—";
  document.querySelector("#rateDetail").textContent = "—";
  updateGenomeSize(count);
  document.querySelector("#progressFill").style.width = "0%";
  generation = 0;
  bestError = Infinity;
  initialError = Infinity;
  generationTimes = [];
  runButton.disabled = true;
  resetButton.disabled = true;
  document.querySelector("#saveImageButton").disabled = true;
  document.querySelector("#saveDnaButton").disabled = true;
  runButton.innerHTML = "▶ &nbsp; Start evolution";
  if (gpu) gpu.ready = false;
  await waitForEvolutionToStop();
  syncDecimationControls();
  disposeGpu();
  if (device) await initializeEvolution();
  else await initializeGpu();
}

function createBuffer(size, usage) {
  return device.createBuffer({ size, usage });
}

function createPipeline(code, label) {
  const module = device.createShaderModule({ code, label });
  return device.createComputePipeline({ label, layout: "auto", compute: { module, entryPoint: "main" } });
}

function createRasterPipeline(code) {
  const module = device.createShaderModule({ code, label: "rasterize candidate shapes" });
  return device.createRenderPipeline({
    label: "rasterize candidate shapes",
    layout: "auto",
    vertex: { module, entryPoint: "vertexMain" },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{
        format: "rgba8unorm",
        blend: {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
        }
      }]
    },
    primitive: { topology: "triangle-list" }
  });
}

async function initializeGpu() {
  if (!navigator.gpu) {
    setGpuState("error", "WebGPU unavailable");
    setNotice("WebGPU is not available in this browser. Try a recent Chrome or Edge over HTTPS or localhost.", true);
    return;
  }
  setGpuState("pending", "Requesting GPU");
  adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    setGpuState("error", "No compatible GPU");
    setNotice("The browser could not find a WebGPU-compatible adapter.", true);
    return;
  }
  device = await adapter.requestDevice();
  device.lost.then((info) => {
    gpu = null;
    running = false;
    setGpuState("error", "GPU device lost");
    setNotice(`The GPU device was lost${info.message ? `: ${info.message}` : "."}`, true);
  });
  await initializeEvolution();
}

async function initializeEvolution() {
  if (!device || !targetLoaded) return;
  const count = Number(triangleRange.value);
  const population = Number(populationRange.value);
  const atlasLayout = getCandidateAtlasLayout();
  const maxGenomeBytes = MAX_SHAPES * SHAPE_BYTES;
  const candidateBytes = maxGenomeBytes * atlasLayout.batchSize;
  if (pendingGenome && pendingGenome.length !== count * SHAPE_FLOATS) {
    throw new Error("The loaded TOON genome size does not match the shape count control.");
  }
  const targetTexture = device.createTexture({
    label: "target image",
    size: [SIZE, SIZE],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });
  device.queue.copyExternalImageToTexture(
    { source: targetCanvas },
    { texture: targetTexture },
    [SIZE, SIZE]
  );
  const outputTexture = device.createTexture({
    label: "best candidate render",
    size: [SIZE, SIZE],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
  });
  const candidateAtlas = device.createTexture({
    label: "candidate render atlas",
    size: [atlasLayout.atlasColumns * SIZE, atlasLayout.atlasRows * SIZE],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
  });
  const candidateBuffer = createBuffer(candidateBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
  const bestBuffer = createBuffer(maxGenomeBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
  const scoreBuffer = createBuffer(MAX_POPULATION * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
  const bestScoreBuffer = createBuffer(4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
  const candidateCountsBuffer = createBuffer(MAX_POPULATION * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  const bestCountBuffer = createBuffer(4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
  const errorMapBuffer = createBuffer(SIZE * SIZE * 4, GPUBufferUsage.STORAGE);
  const paramsBuffer = createBuffer(64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const scoreReadback = createBuffer(4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const countReadback = createBuffer(4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const imageReadback = createBuffer(IMAGE_BYTES_PER_ROW * SIZE, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const dnaReadback = createBuffer(maxGenomeBytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const decimationScoreReadback = createBuffer(MAX_POPULATION * 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

  const mutatePipeline = createPipeline(mutationShader, "mutate genome");
  const evaluatePipeline = createPipeline(evaluationShader, "render and score candidate");
  const finalizePipeline = createPipeline(finalizeShader, "keep best genome");
  const guidePipeline = createPipeline(guideShader, "build residual error map");
  const rasterPipeline = createRasterPipeline(rasterShader);

  const mutateGroup = device.createBindGroup({
    layout: mutatePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: candidateBuffer } },
      { binding: 1, resource: { buffer: bestBuffer } },
      { binding: 2, resource: { buffer: paramsBuffer } },
      { binding: 3, resource: { buffer: bestCountBuffer } },
      { binding: 4, resource: { buffer: candidateCountsBuffer } },
      { binding: 5, resource: { buffer: errorMapBuffer } },
      { binding: 6, resource: targetTexture.createView() }
    ]
  });
  const evaluateGroup = device.createBindGroup({
    layout: evaluatePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: targetTexture.createView() },
      { binding: 1, resource: candidateAtlas.createView() },
      { binding: 2, resource: { buffer: scoreBuffer } },
      { binding: 3, resource: { buffer: paramsBuffer } }
    ]
  });
  const finalizeGroup = device.createBindGroup({
    layout: finalizePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: candidateBuffer } },
      { binding: 1, resource: { buffer: bestBuffer } },
      { binding: 2, resource: { buffer: scoreBuffer } },
      { binding: 3, resource: { buffer: bestScoreBuffer } },
      { binding: 4, resource: { buffer: paramsBuffer } },
      { binding: 5, resource: { buffer: candidateCountsBuffer } },
      { binding: 6, resource: { buffer: bestCountBuffer } }
    ]
  });
  const rasterGroup = device.createBindGroup({
    layout: rasterPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: candidateBuffer } },
      { binding: 1, resource: { buffer: candidateCountsBuffer } },
      { binding: 2, resource: { buffer: paramsBuffer } }
    ]
  });
  const bestRenderGroup = device.createBindGroup({
    layout: rasterPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: bestBuffer } },
      { binding: 1, resource: { buffer: candidateCountsBuffer } },
      { binding: 2, resource: { buffer: paramsBuffer } }
    ]
  });
  const guideGroup = device.createBindGroup({
    layout: guidePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: targetTexture.createView() },
      { binding: 1, resource: outputTexture.createView() },
      { binding: 2, resource: { buffer: errorMapBuffer } }
    ]
  });
  gpu = {
    ready: true, count, population, ...atlasLayout, genomeBytes: maxGenomeBytes, candidateBytes, targetTexture, outputTexture, candidateAtlas,
    candidateBuffer, bestBuffer, scoreBuffer, bestScoreBuffer, candidateCountsBuffer, bestCountBuffer, errorMapBuffer, paramsBuffer,
    scoreReadback, countReadback, imageReadback, dnaReadback, decimationScoreReadback,
    mutatePipeline, evaluatePipeline, finalizePipeline, guidePipeline, rasterPipeline,
    mutateGroup, evaluateGroup, finalizeGroup, guideGroup, rasterGroup, bestRenderGroup,
    hasGuidance: false,
    importedGenome: pendingGenome !== null
  };
  if (pendingGenome) device.queue.writeBuffer(bestBuffer, 0, pendingGenome);
  device.queue.writeBuffer(bestCountBuffer, 0, new Uint32Array([count]));
  device.queue.writeBuffer(bestScoreBuffer, 0, new Uint32Array([0xffffffff]));
  device.queue.writeBuffer(scoreBuffer, 0, new Uint32Array([0]));
  generation = 0;
  bestError = Infinity;
  initialError = Infinity;
  generationTimes = [];
  candidateRates = [];
  candidateEvaluations = 0;
  lastReportTime = 0;
  lastReportGeneration = 0;
  lastReportCandidateEvaluations = 0;
  resultContext.clearRect(0, 0, SIZE, SIZE);
  document.querySelector("#fitnessValue").textContent = "—";
  document.querySelector("#fitnessNote").innerHTML = "Lower is closer<br>to the target";
  document.querySelector("#generationStat").textContent = "0";
  document.querySelector("#liveTriangleStat").textContent = count;
  document.querySelector("#improvementStat").textContent = "—";
  document.querySelector("#rateStat").textContent = "—";
  document.querySelector("#rateDetail").textContent = "—";
  document.querySelector("#progressFill").style.width = "0%";
  document.querySelector("#triangleValue").textContent = String(count);
  document.querySelector("#footerTriangleCount").textContent = String(count);
  updateGenomeSize(count);
  runButton.disabled = false;
  resetButton.disabled = false;
  document.querySelector("#saveImageButton").disabled = true;
  document.querySelector("#saveDnaButton").disabled = true;
  resetButton.disabled = false;
  document.querySelector("#resolutionCaption").textContent = `${SIZE} × ${SIZE} working resolution`;
  setGpuState("ready", adapter.info?.description || "WebGPU ready");
  setNotice(pendingGenome
    ? `TOON genome loaded (${count} shapes). Start evolution to mutate and score it against the target.`
    : "Ready to evolve. The first generation starts from a random shape genome.");
  syncDecimationControls();
}

function writeParams(initial, batchStart = 0, batchCount = gpu.population) {
  const data = new ArrayBuffer(64);
  const view = new DataView(data);
  view.setUint32(0, gpu.count, true);
  view.setUint32(4, gpu.atlasColumns, true);
  view.setUint32(8, seed >>> 0, true);
  view.setUint32(12, initial, true);
  view.setFloat32(16, Number(mutationRange.value), true);
  view.setUint32(20, gpu.hasGuidance ? 1 : 0, true);
  view.setUint32(24, batchStart, true);
  view.setUint32(28, batchCount, true);
  view.setFloat32(32, Number(structureRange.value) / 100, true);
  view.setUint32(44, Number(complexityRange.value), true);
  writeFocusParams(view);
  seed = (seed + 0x6d2b79f5) >>> 0;
  device.queue.writeBuffer(gpu.paramsBuffer, 0, data);
}

async function submitGeneration() {
  const initial = generation === 0 ? (gpu.importedGenome ? 2 : 1) : 0;
  for (let batchStart = 0; batchStart < gpu.population; batchStart += gpu.batchSize) {
    const batchCount = Math.min(gpu.batchSize, gpu.population - batchStart);
    writeParams(initial, batchStart, batchCount);
    const encoder = device.createCommandEncoder({ label: `generation ${generation + 1}, candidates ${batchStart + 1}-${batchStart + batchCount}` });
    encoder.clearBuffer(gpu.scoreBuffer, batchStart * 4, batchCount * 4);

    const mutatePass = encoder.beginComputePass();
    mutatePass.setPipeline(gpu.mutatePipeline);
    mutatePass.setBindGroup(0, gpu.mutateGroup);
    mutatePass.dispatchWorkgroups(Math.ceil(MAX_SHAPES / 64), batchCount);
    mutatePass.end();

    const renderPass = encoder.beginRenderPass({
      label: "rasterize candidate batch",
      colorAttachments: [{
        view: gpu.candidateAtlas.createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 1, g: 1, b: 1, a: 1 }
      }]
    });
    renderPass.setPipeline(gpu.rasterPipeline);
    renderPass.setBindGroup(0, gpu.rasterGroup);
    for (let localIndex = 0; localIndex < batchCount; localIndex += 1) {
      const x = (localIndex % gpu.atlasColumns) * SIZE;
      const y = Math.floor(localIndex / gpu.atlasColumns) * SIZE;
      renderPass.setViewport(x, y, SIZE, SIZE, 0, 1);
      renderPass.setScissorRect(x, y, SIZE, SIZE);
      renderPass.draw(MAX_SHAPES * (MAX_VERTICES - 2) * 3, 1, 0, localIndex);
    }
    renderPass.end();

    const evaluatePass = encoder.beginComputePass();
    evaluatePass.setPipeline(gpu.evaluatePipeline);
    evaluatePass.setBindGroup(0, gpu.evaluateGroup);
    evaluatePass.dispatchWorkgroups(Math.ceil(SIZE / 8), Math.ceil(SIZE / 8), batchCount);
    evaluatePass.end();

    const finalizePass = encoder.beginComputePass();
    finalizePass.setPipeline(gpu.finalizePipeline);
    finalizePass.setBindGroup(0, gpu.finalizeGroup);
    finalizePass.dispatchWorkgroups(1);
    finalizePass.end();
    device.queue.submit([encoder.finish()]);
  }
  generation += 1;
  candidateEvaluations += gpu.population;
}

async function updatePreview() {
  device.queue.writeBuffer(gpu.candidateCountsBuffer, 0, new Uint32Array([gpu.count]));
  writeEvaluationParams(gpu.count, 1);
  const encoder = device.createCommandEncoder({ label: "preview best candidate" });
  const renderPass = encoder.beginRenderPass({
    label: "rasterize best candidate",
    colorAttachments: [{
      view: gpu.outputTexture.createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 1, g: 1, b: 1, a: 1 }
    }]
  });
  renderPass.setPipeline(gpu.rasterPipeline);
  renderPass.setBindGroup(0, gpu.bestRenderGroup);
  renderPass.setViewport(0, 0, SIZE, SIZE, 0, 1);
  renderPass.setScissorRect(0, 0, SIZE, SIZE);
  renderPass.draw(MAX_SHAPES * (MAX_VERTICES - 2) * 3, 1, 0, 0);
  renderPass.end();
  const guidePass = encoder.beginComputePass();
  guidePass.setPipeline(gpu.guidePipeline);
  guidePass.setBindGroup(0, gpu.guideGroup);
  guidePass.dispatchWorkgroups(Math.ceil(SIZE / 8), Math.ceil(SIZE / 8));
  guidePass.end();
  encoder.copyBufferToBuffer(gpu.bestScoreBuffer, 0, gpu.scoreReadback, 0, 4);
  encoder.copyBufferToBuffer(gpu.bestCountBuffer, 0, gpu.countReadback, 0, 4);
  encoder.copyTextureToBuffer(
    { texture: gpu.outputTexture },
    { buffer: gpu.imageReadback, bytesPerRow: IMAGE_BYTES_PER_ROW, rowsPerImage: SIZE },
    [SIZE, SIZE]
  );
  device.queue.submit([encoder.finish()]);
  gpu.hasGuidance = true;
  await Promise.all([
    gpu.scoreReadback.mapAsync(GPUMapMode.READ),
    gpu.countReadback.mapAsync(GPUMapMode.READ),
    gpu.imageReadback.mapAsync(GPUMapMode.READ)
  ]);
  const score = new Uint32Array(gpu.scoreReadback.getMappedRange())[0];
  const count = new Uint32Array(gpu.countReadback.getMappedRange())[0];
  const paddedImage = new Uint8Array(gpu.imageReadback.getMappedRange().slice(0));
  const image = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let row = 0; row < SIZE; row += 1) {
    image.set(paddedImage.subarray(row * IMAGE_BYTES_PER_ROW, row * IMAGE_BYTES_PER_ROW + SIZE * 4), row * SIZE * 4);
  }
  gpu.scoreReadback.unmap();
  gpu.countReadback.unmap();
  gpu.imageReadback.unmap();
  gpu.count = count;
  const mse = score / SCORE_NORMALIZER;
  if (Number.isFinite(mse)) {
    bestError = mse;
    if (!Number.isFinite(initialError)) initialError = mse;
    resultContext.putImageData(new ImageData(image, SIZE, SIZE), 0, 0);
    document.querySelector("#fitnessValue").textContent = mse.toFixed(4);
    document.querySelector("#fitnessNote").innerHTML = "1×, ½×, ¼×, ⅛× scales<br>Lower is better";
    document.querySelector("#improvementStat").textContent = `${improvementPercent().toFixed(1)}%`;
    document.querySelector("#progressFill").style.width = `${Math.max(1, Math.min(100, improvementPercent()))}%`;
    document.querySelector("#saveImageButton").disabled = false;
    document.querySelector("#saveDnaButton").disabled = false;
  }
  document.querySelector("#generationStat").textContent = generation.toLocaleString();
  document.querySelector("#liveTriangleStat").textContent = count.toLocaleString();
  triangleRange.value = String(count);
  document.querySelector("#triangleValue").textContent = String(count);
  document.querySelector("#footerTriangleCount").textContent = String(count);
  updateGenomeSize(count);
  const now = performance.now();
  if (lastReportTime > 0) {
    const generationRate = (generation - lastReportGeneration) / ((now - lastReportTime) / 1000);
    generationTimes.push(generationRate);
    if (generationTimes.length > 5) generationTimes.shift();
    const averageGenerationRate = generationTimes.reduce((a, b) => a + b, 0) / generationTimes.length;
    const candidateRate = (candidateEvaluations - lastReportCandidateEvaluations) / ((now - lastReportTime) / 1000);
    candidateRates.push(candidateRate);
    if (candidateRates.length > 5) candidateRates.shift();
    const averageCandidateRate = candidateRates.reduce((a, b) => a + b, 0) / candidateRates.length;
    document.querySelector("#rateStat").textContent = `${averageCandidateRate.toFixed(1)}/s`;
    document.querySelector("#rateDetail").textContent = `${averageGenerationRate.toFixed(1)} generations/s`;
  }
  lastReportTime = now;
  lastReportGeneration = generation;
  lastReportCandidateEvaluations = candidateEvaluations;
  syncDecimationControls();
}

async function readBestGenome() {
  const byteLength = gpu.count * SHAPE_BYTES;
  const encoder = device.createCommandEncoder({ label: "copy best genome for simplification" });
  encoder.copyBufferToBuffer(gpu.bestBuffer, 0, gpu.dnaReadback, 0, byteLength);
  device.queue.submit([encoder.finish()]);
  await gpu.dnaReadback.mapAsync(GPUMapMode.READ, 0, byteLength);
  const genome = new Float32Array(gpu.dnaReadback.getMappedRange(0, byteLength).slice(0));
  gpu.dnaReadback.unmap();
  return genome;
}

function writeEvaluationParams(count, candidateCount, batchStart = 0) {
  const data = new ArrayBuffer(64);
  const view = new DataView(data);
  view.setUint32(0, count, true);
  view.setUint32(4, gpu.atlasColumns, true);
  view.setUint32(24, batchStart, true);
  view.setUint32(28, candidateCount, true);
  view.setUint32(44, Number(complexityRange.value), true);
  writeFocusParams(view);
  device.queue.writeBuffer(gpu.paramsBuffer, 0, data);
}

function submitDecimationEvaluation(candidateCount, triangleCount, readbackBuffer, includePreview = false, candidateGenomes = null) {
  const candidateCounts = new Uint32Array(candidateCount);
  candidateCounts.fill(triangleCount);
  device.queue.writeBuffer(gpu.candidateCountsBuffer, 0, candidateCounts);
  for (let batchStart = 0; batchStart < candidateCount; batchStart += gpu.batchSize) {
    const batchCount = Math.min(gpu.batchSize, candidateCount - batchStart);
    if (candidateGenomes) {
      const start = batchStart * MAX_SHAPES * SHAPE_FLOATS;
      const end = (batchStart + batchCount) * MAX_SHAPES * SHAPE_FLOATS;
      device.queue.writeBuffer(gpu.candidateBuffer, 0, candidateGenomes.subarray(start, end));
    }
    writeEvaluationParams(triangleCount, batchCount, batchStart);

    const encoder = device.createCommandEncoder({ label: "score simplified genome candidates" });
    encoder.clearBuffer(gpu.scoreBuffer, batchStart * 4, batchCount * 4);
    const renderPass = encoder.beginRenderPass({
      label: "rasterize simplification candidates",
      colorAttachments: [{
        view: gpu.candidateAtlas.createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 1, g: 1, b: 1, a: 1 }
      }]
    });
    renderPass.setPipeline(gpu.rasterPipeline);
    renderPass.setBindGroup(0, gpu.rasterGroup);
    for (let localIndex = 0; localIndex < batchCount; localIndex += 1) {
      const x = (localIndex % gpu.atlasColumns) * SIZE;
      const y = Math.floor(localIndex / gpu.atlasColumns) * SIZE;
      renderPass.setViewport(x, y, SIZE, SIZE, 0, 1);
      renderPass.setScissorRect(x, y, SIZE, SIZE);
      renderPass.draw(MAX_SHAPES * (MAX_VERTICES - 2) * 3, 1, 0, localIndex);
    }
    renderPass.end();

    const evaluatePass = encoder.beginComputePass({ label: "score simplification candidates" });
    evaluatePass.setPipeline(gpu.evaluatePipeline);
    evaluatePass.setBindGroup(0, gpu.evaluateGroup);
    evaluatePass.dispatchWorkgroups(Math.ceil(SIZE / 8), Math.ceil(SIZE / 8), batchCount);
    evaluatePass.end();
    encoder.copyBufferToBuffer(gpu.scoreBuffer, batchStart * 4, readbackBuffer, batchStart * 4, batchCount * 4);
    if (includePreview) {
      encoder.copyTextureToBuffer(
        { texture: gpu.candidateAtlas },
        { buffer: gpu.imageReadback, bytesPerRow: IMAGE_BYTES_PER_ROW, rowsPerImage: SIZE },
        [SIZE, SIZE]
      );
    }
    device.queue.submit([encoder.finish()]);
  }
}

async function mapDecimationImage() {
  const paddedImage = new Uint8Array(gpu.imageReadback.getMappedRange().slice(0));
  const image = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let row = 0; row < SIZE; row += 1) {
    image.set(paddedImage.subarray(row * IMAGE_BYTES_PER_ROW, row * IMAGE_BYTES_PER_ROW + SIZE * 4), row * SIZE * 4);
  }
  return image;
}

async function simplifyGenome() {
  if (!gpu?.ready || !Number.isFinite(bestError) || gpu.count < 2 || decimationBusy || decimationPreview) return;
  resumeAfterDecimation = running;
  setRunning(false);
  decimationBusy = true;
  document.querySelector("#decimateSummary").textContent = "Pausing evolution and analyzing shape impact…";
  syncDecimationControls();
  try {
    await waitForEvolutionToStop();
    if (!gpu?.ready) throw new Error("The GPU is not ready to simplify the current genome.");

    const originalCount = gpu.count;
    const originalError = bestError;
    const genome = await readBestGenome();
    const floatsPerCandidate = MAX_SHAPES * SHAPE_FLOATS;
    const variants = new Float32Array(originalCount * floatsPerCandidate);
    for (let removedIndex = 0; removedIndex < originalCount; removedIndex += 1) {
      const offset = removedIndex * floatsPerCandidate;
      variants.set(genome.subarray(0, removedIndex * SHAPE_FLOATS), offset);
      variants.set(genome.subarray((removedIndex + 1) * SHAPE_FLOATS), offset + removedIndex * SHAPE_FLOATS);
    }

    document.querySelector("#decimateSummary").textContent = `Scoring ${originalCount} leave-one-shape-out variants…`;
    submitDecimationEvaluation(
      originalCount,
      originalCount - 1,
      gpu.decimationScoreReadback,
      false,
      variants
    );
    await gpu.decimationScoreReadback.mapAsync(GPUMapMode.READ);
    const scores = new Uint32Array(gpu.decimationScoreReadback.getMappedRange(0, originalCount * 4).slice(0));
    gpu.decimationScoreReadback.unmap();

    const requestedRemovalCount = Math.min(
      originalCount - 1,
      Math.max(1, Math.round(originalCount * Number(decimateRange.value) / 100))
    );
    const ranked = Array.from(scores, (score, index) => ({ score, index }));
    ranked.sort((a, b) => a.score - b.score);
    const removed = new Set(ranked.slice(0, requestedRemovalCount).map(({ index }) => index));
    const simplified = new Float32Array((originalCount - removed.size) * SHAPE_FLOATS);
    let destination = 0;
    for (let index = 0; index < originalCount; index += 1) {
      if (removed.has(index)) continue;
      simplified.set(genome.subarray(index * SHAPE_FLOATS, index * SHAPE_FLOATS + SHAPE_FLOATS), destination);
      destination += SHAPE_FLOATS;
    }

    device.queue.writeBuffer(gpu.candidateBuffer, 0, simplified);
    submitDecimationEvaluation(1, simplified.length / SHAPE_FLOATS, gpu.scoreReadback, true);
    await Promise.all([
      gpu.scoreReadback.mapAsync(GPUMapMode.READ),
      gpu.imageReadback.mapAsync(GPUMapMode.READ)
    ]);
    const simplifiedScore = new Uint32Array(gpu.scoreReadback.getMappedRange(0, 4))[0];
    const image = await mapDecimationImage();
    gpu.scoreReadback.unmap();
    gpu.imageReadback.unmap();
    const simplifiedError = simplifiedScore / SCORE_NORMALIZER;

    decimationPreview = {
      genome: simplified,
      count: simplified.length / SHAPE_FLOATS,
      score: simplifiedScore,
      error: simplifiedError,
      originalError
    };
    resultContext.putImageData(new ImageData(image, SIZE, SIZE), 0, 0);
    document.querySelector("#fitnessValue").textContent = simplifiedError.toFixed(4);
    document.querySelector("#fitnessNote").textContent = "Simplification preview; lower is better";
    document.querySelector("#improvementStat").textContent = "—";
    document.querySelector("#liveTriangleStat").textContent = String(decimationPreview.count);
    document.querySelector("#triangleValue").textContent = String(decimationPreview.count);
    document.querySelector("#footerTriangleCount").textContent = String(decimationPreview.count);
    triangleRange.value = String(decimationPreview.count);
    updateGenomeSize(decimationPreview.count);
    const fitnessChange = originalError > 0
      ? ((simplifiedError - originalError) / originalError) * 100
      : (simplifiedError === 0 ? 0 : Infinity);
    const changeLabel = Number.isFinite(fitnessChange) ? `${fitnessChange >= 0 ? "+" : ""}${fitnessChange.toFixed(1)}%` : "increased";
    document.querySelector("#decimateSummary").textContent =
      `Preview: ${originalCount} → ${decimationPreview.count} shapes (${removed.size} removed). ` +
      `Error: ${originalError.toFixed(4)} → ${simplifiedError.toFixed(4)} (${changeLabel}).`;
    document.querySelector("#decimateReview").hidden = false;
    syncDecimationControls();
    setNotice("Review the simplified image. Keep it to continue evolving from this genome, or discard it to restore the previous result.");
  } catch (error) {
    console.error(error);
    document.querySelector("#decimateSummary").textContent = "Simplification could not be completed; the current genome was not changed.";
    setNotice(`Could not simplify the genome: ${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    decimationBusy = false;
    syncDecimationControls();
    if (!decimationPreview) resumeEvolutionAfterDecimation();
  }
}

function resumeEvolutionAfterDecimation() {
  const shouldResume = resumeAfterDecimation;
  resumeAfterDecimation = false;
  if (shouldResume) setRunning(true);
}

function keepSimplification() {
  if (!decimationPreview || decimationBusy || !gpu?.ready) return;
  const preview = decimationPreview;
  try {
    device.queue.writeBuffer(gpu.bestBuffer, 0, preview.genome);
    device.queue.writeBuffer(gpu.bestCountBuffer, 0, new Uint32Array([preview.count]));
    device.queue.writeBuffer(gpu.bestScoreBuffer, 0, new Uint32Array([preview.score]));
  } catch (error) {
    console.error(error);
    setNotice(`Could not keep the simplified genome: ${error instanceof Error ? error.message : String(error)}`, true);
    return;
  }
  gpu.count = preview.count;
  gpu.importedGenome = true;
  gpu.hasGuidance = false;
  pendingGenome = preview.genome.slice();
  generation = 0;
  bestError = preview.error;
  initialError = preview.error;
  generationTimes = [];
  candidateRates = [];
  candidateEvaluations = 0;
  lastReportTime = 0;
  lastReportGeneration = 0;
  lastReportCandidateEvaluations = 0;
  document.querySelector("#generationStat").textContent = "0";
  document.querySelector("#improvementStat").textContent = "0.0%";
  document.querySelector("#progressFill").style.width = "0%";
  document.querySelector("#fitnessValue").textContent = preview.error.toFixed(4);
  document.querySelector("#fitnessNote").textContent = "Fitness after simplification";
  document.querySelector("#liveTriangleStat").textContent = String(preview.count);
  document.querySelector("#triangleValue").textContent = String(preview.count);
  document.querySelector("#footerTriangleCount").textContent = String(preview.count);
  triangleRange.value = String(preview.count);
  updateGenomeSize(preview.count);
  decimationPreview = null;
  document.querySelector("#decimateReview").hidden = true;
  document.querySelector("#decimateSummary").textContent = `Kept the simplified genome with ${preview.count} shapes.`;
  syncDecimationControls();
  setNotice("Simplified genome kept. Evolution will continue from it when started.");
  resumeEvolutionAfterDecimation();
}

async function discardSimplification() {
  if (!decimationPreview || decimationBusy || !gpu?.ready) return;
  decimationBusy = true;
  syncDecimationControls();
  try {
    await updatePreview();
    decimationPreview = null;
    document.querySelector("#decimateReview").hidden = true;
    document.querySelector("#decimateSummary").textContent = "Simplification discarded; the previous genome is restored.";
    setNotice("The original genome and image have been restored.");
  } catch (error) {
    console.error(error);
    setNotice(`Could not restore the previous preview: ${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    decimationBusy = false;
    syncDecimationControls();
    if (!decimationPreview) resumeEvolutionAfterDecimation();
  }
}

function improvementPercent() {
  if (!Number.isFinite(bestError) || !Number.isFinite(initialError) || initialError === 0) return 0;
  return Math.max(0, (1 - bestError / initialError) * 100);
}

async function evolve() {
  if (busy || !running || !gpu?.ready) return;
  busy = true;
  try {
    while (running && gpu?.ready) {
      for (let i = 0; i < REPORT_EVERY && running; i += 1) {
        await submitGeneration();
      }
      if (!running) break;
      await updatePreview();
    }
    if (gpu?.ready && generation !== lastReportGeneration) await updatePreview();
  } catch (error) {
    running = false;
    runButton.innerHTML = "▶ &nbsp; Start evolution";
    reportError(error);
  } finally {
    busy = false;
  }
}

function setRunning(value) {
  if (decimationBusy || decimationPreview) return;
  running = value;
  runButton.innerHTML = value ? "Ⅱ &nbsp; Pause evolution" : "▶ &nbsp; Start evolution";
  syncDecimationControls();
  if (value) evolve();
}

async function resetEvolution() {
  if (decimationBusy || decimationPreview) return;
  setRunning(false);
  await waitForEvolutionToStop();
  if (gpu?.importedGenome && pendingGenome && pendingGenome.length !== gpu.count * SHAPE_FLOATS) {
    pendingGenome = await readBestGenome();
  }
  if (gpu) gpu.ready = false;
  disposeGpu();
  if (targetLoaded && device) await initializeEvolution();
  else if (targetLoaded) await initializeGpu();
}

async function saveDna() {
  if (!gpu?.ready) return;
  try {
    const encoder = device.createCommandEncoder({ label: "copy best genome for export" });
    encoder.copyBufferToBuffer(gpu.bestBuffer, 0, gpu.dnaReadback, 0, gpu.genomeBytes);
    device.queue.submit([encoder.finish()]);
    await gpu.dnaReadback.mapAsync(GPUMapMode.READ);
    const raw = new Float32Array(gpu.dnaReadback.getMappedRange().slice(0));
    gpu.dnaReadback.unmap();
    const toon = serializeToonGenome(raw, gpu.count, SIZE, bestError);
    downloadBlob(
      new Blob([toon], { type: "text/plain;charset=utf-8" }),
      `${safeFilename(selectedImageName)}-genome.toon`
    );
  } catch (error) {
    reportError(error);
  }
}

async function importToonGenome(text) {
  try {
    const imported = parseToonGenome(text, Number(triangleRange.min), Number(triangleRange.max));
    complexityRange.value = String(Math.max(Number(complexityRange.value), imported.maxVertices));
    setRunning(false);
    triangleRange.step = "1";
    triangleRange.value = String(imported.count);
    pendingGenome = imported.genome;
    updateControlLabels();
    if (targetLoaded) {
      await resetEvolution();
    } else {
      setNotice(`TOON genome loaded (${imported.count} shapes). Choose a target image to begin evolution.`);
    }
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error), true);
  }
}

async function loadToonFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    toonText.value = text;
    await importToonGenome(text);
  } catch (error) {
    setNotice(`Could not read the TOON file: ${error.message}`, true);
  }
}

function reportError(error) {
  console.error(error);
  setGpuState("error", "Initialization error");
  setNotice(error instanceof Error ? error.message : String(error), true);
  runButton.disabled = true;
}

function stopCamera() {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  const video = document.querySelector("#cameraVideo");
  if (video) {
    video.pause();
    video.srcObject = null;
    video.classList.remove("active");
  }
  const captureButton = document.querySelector("#captureButton");
  if (captureButton) captureButton.classList.remove("active");
  const cameraButton = document.querySelector("#cameraButton");
  if (cameraButton) cameraButton.textContent = "◎  Use camera";
}

async function toggleCamera() {
  if (cameraStream) {
    stopCamera();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setNotice("Camera capture is not available here. Use HTTPS or localhost, or upload an image.", true);
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    const video = document.querySelector("#cameraVideo");
    if (!video) return;
    video.srcObject = cameraStream;
    await video.play();
    video.classList.add("active");
    const captureButton = document.querySelector("#captureButton");
    if (captureButton) captureButton.classList.add("active");
    const cameraButton = document.querySelector("#cameraButton");
    if (cameraButton) cameraButton.textContent = "×  Stop camera";
    setNotice("Camera is ready. Capture a frame to use it as the target.");
  } catch (error) {
    setNotice(`Could not access the camera: ${error.message}`, true);
  }
}

document.querySelector("#uploadButton").addEventListener("click", () => imageInput.click());
imageInput.addEventListener("change", (event) => loadTargetImage(event.target.files[0], {
  context: targetContext,
  size: SIZE,
  setImageName: (name) => { selectedImageName = name; },
  setImageSource: setTargetBitmap,
  stopCamera,
  targetReady,
  setNotice,
  reportError
}));
document.querySelector("#sampleButton").addEventListener("click", makeSample);
resolutionSelect.addEventListener("change", () => changeWorkingResolution().catch(reportError));
document.querySelector("#toonUploadButton").addEventListener("click", () => toonFileInput.click());
toonFileInput.addEventListener("change", (event) => loadToonFile(event.target.files[0]));
document.querySelector("#toonImportButton").addEventListener("click", () => importToonGenome(toonText.value));
const cameraButton = document.querySelector("#cameraButton");
const captureButton = document.querySelector("#captureButton");
if (cameraButton) {
  cameraButton.addEventListener("click", toggleCamera);
}
if (captureButton) {
  captureButton.addEventListener("click", async () => {
    const video = document.querySelector("#cameraVideo");
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      setNotice("Wait for the camera preview to become available, then capture again.", true);
      return;
    }
    drawSourceCover(video, targetContext, SIZE);
    selectedImageName = "camera-capture";
    stopCamera();
    await targetReady().catch(reportError);
  });
}
selectionOverlay.addEventListener("pointerdown", (event) => {
  if (!targetLoaded || decimationBusy || decimationPreview || event.button !== 0) return;
  event.preventDefault();
  selectionPointerId = event.pointerId;
  selectionStart = normalizedSelectionPoint(event);
  updateDraftFocusRegion(selectionStart);
  selectionOverlay.setPointerCapture(event.pointerId);
});
selectionOverlay.addEventListener("pointermove", (event) => {
  if (selectionPointerId === event.pointerId && selectionStart) {
    updateDraftFocusRegion(normalizedSelectionPoint(event));
  }
});
selectionOverlay.addEventListener("pointerup", (event) => finishFocusSelection(event, true));
selectionOverlay.addEventListener("pointercancel", (event) => finishFocusSelection(event, false));
document.querySelector("#clearFocusButton").addEventListener("click", () => {
  focusRegion = null;
  draftFocusRegion = null;
  syncDecimationControls();
  setNotice("Focus area cleared. Guided mutations will sample across the whole image.");
});
runButton.addEventListener("click", () => setRunning(!running));
resetButton.addEventListener("click", resetEvolution);
triangleRange.addEventListener("input", updateControlLabels);
triangleRange.addEventListener("change", () => {
  if (!targetLoaded) return;
  if (pendingGenome && pendingGenome.length !== Number(triangleRange.value) * SHAPE_FLOATS) {
    pendingGenome = null;
    setNotice("Shape count changed; the imported TOON genome was cleared. Evolution will restart with a random genome.");
  }
  resetEvolution().catch(reportError);
});
populationRange.addEventListener("input", updateControlLabels);
populationRange.addEventListener("input", () => {
  if (gpu?.ready) gpu.population = Number(populationRange.value);
});
mutationRange.addEventListener("input", updateControlLabels);
structureRange.addEventListener("input", updateControlLabels);
complexityRange.addEventListener("input", updateControlLabels);
decimateRange.addEventListener("input", updateControlLabels);
focusRange.addEventListener("input", () => {
  document.querySelector("#focusValue").textContent = `${focusRange.value}%`;
});
document.querySelector("#decimateButton").addEventListener("click", simplifyGenome);
document.querySelector("#keepDecimationButton").addEventListener("click", keepSimplification);
document.querySelector("#discardDecimationButton").addEventListener("click", discardSimplification);
document.querySelector("#saveImageButton").addEventListener("click", () => {
  resultCanvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `${safeFilename(selectedImageName)}-evolved.png`);
  }, "image/png");
});
document.querySelector("#saveDnaButton").addEventListener("click", saveDna);
window.addEventListener("pagehide", () => targetBitmap?.close(), { once: true });

updateControlLabels();
if (navigator.gpu) {
  setGpuState("pending", "WebGPU available");
  setNotice("WebGPU is available. Load an image or try the sample artwork to begin.");
} else {
  setGpuState("error", "WebGPU unavailable");
  setNotice("WebGPU is required. Try a recent Chrome or Edge on HTTPS or localhost.", true);
}
makeSample();
  