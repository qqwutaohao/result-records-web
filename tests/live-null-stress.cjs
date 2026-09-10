"use strict";
const assert = require("node:assert/strict");
const live = require("../live-model.js");

// Fixed seed, independent outcomes sampled only after the forecast is frozen.
let state = 0x593afc81;
function random() {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 4294967296;
}
const totals = { size: { issued: 0, hits: 0, loss: 0, baselineLoss: 0 }, parity: { issued: 0, hits: 0, loss: 0, baselineLoss: 0 } };
const sessions = 500, rounds = 60;
for (let run = 0; run < sessions; run += 1) {
  const rows = [];
  for (let index = 0; index < rounds; index += 1) {
    const forecast = live.forecast(rows);
    const officialDice = Array.from({ length: 3 }, () => Math.floor(random() * 6) + 1);
    rows.unshift({ id: String(index), officialDice, source: "quick", createdAt: "2026-09-10T00:01:00Z",
      forecast: { ...forecast, streamers: [], status: "locked", lockedAt: "2026-09-10T00:00:00Z" } });
  }
  const report = live.evaluate(rows);
  for (const metric of ["size", "parity"]) {
    const values = report.metrics[metric];
    totals[metric].issued += values.issued;
    totals[metric].hits += values.hits;
    totals[metric].loss += values.scores.live.loss / sessions;
    totals[metric].baselineLoss += values.scores.baseline.loss / sessions;
  }
}
for (const metric of ["size", "parity"]) {
  const values = totals[metric];
  const expected = metric === "size" ? 35 / 72 : 0.5;
  const tolerance = 6 * Math.sqrt(expected * (1 - expected) / values.issued);
  assert.ok(values.issued > 1000);
  assert.ok(Math.abs(values.hits / values.issued - expected) < tolerance, "future independent outcomes must remain near chance");
  assert.ok(values.loss >= values.baselineLoss - 0.008, "no artificial advantage against a known fair baseline");
}
console.log(JSON.stringify({ sessions, rounds, totals, note: "Simulation regression check only; not evidence of real-world accuracy." }));
