"use strict";

const assert = require("node:assert/strict");
const core = require("../model-core.js");

const SESSION_COUNT = Number(process.env.K3_STRESS_RUNS) || 20000;
const ROUNDS_PER_SESSION = 120;
const TRIAL_THRESHOLD = 40;
const STABLE_THRESHOLD = 200;

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function rollDie(random) {
  return Math.floor(random() * 6) + 1;
}

function classify(dice) {
  const sum = dice.reduce((total, value) => total + value, 0);
  const triple = dice.every((value) => value === dice[0]);
  return {
    triple,
    size: triple ? null : sum >= 11 ? "big" : "small",
    parity: sum % 2 ? "odd" : "even",
  };
}

function wilsonUpper(successes, count) {
  const z = 1.96;
  const rate = successes / count;
  const denominator = 1 + z ** 2 / count;
  const center = rate + z ** 2 / (2 * count);
  const radius = z * Math.sqrt(rate * (1 - rate) / count + z ** 2 / (4 * count ** 2));
  return (center + radius) / denominator;
}

const random = seededRandom(0x4b335634);
let trialSessions = 0;
let stableSessions = 0;

for (let session = 0; session < SESSION_COUNT; session += 1) {
  const history = { big: 0, small: 0, odd: 0, even: 0 };
  const evidence = { size: { hits: 0, count: 0 }, parity: { hits: 0, count: 0 } };
  let trial = false;
  let stable = false;

  for (let round = 0; round < ROUNDS_PER_SESSION; round += 1) {
    const pickedBig = history.big >= history.small;
    const pickedOdd = history.odd >= history.even;
    const result = classify([rollDie(random), rollDie(random), rollDie(random)]);

    if (round >= 10) {
      evidence.size.count += 1;
      evidence.parity.count += 1;
      if (!result.triple && pickedBig === (result.size === "big")) evidence.size.hits += 1;
      if (pickedOdd === (result.parity === "odd")) evidence.parity.hits += 1;
    }

    if (result.triple) {
      // A triple is a loss for both size directions and has no conditional side count.
    } else {
      history[result.size] += 1;
    }
    history[result.parity] += 1;

    const completedRound = round + 1;
    if (completedRound >= 20 && completedRound % 10 === 0) {
      const sizeValue = core.oneSidedBernoulliEValue(
        evidence.size.hits,
        evidence.size.count,
        core.BREAK_EVEN_PROBABILITY,
      ).value;
      const parityValue = core.oneSidedBernoulliEValue(
        evidence.parity.hits,
        evidence.parity.count,
        core.BREAK_EVEN_PROBABILITY,
      ).value;
      if (Math.max(sizeValue, parityValue) >= TRIAL_THRESHOLD) trial = true;
      if (completedRound >= 30 && Math.max(sizeValue, parityValue) >= STABLE_THRESHOLD) stable = true;
    }
  }

  if (trial) trialSessions += 1;
  if (stable) stableSessions += 1;
}

const trialRate = trialSessions / SESSION_COUNT;
const stableRate = stableSessions / SESSION_COUNT;
const trialUpper = wilsonUpper(trialSessions, SESSION_COUNT);
const stableUpper = wilsonUpper(stableSessions, SESSION_COUNT);

console.log(JSON.stringify({
  sessions: SESSION_COUNT,
  roundsPerSession: ROUNDS_PER_SESSION,
  trialSessions,
  trialRate,
  trialWilsonUpper95: trialUpper,
  stableSessions,
  stableRate,
  stableWilsonUpper95: stableUpper,
}, null, 2));

assert.ok(trialUpper <= 0.05, `trial whole-session false-positive upper bound ${trialUpper} exceeded 5%`);
assert.ok(stableUpper <= 0.01, `stable whole-session false-positive upper bound ${stableUpper} exceeded 1%`);
