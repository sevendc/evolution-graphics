export function bindApplicationEvents(controls, actions) {
  controls.uploadButton.addEventListener("click", () => controls.imageInput.click());
  controls.imageInput.addEventListener("change", (event) => actions.uploadImage(event.target.files[0]));
  controls.sampleButton.addEventListener("click", actions.makeSample);
  controls.resolutionSelect.addEventListener("change", actions.changeWorkingResolution);
  controls.toonUploadButton.addEventListener("click", () => controls.toonFileInput.click());
  controls.toonFileInput.addEventListener("change", (event) => actions.loadToonFile(event.target.files[0]));
  controls.toonImportButton.addEventListener("click", () => actions.importToonGenome(controls.toonText.value));

  if (controls.cameraButton) controls.cameraButton.addEventListener("click", actions.toggleCamera);
  if (controls.captureButton) controls.captureButton.addEventListener("click", actions.captureCamera);
  controls.clearFocusButton.addEventListener("click", actions.clearFocus);
  controls.autoModeButton.addEventListener("click", actions.toggleAutoMode);
  controls.runButton.addEventListener("click", actions.toggleEvolution);
  controls.resetButton.addEventListener("click", actions.resetEvolution);
  controls.triangleRange.addEventListener("input", actions.updateControlLabels);
  controls.triangleRange.addEventListener("change", actions.changeTriangleCount);
  controls.populationRange.addEventListener("input", actions.updateControlLabels);
  controls.populationRange.addEventListener("input", actions.changePopulation);
  controls.mutationRange.addEventListener("input", actions.updateControlLabels);
  controls.structureRange.addEventListener("input", actions.updateControlLabels);
  controls.complexityRange.addEventListener("input", actions.updateControlLabels);
  controls.decimateRange.addEventListener("input", actions.updateControlLabels);
  controls.focusRange.addEventListener("input", actions.changeFocusStrength);
  controls.decimateButton.addEventListener("click", actions.simplifyGenome);
  controls.keepDecimationButton.addEventListener("click", actions.keepSimplification);
  controls.discardDecimationButton.addEventListener("click", actions.discardSimplification);
  controls.saveImageButton.addEventListener("click", actions.saveImage);
  controls.saveDnaButton.addEventListener("click", actions.saveDna);
  window.addEventListener("pagehide", actions.onPageHide, { once: true });
}
