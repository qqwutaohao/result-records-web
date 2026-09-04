((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.K3ModelCore = api;
})(typeof globalThis === "undefined" ? this : globalThis, () => {
  "use strict";

  const DEFAULT_ODDS = 1.96;
  const BREAK_EVEN_PROBABILITY = 1 / DEFAULT_ODDS;
  const FAIR_SIZE_WIN_PROBABILITY = 35 / 72;
  const FAIR_PARITY_WIN_PROBABILITY = 0.5;
  const DIRECTION_MIXTURE_POINTS = 48;
  const BRIER_BET_FRACTIONS = [0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 0.9];

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function sizeClassProbabilities(prediction) {
    const triple = clamp(Number(prediction?.triple) || 0, 0, 1);
    const rawBig = clamp(Number(prediction?.big) || 0, 0, 1);
    const rawSmall = clamp(Number(prediction?.small) || 0, 0, 1);
    const sideTotal = rawBig + rawSmall;
    const conditionalBig = sideTotal ? rawBig / sideTotal : 0.5;
    const nonTriple = 1 - triple;
    return {
      big: conditionalBig * nonTriple,
      small: (1 - conditionalBig) * nonTriple,
      triple,
    };
  }

  function metricBrierLoss(prediction, result, metric) {
    if (metric === "size") {
      const probabilities = sizeClassProbabilities(prediction);
      const outcome = result.triple ? "triple" : result.size;
      return 0.5 * ["big", "small", "triple"].reduce((total, key) => {
        const actual = outcome === key ? 1 : 0;
        return total + (probabilities[key] - actual) ** 2;
      }, 0);
    }
    const probability = clamp(Number(prediction?.odd) || 0, 0, 1);
    const actual = result.parity === "odd" ? 1 : 0;
    return (probability - actual) ** 2;
  }

  function brierImprovement(baselinePrediction, candidatePrediction, result, metric) {
    return metricBrierLoss(baselinePrediction, result, metric)
      - metricBrierLoss(candidatePrediction, result, metric);
  }

  function directionObservation(prediction, result, metric) {
    let firstProbability;
    let secondProbability;
    let pickedFirst;
    let won;
    if (metric === "size") {
      const probabilities = sizeClassProbabilities(prediction);
      firstProbability = probabilities.big;
      secondProbability = probabilities.small;
      if (Math.abs(firstProbability - secondProbability) < 1e-12) return { decided: false };
      pickedFirst = firstProbability > secondProbability;
      won = !result.triple && pickedFirst === (result.size === "big");
    } else {
      firstProbability = clamp(Number(prediction?.odd) || 0, 0, 1);
      secondProbability = 1 - firstProbability;
      if (Math.abs(firstProbability - secondProbability) < 1e-12) return { decided: false };
      pickedFirst = firstProbability > secondProbability;
      won = pickedFirst === (result.parity === "odd");
    }
    return { decided: true, won, firstProbability, secondProbability };
  }

  function logMeanExp(logValues) {
    if (!logValues.length) return 0;
    const maximum = Math.max(...logValues);
    if (!Number.isFinite(maximum)) return maximum;
    const normalized = logValues.reduce((total, value) => total + Math.exp(value - maximum), 0) / logValues.length;
    return maximum + Math.log(normalized);
  }

  function finiteEvidence(logValue) {
    return Math.exp(Math.min(700, logValue));
  }

  function oneSidedBernoulliEValue(hits, count, nullProbability = BREAK_EVEN_PROBABILITY) {
    if (!count) return { value: 1, logValue: 0 };
    const nullChance = clamp(Number(nullProbability), 1e-9, 1 - 1e-9);
    const logValues = [];
    for (let index = 0; index < DIRECTION_MIXTURE_POINTS; index += 1) {
      const alternative = nullChance + (1 - nullChance) * ((index + 0.5) / DIRECTION_MIXTURE_POINTS);
      logValues.push(
        hits * Math.log(alternative / nullChance)
        + (count - hits) * Math.log((1 - alternative) / (1 - nullChance)),
      );
    }
    const logValue = logMeanExp(logValues);
    return { value: finiteEvidence(logValue), logValue };
  }

  function boundedMeanEValue(values) {
    if (!values.length) return { value: 1, logValue: 0, mean: null };
    const bounded = values.map((value) => clamp(Number(value) || 0, -1, 1));
    const logValues = BRIER_BET_FRACTIONS.map((fraction) => bounded.reduce(
      (total, value) => total + Math.log1p(fraction * value),
      0,
    ));
    const logValue = logMeanExp(logValues);
    return {
      value: finiteEvidence(logValue),
      logValue,
      mean: bounded.reduce((total, value) => total + value, 0) / bounded.length,
    };
  }

  return Object.freeze({
    DEFAULT_ODDS,
    BREAK_EVEN_PROBABILITY,
    FAIR_SIZE_WIN_PROBABILITY,
    FAIR_PARITY_WIN_PROBABILITY,
    sizeClassProbabilities,
    metricBrierLoss,
    brierImprovement,
    directionObservation,
    oneSidedBernoulliEValue,
    boundedMeanEValue,
  });
});
