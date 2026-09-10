"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const URL = process.env.K3_TEST_URL || "http://127.0.0.1:8125/";
const RECORDS = "k3-verifier-records-v5";
const LEDGER = "k3-verifier-forecast-ledger-v5";

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.K3_BROWSER_PATH || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(URL, { waitUntil: "networkidle" });
    const count = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]").length, RECORDS);
    const add = async (dice) => {
      const before = await count();
      await page.locator("#quick-result").fill(dice);
      await page.locator("#quick-result").press("Enter");
      await page.waitForFunction(({ key, expected }) => JSON.parse(localStorage.getItem(key) || "[]").length === expected, { key: RECORDS, expected: before + 1 });
    };
    for (let index = 0; index < 10; index += 1) await add(index % 2 ? "112" : "665");
    assert.match(await page.locator("#signal-size").textContent(), /参考偏/);
    assert.match(await page.locator("#signal-parity").textContent(), /参考偏/);
    assert.match(await page.locator("#model-validation").textContent(), /补录不计/);
    assert.equal(await page.locator("#lock-forecast").isEnabled(), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator("#quick-result").fill("665");
    await page.locator("#quick-result").dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229 });
    assert.equal(await count(), 10);
    await page.locator("#quick-result").fill("");

    await page.locator("#pre-round-options").evaluate((element) => { element.open = true; });
    await page.locator("#add-streamer").click();
    await page.locator("[data-streamer-name]").fill("测试主播");
    await page.locator("[data-streamer-size]").selectOption("big");
    await page.locator("[data-streamer-parity]").selectOption("odd");
    await page.locator("#quick-issue").fill("test-011");
    await page.locator("#lock-forecast").click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) || "[]").length === 1, LEDGER);
    const frozen = await page.evaluate((key) => JSON.parse(localStorage.getItem(key))[0], LEDGER);
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("#quick-issue").inputValue(), "test-011");
    assert.equal(await page.locator("#quick-issue").isDisabled(), true);
    await add("665");
    const recorded = await page.evaluate((key) => JSON.parse(localStorage.getItem(key))[0], RECORDS);
    assert.deepEqual(recorded.forecast.candidates, frozen.candidates);
    assert.deepEqual(recorded.forecast.streamers, frozen.streamers);
    assert.match(await page.locator("#model-validation").textContent(), /已验证 1 轮/);
    assert.match(await page.locator("#last-feedback").textContent(), /大小命中/);

    await page.locator("#quick-issue").fill("test-011");
    await page.locator("#lock-forecast").click();
    assert.match(await page.locator("#quick-message").textContent(), /已有记录/);
    await page.locator("#quick-issue").fill("test-missed");
    await page.locator("#lock-forecast").click();
    await page.locator("#skip-forecast").waitFor({ state: "visible" });
    await page.locator("#skip-forecast").click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).some((entry) => entry.status === "missed"), LEDGER);

    await page.locator(".advanced-tools").evaluate((element) => { element.open = true; });
    await page.locator("#initial-bankroll").fill("100");
    await page.locator("#save-bankroll").click();
    await page.locator("#pre-round-options").evaluate((element) => { element.open = true; });
    await page.locator("#participation-mode").selectOption("simulate");
    await page.locator("#quick-bet-selection").selectOption("big");
    await page.locator("#quick-stake").fill("2");
    await page.locator("#quick-issue").fill("test-sim");
    await page.locator("#lock-forecast").click();
    await page.locator("#skip-forecast").waitFor({ state: "visible" });
    await add("444");
    assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key))[0].sequenceBreak, RECORDS), true);
    assert.match(await page.locator("#current-balance").textContent(), /98/);
    await page.locator("#pre-round-options").evaluate((element) => { element.open = true; });
    await page.locator("#participation-mode").selectOption("actual");
    await page.locator("#quick-bet-selection").selectOption("big");
    await page.locator("#quick-stake").fill("2");
    await page.locator("#quick-issue").fill("test-real");
    await page.locator("#lock-forecast").click();
    await page.locator("#skip-forecast").waitFor({ state: "visible" });
    await add("665");
    assert.match(await page.locator("#current-balance").textContent(), /98/);
    assert.match(await page.locator("#cross-session-stability").textContent(), /实际参与1 轮/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-data").click()]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString("utf8");
    assert.match(csv, /锁定大%/);
    assert.match(csv, /test-missed","漏期留痕/);
    assert.match(csv, /测试主播/);
    assert.match(csv, /完整审计明细JSON/);

    await page.locator(".advanced-tools").evaluate((element) => { element.open = false; });
    if (process.env.K3_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.K3_SCREENSHOT_DIR, "k3-v5-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1365, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (process.env.K3_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.K3_SCREENSHOT_DIR, "k3-v5-desktop.png"), fullPage: true });

    const second = await context.newPage();
    second.on("pageerror", (error) => errors.push(error.message));
    await second.goto(URL, { waitUntil: "networkidle" });
    const before = await count();
    await page.locator("#quick-result").fill("111");
    await second.locator("#quick-result").fill("222");
    await Promise.all([page.locator("#quick-result").press("Enter"), second.locator("#quick-result").press("Enter")]);
    await page.waitForFunction(({ key, expected }) => JSON.parse(localStorage.getItem(key)).length === expected, { key: RECORDS, expected: before + 2 });
    await second.close();
    await page.locator("#quick-result").fill("");
    await page.locator("#quick-issue").fill("2026091001234567890123456789012345678901");
    await page.locator("#lock-forecast").click();
    await page.locator("#skip-forecast").waitFor({ state: "visible" });
    for (const width of [320, 360, 390, 768, 1365]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "long issue overflow at " + width);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ responsive: true, warmup10: true, lockedForecastImmutable: true, skippedRoundAudited: true, actualAndSimulationSeparated: true, csvAuditExport: true, concurrentWrites: true, pageErrors: errors.length }));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
