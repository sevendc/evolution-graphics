const VARIABLE_UPDATE_INTERVAL = 100;
const COMPLEXITY_STAGE_GENERATIONS = 1000;
const MUTATION_RAMP_GENERATIONS = 4000;
const POPULATION_LIMIT = 512;
const POPULATION_STEP = 32;

export function createAutoModeScheduler({ getState, updateControlLabels, reportEvery }) {
  let populationBest = null;
  let populationTrial = null;
  let populationNextTrial = 200;
  let frameHandle = null;
  let frameLastTime = 0;
  let frameSamples = [];

  function sampleFrame(time) {
    if (!getState().autoMode) {
      frameHandle = null;
      return;
    }
    if (document.visibilityState === "visible" && frameLastTime > 0) {
      const interval = time - frameLastTime;
      if (interval > 0 && interval < 1000) {
        frameSamples.push({ time, interval });
        if (frameSamples.length > 120) frameSamples.shift();
      }
    }
    frameLastTime = time;
    frameHandle = requestAnimationFrame(sampleFrame);
  }

  function medianFrameInterval(afterTime = 0) {
    const intervals = frameSamples
      .filter((sample) => sample.time >= afterTime)
      .map((sample) => sample.interval)
      .sort((a, b) => a - b);
    if (intervals.length < 15) return null;
    return intervals[Math.floor(intervals.length / 2)];
  }

  function tunePopulation() {
    let state = getState();
    if (!state.autoMode || state.autoGenerations < populationNextTrial) return;
    const recentRates = state.candidateRates.slice(-5);
    if (recentRates.length < 3) {
      populationNextTrial = state.autoGenerations + reportEvery * 5;
      return;
    }
    const measuredRate = recentRates.reduce((sum, rate) => sum + rate, 0) / recentRates.length;

    if (populationTrial) {
      const frameInterval = medianFrameInterval(populationTrial.startedAt);
      const responsive = frameInterval !== null
        && frameInterval <= Math.max(50, populationTrial.baselineFrameInterval * 1.25);
      if (responsive && measuredRate >= populationTrial.baselineRate * 1.05) {
        populationBest = {
          population: populationTrial.population,
          rate: measuredRate
        };
      } else {
        state.gpu.population = populationBest.population;
        state.populationRange.value = String(state.gpu.population);
        populationTrial = null;
        populationNextTrial = Infinity;
        updateControlLabels();
        return;
      }
      populationTrial = null;
    } else if (!populationBest) {
      populationBest = { population: state.gpu.population, rate: measuredRate };
    }

    if (populationBest.population >= POPULATION_LIMIT) {
      populationNextTrial = Infinity;
      return;
    }

    const baselineFrameInterval = medianFrameInterval();
    if (baselineFrameInterval === null || baselineFrameInterval > 50 || document.visibilityState !== "visible") {
      populationNextTrial = document.visibilityState === "visible"
        ? state.autoGenerations + 200
        : Infinity;
      return;
    }
    const trialPopulation = Math.min(POPULATION_LIMIT, populationBest.population + POPULATION_STEP);
    populationTrial = {
      population: trialPopulation,
      baselineRate: populationBest.rate,
      baselineFrameInterval,
      startedAt: performance.now()
    };
    state.gpu.population = trialPopulation;
    state.populationRange.value = String(trialPopulation);
    populationNextTrial = state.autoGenerations + 200;
    updateControlLabels();
  }

  function update() {
    let state = getState();
    if (!state.autoMode || !state.gpu?.ready) return;
    const scheduleGeneration = Math.floor(state.autoGenerations / VARIABLE_UPDATE_INTERVAL) * VARIABLE_UPDATE_INTERVAL;
    const progress = Math.min(1, scheduleGeneration / MUTATION_RAMP_GENERATIONS);
    const mutation = 0.65 - (0.65 - 0.08) * progress;
    const complexitySteps = [6, 8, 10, 13, 16];
    const phase = Math.min(
      complexitySteps.length - 1,
      Math.floor(scheduleGeneration / COMPLEXITY_STAGE_GENERATIONS)
    );
    state.mutationRange.value = mutation.toFixed(3);
    state.complexityRange.value = String(complexitySteps[phase]);
    updateControlLabels();
    tunePopulation();

    state = getState();
    const phaseName = scheduleGeneration < COMPLEXITY_STAGE_GENERATIONS
      ? "coarse search"
      : scheduleGeneration < MUTATION_RAMP_GENERATIONS
        ? "detail refinement"
        : "fine refinement";
    const focusStatus = state.focus.region
      ? `Focus active: ${state.focus.generationsRemaining} generations`
      : "Global search";
    const populationStatus = populationTrial
      ? `testing ${populationTrial.population} candidates/generation`
      : `${state.gpu.population} candidates/generation`;
    state.autoModeStatus.textContent =
      `Auto mode: ${phaseName} | generation ${state.autoGenerations.toLocaleString()} | ` +
      `${state.gpu.count} shapes | mutation ${Number(state.mutationRange.value).toFixed(3)} | ` +
      `${state.complexityRange.value} points | ${populationStatus} | ${focusStatus}`;
  }

  return {
    startSampling() {
      frameLastTime = 0;
      frameSamples = [];
      frameHandle = requestAnimationFrame(sampleFrame);
    },
    stopSampling() {
      if (frameHandle !== null) cancelAnimationFrame(frameHandle);
      frameHandle = null;
      frameLastTime = 0;
      frameSamples = [];
    },
    reset() {
      populationBest = null;
      populationTrial = null;
      populationNextTrial = 200;
    },
    update
  };
}
