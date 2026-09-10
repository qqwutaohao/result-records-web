"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const URL = process.env.K3_TEST_URL || "http://127.0.0.1:8125/";
const RECORDS = "k3-verifier-records-v5";
const LEDGER = "k3-verifier-forecast-ledger-v5";

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.K3_BROWSER_PATH || undefined });
  const errors = [];
  try {
    for (const version of [1, 4]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(URL, { waitUntil: "networkidle" });
      const legacySnapshot = await page.evaluate((v) => {
        localStorage.clear();
        const now = new Date().toISOString();
        const rows = [{ id: "legacy-1", issue: "old-001", officialDice: [6, 6, 5], sessionId: "legacy-session", createdAt: now, source: "quick",
          bet: { selection: "big", stake: 2, net: 1.92, payout: 3.92, odds: 1.96 } }];
        const values = {
          ["k3-verifier-records-v" + v]: JSON.stringify(rows),
          ["k3-verifier-bankroll-v" + v]: JSON.stringify({ initial: 100 }),
          ["k3-verifier-model-session-v" + v]: JSON.stringify({ id: "legacy-session", startedAt: now, lastActiveAt: now }),
        };
        for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
        localStorage.setItem("k3-verifier-title-v1", "我的记录");
        return values;
      }, version);
      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await page.locator("#app-title").textContent(), "我的记录");
      assert.match(await page.locator("#session-status").textContent(), /本场 1 轮/);
      assert.match(await page.locator("#current-balance").textContent(), /101.92/);
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), RECORDS), null);
      const add = async (dice, expected) => {
        await page.locator("#quick-result").fill(dice);
        await page.locator("#quick-result").press("Enter");
        await page.waitForFunction(({ key, n }) => JSON.parse(localStorage.getItem(key) || "[]").length === n, { key: RECORDS, n: expected });
      };
      await add("112", 2);
      for (const [key, value] of Object.entries(legacySnapshot)) assert.equal(await page.evaluate((k) => localStorage.getItem(k), key), value);
      await page.evaluate((v) => localStorage.setItem("k3-verifier-records-v" + v, "[]"), version);
      await page.reload({ waitUntil: "networkidle" });
      assert.match(await page.locator("#session-status").textContent(), /本场 2 轮/);
      assert.match(await page.locator("#current-balance").textContent(), /101.92/);

      await page.locator("#quick-issue").fill("fresh-003");
      await page.locator("#lock-forecast").click();
      await page.locator("#skip-forecast").waitFor({ state: "visible" });
      await add("665", 3);
      assert.match(await page.locator("#model-validation").textContent(), /已验证 1 轮/);
      await page.locator("#quick-issue").fill("pending-004");
      await page.locator("#lock-forecast").click();
      await page.locator("#skip-forecast").waitFor({ state: "visible" });
      await page.locator(".advanced-tools").evaluate((element) => { element.open = true; });
      await page.locator("[data-delete-id]").first().click();
      await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).length === 2, RECORDS);
      assert.match(await page.locator("#quick-message").textContent(), /验证证据已作废/);
      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await page.locator("#quick-issue").isEnabled(), true);
      assert.match(await page.locator("#model-confidence-details").textContent(), /暂无提前验证/);
      assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).length, LEDGER), 2);
      await page.locator("#quick-issue").fill("fresh-005");
      await page.locator("#lock-forecast").click();
      await page.locator("#skip-forecast").waitFor({ state: "visible" });
      // A history change after lock must not silently re-score the stale snapshot.
      await page.evaluate((key) => {
        const rows = JSON.parse(localStorage.getItem(key));
        rows[0].officialDice = [2, 3, 4];
        localStorage.setItem(key, JSON.stringify(rows));
      }, RECORDS);
      await page.reload({ waitUntil: "networkidle" });
      await page.locator("#quick-result").fill("555");
      await page.locator("#quick-result").press("Enter");
      await page.waitForFunction(() => document.querySelector("#quick-message").textContent.includes("历史数据已变化"));
      assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).length, RECORDS), 2);
      await page.locator("#skip-forecast").click();
      await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key))[0].status === "missed", LEDGER);
      await add("555", 3);
      assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key))[0].forecast, RECORDS), null);
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ legacyV1AndV4Migrated: true, staleOldTabsIsolated: true, deletedEvidenceInvalidated: true, noPendingResurrection: true, modifiedHistoryRejected: true, pageErrors: errors.length }));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
