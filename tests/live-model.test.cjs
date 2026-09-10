"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const live = require("../live-model.js");
const core = require("../model-core.js");

function append(rows, dice, streamers = []) {
  const forecast = live.forecast(rows, streamers);
  rows.unshift({
    id: String(rows.length), source: "quick", officialDice: dice,
    forecast: { ...forecast, status: "locked", streamers, lockedAt: "2026-09-10T00:00:00.000Z" },
    createdAt: "2026-09-10T00:01:00.000Z",
  });
  return forecast;
}

test("all candidate pairs and three-class size probabilities remain normalized", () => {
  const rows = [];
  for (let index = 0; index < 80; index += 1) {
    const forecast = append(rows, [index % 6 + 1, (index * 3 + 2) % 6 + 1, (index * 5 + 1) % 6 + 1]);
    for (const p of Object.values(forecast.candidates)) {
      assert.ok(Math.abs(p.big + p.small - 1) < 1e-12);
      assert.ok(Math.abs(p.odd + p.even - 1) < 1e-12);
      assert.ok(Object.values(p).every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
      const classes = core.sizeClassProbabilities(p);
      assert.ok(Math.abs(classes.big + classes.small + classes.triple - 1) < 1e-12);
    }
  }
});

test("a repeated alternating sequence changes next-round direction after 10 observations", () => {
  const rows = [];
  for (let index = 0; index < 10; index += 1) append(rows, index % 2 ? [1, 1, 2] : [6, 6, 5]);
  const next = live.forecast(rows);
  assert.equal(next.decisions.size.direction, "big");
  assert.equal(next.decisions.parity.direction, "odd");
  append(rows, [6, 6, 5]);
  assert.equal(live.forecast(rows).decisions.size.direction, "small");
  assert.equal(live.forecast(rows).decisions.parity.direction, "even");
});

test("a reversal retracts stale signals without waiting for a complete 10-round block", () => {
  const rows = [];
  for (let index = 0; index < 20; index += 1) append(rows, [6, 6, 5]);
  assert.equal(live.forecast(rows).decisions.size.direction, "big");
  for (let index = 0; index < 3; index += 1) append(rows, [1, 1, 2]);
  assert.equal(live.forecast(rows).decisions.size.status, "changing");
  for (let index = 0; index < 10; index += 1) append(rows, [1, 1, 2]);
  assert.equal(live.forecast(rows).decisions.size.direction, "small");
});

test("unlocked, late and invalidated results cannot become prospective scores", () => {
  const rows = [];
  append(rows, [4, 4, 4]);
  const valid = rows[0];
  assert.equal(live.evaluate(rows).count, 1);
  assert.equal(live.evaluate([{ ...valid, forecast: null }]).count, 0);
  assert.equal(live.evaluate([{ ...valid, evidenceInvalidated: true }]).count, 0);
  assert.equal(live.evaluate([{ ...valid, createdAt: "2026-09-09T00:00:00.000Z" }]).count, 0);
});

test("caller popularity alone changes no probability; observed effects remain bounded", () => {
  const rows = [];
  for (let index = 0; index < 20; index += 1) append(rows, [1, 1, 2], [{ name: "A", size: "big", parity: "odd" }]);
  const unknown = live.forecast(rows, [{ name: "B", size: "big", parity: "odd" }]);
  assert.deepEqual(unknown.candidates.history, unknown.candidates.live);
  const known = live.forecast(rows, [{ name: "A", size: "big", parity: "odd" }]);
  assert.ok(known.candidates.live.big < known.candidates.history.big);
  assert.ok(Math.abs(known.candidates.live.big - known.candidates.history.big) <= 0.35);
  assert.equal(known.streamerCounts.size, 20);
});

test("selected-period comparisons use the same rows and triples count as size losses", () => {
  const rows = [];
  for (let index = 0; index < 10; index += 1) append(rows, [6, 6, 5]);
  append(rows, [4, 4, 4]);
  const report = live.evaluate(rows);
  assert.equal(report.metrics.size.issued, 1);
  assert.equal(report.metrics.size.hits, 0);
  assert.equal(report.metrics.size.scores.baseline.hits, 0);
  assert.equal(report.count, 11);
});

test("manual history trains weights without entering prospective validation", () => {
  const rows = [];
  for (let index = 0; index < 10; index += 1) {
    const referencePrediction = live.forecast(rows);
    rows.unshift({ id: String(index), source: "quick", officialDice: index % 2 ? [1, 1, 2] : [6, 6, 5], referencePrediction });
  }
  assert.equal(live.evaluate(rows).count, 0);
  const forecast = live.forecast(rows);
  assert.equal(forecast.decisions.size.direction, "big");
  assert.equal(forecast.decisions.parity.direction, "odd");
  assert.ok(forecast.decisions.size.weights[2] > forecast.decisions.size.weights[1]);
});

test("missed rounds and screenshots cannot manufacture consecutive transitions", () => {
  const rows = [
    { officialDice: [6, 6, 5], source: "quick", sequenceBreak: true },
    { officialDice: [6, 6, 5], source: "quick" },
  ];
  const recent = live.recentModel(rows);
  assert.equal(live.sequenceModel(rows, recent).counts.size, 0);
  delete rows[0].sequenceBreak;
  assert.equal(live.sequenceModel(rows, recent).counts.size, 1);
  rows[0].nextIsUnknown = true;
  assert.deepEqual(live.sequenceModel(rows, recent).prediction, recent);
  delete rows[0].nextIsUnknown;
  rows[1].source = "screenshot";
  assert.equal(live.sequenceModel(rows, recent).counts.size, 0);
});
