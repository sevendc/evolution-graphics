export const FOCUS_DURATION_GENERATIONS = 1500;
export const AUTO_FOCUS_FIRST_GENERATION = 4000;
export const AUTO_FOCUS_INTERVAL = 3000;
export const AUTO_FOCUS_DURATION = 25;

export function createFocusController({
  overlay,
  getSize,
  getTargetContext,
  getFocusStrength,
  canSelect,
  onChange,
  onControlsChange,
  onNotice
}) {
  let region = null;
  let generationsRemaining = 0;
  let selectionStart = null;
  let selectionPointerId = null;
  let draftRegion = null;
  let nextAutoFocusGeneration = AUTO_FOCUS_FIRST_GENERATION;

  function normalizedPoint(event) {
    const bounds = overlay.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
    };
  }

  function updateDraft(point) {
    draftRegion = {
      x0: Math.min(selectionStart.x, point.x),
      y0: Math.min(selectionStart.y, point.y),
      x1: Math.max(selectionStart.x, point.x),
      y1: Math.max(selectionStart.y, point.y)
    };
    onControlsChange();
  }

  function finishSelection(event, keepSelection) {
    if (selectionPointerId !== event.pointerId) return;
    const point = normalizedPoint(event);
    if (keepSelection && selectionStart) {
      updateDraft(point);
      if (draftRegion.x1 - draftRegion.x0 >= 1 / getSize()
          && draftRegion.y1 - draftRegion.y0 >= 1 / getSize()) {
        region = draftRegion;
        generationsRemaining = FOCUS_DURATION_GENERATIONS;
        onNotice(`Focus area selected. Guided proposals will use it for up to ${FOCUS_DURATION_GENERATIONS} generations.`);
      }
    }
    selectionStart = null;
    selectionPointerId = null;
    draftRegion = null;
    onChange();
  }

  function activateAutoFocus(errorMap) {
    const size = getSize();
    const cells = 8;
    const cellErrors = new Float64Array(cells * cells);
    const cellComplexity = new Float64Array(cells * cells);
    const targetPixels = getTargetContext().getImageData(0, 0, size, size).data;
    const luminance = (offset) => (
      targetPixels[offset] * 0.2126 +
      targetPixels[offset + 1] * 0.7152 +
      targetPixels[offset + 2] * 0.0722
    ) / 255;

    for (let cellY = 0; cellY < cells; cellY += 1) {
      const y0 = Math.floor(cellY * size / cells);
      const y1 = Math.floor((cellY + 1) * size / cells);
      for (let cellX = 0; cellX < cells; cellX += 1) {
        const x0 = Math.floor(cellX * size / cells);
        const x1 = Math.floor((cellX + 1) * size / cells);
        let total = 0;
        let detail = 0;
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const pixelIndex = y * size + x;
            total += errorMap[pixelIndex];
            const current = luminance(pixelIndex * 4);
            if (x + 1 < size) detail += Math.abs(current - luminance((pixelIndex + 1) * 4));
            if (y + 1 < size) detail += Math.abs(current - luminance((pixelIndex + size) * 4));
          }
        }
        const cellIndex = cellY * cells + cellX;
        const cellArea = (x1 - x0) * (y1 - y0);
        cellErrors[cellIndex] = total / cellArea;
        cellComplexity[cellIndex] = detail / (cellArea * 2);
      }
    }

    let bestX = 0;
    let bestY = 0;
    let bestScore = -Infinity;
    let bestComplexity = 0;
    for (let cellY = 0; cellY < cells; cellY += 1) {
      for (let cellX = 0; cellX < cells; cellX += 1) {
        const cellIndex = cellY * cells + cellX;
        const complexity = cellComplexity[cellIndex];
        const score = cellErrors[cellIndex] * (0.1 + complexity * 4);
        if (score > bestScore) {
          bestScore = score;
          bestComplexity = complexity;
          bestX = cellX;
          bestY = cellY;
        }
      }
    }

    nextAutoFocusGeneration += AUTO_FOCUS_INTERVAL;
    if (bestComplexity < 0.02) return;
    region = {
      x0: bestX / cells,
      y0: bestY / cells,
      x1: (bestX + 1) / cells,
      y1: (bestY + 1) / cells
    };
    generationsRemaining = AUTO_FOCUS_DURATION;
    onChange();
    onNotice(`Auto focus is guiding mutations toward a detailed, high-error image region for ${AUTO_FOCUS_DURATION} generations.`);
  }

  overlay.addEventListener("pointerdown", (event) => {
    if (!canSelect() || event.button !== 0) return;
    event.preventDefault();
    selectionPointerId = event.pointerId;
    selectionStart = normalizedPoint(event);
    updateDraft(selectionStart);
    overlay.setPointerCapture(event.pointerId);
  });
  overlay.addEventListener("pointermove", (event) => {
    if (selectionPointerId === event.pointerId && selectionStart) {
      updateDraft(normalizedPoint(event));
    }
  });
  overlay.addEventListener("pointerup", (event) => finishSelection(event, true));
  overlay.addEventListener("pointercancel", (event) => finishSelection(event, false));

  return {
    get region() { return region; },
    set region(value) {
      region = value;
      onControlsChange();
    },
    get generationsRemaining() { return generationsRemaining; },
    set generationsRemaining(value) { generationsRemaining = value; },
    get draftRegion() { return draftRegion; },
    get nextAutoFocusGeneration() { return nextAutoFocusGeneration; },
    reset() {
      region = null;
      generationsRemaining = 0;
      selectionStart = null;
      selectionPointerId = null;
      draftRegion = null;
      onChange();
    },
    clear() {
      this.reset();
    },
    tick() {
      if (!region) return false;
      generationsRemaining -= 1;
      if (generationsRemaining > 0) return false;
      region = null;
      generationsRemaining = 0;
      onChange();
      return true;
    },
    resetAutoFocusSchedule() {
      nextAutoFocusGeneration = AUTO_FOCUS_FIRST_GENERATION;
    },
    shouldCaptureAutoFocus(autoMode, autoGenerations) {
      return autoMode && autoGenerations >= nextAutoFocusGeneration;
    },
    activateAutoFocus,
    writeParams(view) {
      const focusRegion = region || { x0: 0, y0: 0, x1: 1, y1: 1 };
      view.setUint32(36, region ? 1 : 0, true);
      view.setFloat32(40, getFocusStrength(), true);
      view.setFloat32(48, focusRegion.x0, true);
      view.setFloat32(52, focusRegion.y0, true);
      view.setFloat32(56, focusRegion.x1, true);
      view.setFloat32(60, focusRegion.y1, true);
    }
  };
}
