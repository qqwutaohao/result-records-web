"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../model-core.js");

function classify(dice) {
  const sum = dice.reduce((total, value) => total + value, 0);
  const triple = dice.every((value) => value === dice[0]);
  return {
    sum,
    triple,
    size: triple ? null : sum >= 11 ? "big" : "small",
    parity: sum % 2 ? "odd" : "even",
  };
}

test("216 outcomes contain 105 big wins, 105 small wins and 6 triples", () => {
  const counts = { big: 0, small: 0, triple: 0 };
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      for (let third = 1; third <= 6; third += 1) {
        const result = classify([first, second, third]);
        if (result.triple) counts.triple += 1;
        else counts[result.size] += 1;
      }
    }
  }
  assert.deepEqual(counts, { big: 105, small: 105, triple: 6 });
});

test("fair size prediction is a normalized three-class vector", () => {
  const probabilities = core.sizeClassProbabilities({ big: 0.5, small: 0.5, triple: 1 / 36 });
  assert.ok(Math.abs(probabilities.big - 35 / 72) < 1e-12);
  assert.ok(Math.abs(probabilities.small - 35 / 72) < 1e-12);
  assert.ok(Math.abs(probabilities.triple - 1 / 36) < 1e-12);
  assert.ok(Math.abs(probabilities.big + probabilities.small + probabilities.triple - 1) < 1e-12);
});

test("size Brier score includes triples and a size direction loses on a triple", () => {
  const result = classify([4, 4, 4]);
  const fair = { big: 0.5, small: 0.5, triple: 1 / 36 };
  const tripleAware = { big: 0.5, small: 0.5, triple: 0.5 };
  assert.ok(core.metricBrierLoss(tripleAware, result, "size") < core.metricBrierLoss(fair, result, "size"));
  assert.deepEqual(
    core.directionObservation({ big: 0.7, small: 0.3, triple: 0.05 }, result, "size").won,
    false,
  );
});

test("direction e-process can distinguish exceptional complete blocks", () => {
  assert.ok(core.oneSidedBernoulliEValue(10, 10).value >= 40);
  assert.ok(core.oneSidedBernoulliEValue(9, 10).value < 40);
  assert.ok(core.oneSidedBernoulliEValue(20, 20).value >= 200);
});

test("Brier e-process rewards positive prospective improvement", () => {
  const positive = core.boundedMeanEValue(Array(20).fill(0.2));
  const neutral = core.boundedMeanEValue(Array(20).fill(0));
  const negative = core.boundedMeanEValue(Array(20).fill(-0.2));
  assert.ok(positive.value > neutral.value);
  assert.ok(neutral.value > negative.value);
  assert.equal(neutral.value, 1);
});
