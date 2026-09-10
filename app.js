(() => {
  "use strict";

  if (!globalThis.K3ModelCore || !globalThis.K3LiveModel) {
    if (globalThis.__K3_MODEL_BOOTSTRAPPING__) throw new Error("模型核心未加载。");
    globalThis.__K3_MODEL_BOOTSTRAPPING__ = true;
    if (document.readyState === "loading") {
      document.write('<script src="model-core.js?v=5"><\/script><script src="live-model.js?v=5"><\/script><script src="app.js?v=5"><\/script>');
    } else {
      const coreScript = document.createElement("script");
      coreScript.src = "model-core.js?v=5";
      coreScript.onload = () => {
        const liveScript = document.createElement("script");
        liveScript.src = "live-model.js?v=5";
        liveScript.onload = () => {
          const appScript = document.createElement("script");
          appScript.src = "app.js?v=5";
          document.head.append(appScript);
        };
        document.head.append(liveScript);
      };
      document.head.append(coreScript);
    }
    return;
  }
  const ModelCore = globalThis.K3ModelCore;
  const LiveModel = globalThis.K3LiveModel;
  if (!document.querySelector("#lock-forecast")) {
    const updated = new URL(location.href);
    if (updated.searchParams.get("ui") !== "5") {
      updated.searchParams.set("ui", "5");
      location.replace(updated.href);
    } else document.body.textContent = "页面仍为旧缓存，请刷新后重试。";
    return;
  }

  const LEGACY_STORAGE_KEY = "k3-verifier-records-v1";
  const LEGACY_BANKROLL_KEY = "k3-verifier-bankroll-v1";
  const LEGACY_SESSION_KEY = "k3-verifier-model-session-v1";
  const STORAGE_KEY = "k3-verifier-records-v5";
  const BANKROLL_KEY = "k3-verifier-bankroll-v5";
  const TITLE_KEY = "k3-verifier-title-v1";
  const SESSION_KEY = "k3-verifier-model-session-v5";
  const INVALIDATED_SESSIONS_KEY = "k3-verifier-invalidated-sessions-v5";
  const LEDGER_KEY = "k3-verifier-forecast-ledger-v5";
  const STREAMERS_KEY = "k3-verifier-streamers-v5";
  const WRITE_LOCK_KEY = "k3-verifier-write-lock-v1";
  const WRITE_LOCK_NAME = "k3-verifier-data-write";
  const DEFAULT_TITLE = "结果记录台";
  const MODEL_PROTOCOL_VERSION = 4;
  const SESSION_GAP_MS = 30 * 60 * 1000;
  const PRIOR_SIDE = 10;
  const DICE_PRIOR_FACE = 4;
  const TRIPLE_PRIOR_HITS = 1;
  const TRIPLE_PRIOR_TOTAL = 36;
  const DECAY_HALF_LIFE = 20;
  const ENSEMBLE_ETA = 2;
  const VALIDATION_BLOCK_SIZE = 10;
  const HISTORY_PRIOR_ROUNDS = 5;
  const HISTORY_QUALIFIED_ROUNDS = 40;
  const HISTORY_MAX_RECORDS = 200;
  const ODDS = ModelCore.DEFAULT_ODDS;
  const BREAK_EVEN_PROBABILITY = ModelCore.BREAK_EVEN_PROBABILITY;
  const TRIAL_E_VALUE_THRESHOLD = 40;
  const STABLE_E_VALUE_THRESHOLD = 200;
  const CUSUM_RECENT_SIZE = 10;
  const CUSUM_REFERENCE_SIZE = 20;
  const CUSUM_ALLOWANCE = 0.5;
  const CUSUM_THRESHOLD = 4;
  const OCR_SCRIPT = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  const LABELS = { big: "大", small: "小", odd: "单", even: "双" };
  const MODEL_DEFINITIONS = [
    { key: "baseline", name: "固定 50%" },
    { key: "static", name: "静态贝叶斯" },
    { key: "dynamic", name: "动态贝叶斯" },
    { key: "diceBias", name: "分位置偏差" },
    { key: "pooledBias", name: "无序骰子偏差" },
    { key: "ensemble", name: "加权组合" },
  ];
  const BASE_MODEL_KEYS = ["baseline", "static", "dynamic", "diceBias", "pooledBias"];
  const TAB_ID = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tabChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel("k3-verifier-tabs-v5") : null;
  const pendingTabProbes = new Map();

  if (tabChannel) {
    tabChannel.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || message.from === TAB_ID) return;
      if (message.type === "probe") {
        tabChannel.postMessage({ type: "present", requestId: message.requestId, from: TAB_ID });
      } else if (message.type === "present" && pendingTabProbes.has(message.requestId)) {
        pendingTabProbes.set(message.requestId, true);
      }
    });
  }

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const els = {
    appTitle: $("#app-title"),
    appTitleInput: $("#app-title-input"),
    editTitle: $("#edit-title"),
    titleMessage: $("#title-message"),
    sessionStatus: $("#session-status"),
    startNewSession: $("#start-new-session"),
    quickResult: $("#quick-result"),
    quickResultPreview: $("#quick-result-preview"),
    quickIssue: $("#quick-issue"),
    quickBetSelection: $("#quick-bet-selection"),
    quickStake: $("#quick-stake"),
    quickStakeHint: $("#quick-stake-hint"),
    saveResult: $("#save-result"),
    quickMessage: $("#quick-message"),
    lockForecast: $("#lock-forecast"),
    skipForecast: $("#skip-forecast"),
    pendingStatus: $("#pending-status"),
    preRoundOptions: $("#pre-round-options"),
    streamerInputs: $("#streamer-inputs"),
    addStreamer: $("#add-streamer"),
    participationMode: $("#participation-mode"),
    sizeReason: $("#size-reason"),
    parityReason: $("#parity-reason"),
    actualProbabilities: $("#actual-probabilities"),
    lastFeedback: $("#last-feedback"),
    modelConfidence: $("#model-confidence"),
    modelSample: $("#model-sample"),
    probBig: $("#prob-big"),
    probSmall: $("#prob-small"),
    probOdd: $("#prob-odd"),
    probEven: $("#prob-even"),
    barBig: $("#bar-big"),
    barOdd: $("#bar-odd"),
    modelNote: $("#model-note"),
    modelValidation: $("#model-validation"),
    signalSize: $("#signal-size"),
    signalParity: $("#signal-parity"),
    quickHistoryCount: $("#quick-history-count"),
    quickHistoryList: $("#quick-history-list"),
    initialBankroll: $("#initial-bankroll"),
    saveBankroll: $("#save-bankroll"),
    bankrollMessage: $("#bankroll-message"),
    initialBalance: $("#initial-balance"),
    currentBalance: $("#current-balance"),
    totalProfit: $("#total-profit"),
    returnRate: $("#return-rate"),
    sampleCount: $("#sample-count"),
    historyStats: $("#history-stats"),
    modelLeaderboard: $("#model-leaderboard"),
    modelConfidenceDetails: $("#model-confidence-details"),
    crossSessionStability: $("#cross-session-stability"),
    validationList: $("#validation-list"),
    recordsBody: $("#records-body"),
    recordsEmpty: $("#records-empty"),
    exportData: $("#export-data"),
    clearData: $("#clear-data"),
    confirmDialog: $("#confirm-dialog"),
    ocrDropzone: $("#ocr-dropzone"),
    ocrFiles: $("#ocr-files"),
    ocrProgress: $("#ocr-progress"),
    ocrProgressBar: $("#ocr-progress-bar"),
    ocrProgressText: $("#ocr-progress-text"),
    ocrResults: $("#ocr-results"),
    ocrSummary: $("#ocr-summary"),
    ocrCandidates: $("#ocr-candidates"),
    ocrRawText: $("#ocr-raw-text"),
    ocrMessage: $("#ocr-message"),
    importOcrRecords: $("#import-ocr-records"),
    clearOcrResults: $("#clear-ocr-results"),
  };

  let invalidatedSessions = loadInvalidatedSessions();
  let records = loadRecords();
  let bankroll = loadBankroll();
  let session = loadSession();
  let forecastLedger = loadArray(LEDGER_KEY);
  let ocrCandidates = [];
  let ocrRawSections = [];
  let ocrLibraryPromise = null;
  let savingResult = false;
  let storageSyncTimer = null;
  let renderedPendingId = null;

  if (bankroll) els.initialBankroll.value = bankroll.initial;
  applyTitle(localStorage.getItem(TITLE_KEY) || DEFAULT_TITLE);

  function validDice(dice) {
    return Array.isArray(dice) && dice.length === 3
      && dice.every((value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 6);
  }

  function validLockedModelKeys(keys) {
    return keys && ["size", "parity"].every((metric) => MODEL_DEFINITIONS.some(({ key }) => key === keys[metric]));
  }

  function validModelBlock(record) {
    const block = record?.modelBlock;
    return record?.modelProtocolVersion === MODEL_PROTOCOL_VERSION
      && block?.protocolVersion === MODEL_PROTOCOL_VERSION
      && Number.isInteger(block.round)
      && Number.isInteger(block.index)
      && Number.isInteger(block.position)
      && block.round >= 0
      && block.index === Math.floor(block.round / VALIDATION_BLOCK_SIZE)
      && block.position === block.round % VALIDATION_BLOCK_SIZE
      && typeof block.id === "string"
      && validLockedModelKeys(block.lockedModelKeys);
  }

  function derivedNextProtocolRound(sessionId) {
    const rounds = records.filter((record) => record.sessionId === sessionId && validModelBlock(record))
      .map((record) => record.modelBlock.round);
    return rounds.length ? Math.max(...rounds) + 1 : 0;
  }

  function normalizeSessionProtocol(candidate) {
    const derivedRound = derivedNextProtocolRound(candidate.id);
    const savedRound = candidate.modelProtocolVersion === MODEL_PROTOCOL_VERSION
      && Number.isInteger(candidate.nextProtocolRound)
      && candidate.nextProtocolRound >= 0
      ? candidate.nextProtocolRound
      : 0;
    const activeBlock = candidate.modelProtocolVersion === MODEL_PROTOCOL_VERSION
      && candidate.activeProtocolBlock?.protocolVersion === MODEL_PROTOCOL_VERSION
      && Number.isInteger(candidate.activeProtocolBlock.index)
      && validLockedModelKeys(candidate.activeProtocolBlock.lockedModelKeys)
      ? candidate.activeProtocolBlock
      : null;
    return {
      ...candidate,
      modelProtocolVersion: MODEL_PROTOCOL_VERSION,
      nextProtocolRound: Math.max(savedRound, derivedRound),
      activeProtocolBlock: activeBlock,
    };
  }

  function loadRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem("k3-verifier-records-v4") ?? localStorage.getItem(LEGACY_STORAGE_KEY) ?? "[]";
      const saved = JSON.parse(raw);
      return Array.isArray(saved) ? saved.filter((record) => validDice(record.officialDice)) : [];
    } catch {
      return [];
    }
  }

  function loadInvalidatedSessions() {
    try {
      const saved = JSON.parse(localStorage.getItem(INVALIDATED_SESSIONS_KEY) ?? localStorage.getItem("k3-verifier-invalidated-sessions-v4") ?? "[]");
      return new Set(Array.isArray(saved) ? saved.filter((value) => typeof value === "string") : []);
    } catch {
      return new Set();
    }
  }

  function saveInvalidatedSessions() {
    localStorage.setItem(INVALIDATED_SESSIONS_KEY, JSON.stringify([...invalidatedSessions]));
  }

  function saveRecords() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function loadBankroll() {
    try {
      const raw = localStorage.getItem(BANKROLL_KEY) ?? localStorage.getItem("k3-verifier-bankroll-v4") ?? localStorage.getItem(LEGACY_BANKROLL_KEY) ?? "null";
      const saved = JSON.parse(raw);
      return saved && Number.isFinite(saved.initial) && saved.initial >= 2 ? saved : null;
    } catch {
      return null;
    }
  }

  function saveBankrollState() {
    localStorage.setItem(BANKROLL_KEY, JSON.stringify(bankroll));
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function anotherTabIsOpen() {
    if (!tabChannel) return null;
    const requestId = `${TAB_ID}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    pendingTabProbes.set(requestId, false);
    tabChannel.postMessage({ type: "probe", requestId, from: TAB_ID });
    await delay(250);
    const found = pendingTabProbes.get(requestId) === true;
    pendingTabProbes.delete(requestId);
    return found;
  }

  async function withStorageWriteLock(action) {
    if (navigator.locks?.request) return navigator.locks.request(WRITE_LOCK_NAME, { mode: "exclusive" }, action);
    const anotherTab = await anotherTabIsOpen();
    if (anotherTab === null) throw new Error("当前浏览器版本不支持安全保存，请升级浏览器后重试。");
    if (anotherTab) throw new Error("当前浏览器不支持安全多标签写入，请关闭其他记录台页面后重试。");
    const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      let current = null;
      try {
        current = JSON.parse(localStorage.getItem(WRITE_LOCK_KEY) || "null");
      } catch {
        // Replace malformed lock data below.
      }
      if (!current?.token || Number(current.expiresAt) <= Date.now()) {
        localStorage.setItem(WRITE_LOCK_KEY, JSON.stringify({ token, expiresAt: Date.now() + 5000 }));
        await delay(30);
        let confirmed = null;
        try {
          confirmed = JSON.parse(localStorage.getItem(WRITE_LOCK_KEY) || "null");
        } catch {
          // Retry below.
        }
        if (confirmed?.token === token) {
          try {
            return await action();
          } finally {
            let latest = null;
            try {
              latest = JSON.parse(localStorage.getItem(WRITE_LOCK_KEY) || "null");
            } catch {
              // Leave unrelated malformed data untouched.
            }
            if (latest?.token === token) localStorage.removeItem(WRITE_LOCK_KEY);
          }
        }
      }
      await delay(25 + Math.floor(Math.random() * 25));
    }
    throw new Error("其他页面正在写入数据，请稍后重试。");
  }

  function syncStoredState() {
    invalidatedSessions = loadInvalidatedSessions();
    records = loadRecords();
    bankroll = loadBankroll();
    session = loadSession();
    forecastLedger = loadArray(LEDGER_KEY);
    ensureSession();
  }

  function sameLocalDay(first, second) {
    return first.getFullYear() === second.getFullYear()
      && first.getMonth() === second.getMonth()
      && first.getDate() === second.getDate();
  }

  function sessionIsActive(lastActiveAt) {
    const last = new Date(lastActiveAt);
    const now = new Date();
    return Number.isFinite(last.getTime()) && sameLocalDay(last, now)
      && now.getTime() - last.getTime() <= SESSION_GAP_MS;
  }

  function createSessionState() {
    const now = new Date().toISOString();
    return {
      id: `model-session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      startedAt: now,
      lastActiveAt: now,
      modelProtocolVersion: MODEL_PROTOCOL_VERSION,
      nextProtocolRound: 0,
      activeProtocolBlock: null,
    };
  }

  function newSession() {
    const created = createSessionState();
    localStorage.setItem(SESSION_KEY, JSON.stringify(created));
    return created;
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY) ?? localStorage.getItem("k3-verifier-model-session-v4") ?? localStorage.getItem(LEGACY_SESSION_KEY) ?? "null";
      const saved = JSON.parse(raw);
      if (saved?.id && sessionIsActive(saved.lastActiveAt)) {
        return normalizeSessionProtocol(saved);
      }
    } catch {
      // Start a clean session below.
    }
    const latest = records[0];
    if (latest?.sessionId && sessionIsActive(latest.createdAt)) {
      return normalizeSessionProtocol({ id: latest.sessionId, startedAt: latest.createdAt, lastActiveAt: latest.createdAt });
    }
    return createSessionState();
  }

  function ensureSession() {
    if (!sessionIsActive(session.lastActiveAt) || invalidatedSessions.has(session.id)) session = createSessionState();
    else if (session.modelProtocolVersion !== MODEL_PROTOCOL_VERSION) session = normalizeSessionProtocol(session);
    return session;
  }

  function touchSession() {
    session.lastActiveAt = new Date().toISOString();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function sessionRecords() {
    const active = ensureSession();
    return records.filter((record) => record.sessionId === active.id);
  }

  function outcomeRates(items) {
    let big = 0;
    let sizeTotal = 0;
    let odd = 0;
    items.forEach((record) => {
      const result = classify(record.officialDice);
      if (!result.triple) {
        sizeTotal += 1;
        if (result.size === "big") big += 1;
      }
      if (result.parity === "odd") odd += 1;
    });
    return {
      big: sizeTotal ? big / sizeTotal : null,
      odd: items.length ? odd / items.length : null,
    };
  }

  function historicalPriorItems(currentItems) {
    const groups = new Map();
    records.forEach((record) => {
      if (record.sessionId === session.id || record.source !== "quick" || !record.sessionId) return;
      if (!groups.has(record.sessionId)) groups.set(record.sessionId, []);
      groups.get(record.sessionId).push(record);
    });
    const historical = [...groups.values()].filter((items) => items.length >= HISTORY_QUALIFIED_ROUNDS)
      .flat()
      .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt))
      .slice(0, HISTORY_MAX_RECORDS);
    if (!historical.length || currentItems.length < VALIDATION_BLOCK_SIZE) return historical;
    const currentRates = outcomeRates(currentItems.slice(0, VALIDATION_BLOCK_SIZE));
    const historicalRates = outcomeRates(historical);
    const inconsistentSize = currentRates.big !== null && historicalRates.big !== null && Math.abs(currentRates.big - historicalRates.big) > 0.25;
    const inconsistentParity = currentRates.odd !== null && historicalRates.odd !== null && Math.abs(currentRates.odd - historicalRates.odd) > 0.25;
    return inconsistentSize || inconsistentParity ? [] : historical;
  }

  function applyTitle(title) {
    const value = title || DEFAULT_TITLE;
    els.appTitle.textContent = value;
    els.appTitleInput.value = value;
    document.title = value;
  }

  function startTitleEdit() {
    els.appTitle.classList.add("hidden");
    els.appTitleInput.classList.remove("hidden");
    els.editTitle.textContent = "保存";
    els.titleMessage.textContent = "";
    els.appTitleInput.focus();
    els.appTitleInput.select();
  }

  function finishTitleEdit(save) {
    if (save) {
      const value = els.appTitleInput.value.trim();
      if (!value) {
        els.titleMessage.textContent = "标题不能为空。";
        els.appTitleInput.focus();
        return;
      }
      localStorage.setItem(TITLE_KEY, value);
      applyTitle(value);
      els.titleMessage.textContent = "标题已保存在当前浏览器。";
    } else {
      els.appTitleInput.value = els.appTitle.textContent;
      els.titleMessage.textContent = "";
    }
    els.appTitleInput.classList.add("hidden");
    els.appTitle.classList.remove("hidden");
    els.editTitle.textContent = "修改标题";
  }

  function parseQuickDice(value) {
    const digits = String(value).match(/\d/g) || [];
    return digits.length === 3 && digits.every((digit) => /^[1-6]$/.test(digit)) ? digits.map(Number) : null;
  }

  function classify(dice) {
    const values = dice.map(Number);
    const sum = values.reduce((total, value) => total + value, 0);
    const triple = values.every((value) => value === values[0]);
    return {
      sum,
      triple,
      size: triple ? null : sum >= 11 ? "big" : "small",
      parity: sum % 2 ? "odd" : "even",
    };
  }

  function diceSymbols(dice) {
    return dice.map((value) => `[${value}]`).join(" ");
  }

  function resultLabel(result) {
    const size = result.triple ? "三同号" : LABELS[result.size];
    return `和值 ${result.sum} · ${size}${LABELS[result.parity]}`;
  }

  function modelName(key) {
    return MODEL_DEFINITIONS.find((model) => model.key === key)?.name || "未知模型";
  }

  function bayesModel(items, decayed, historicalItems) {
    let big = 0;
    let small = 0;
    let odd = 0;
    let even = 0;
    let triples = 0;
    let total = 0;
    items.forEach((record, index) => {
      const weight = decayed ? 0.5 ** (index / DECAY_HALF_LIFE) : 1;
      const result = classify(record.officialDice);
      total += weight;
      if (result.triple) triples += weight;
      if (result.size === "big") big += weight;
      if (result.size === "small") small += weight;
      if (result.parity === "odd") odd += weight;
      if (result.parity === "even") even += weight;
    });
    if (historicalItems.length) {
      const counts = { big: 0, small: 0, odd: 0, even: 0, triple: 0 };
      historicalItems.forEach((record) => {
        const result = classify(record.officialDice);
        if (result.size) counts[result.size] += 1;
        counts[result.parity] += 1;
        if (result.triple) counts.triple += 1;
      });
      const sizeTotal = counts.big + counts.small;
      if (sizeTotal) {
        big += HISTORY_PRIOR_ROUNDS * counts.big / sizeTotal;
        small += HISTORY_PRIOR_ROUNDS * counts.small / sizeTotal;
      }
      odd += HISTORY_PRIOR_ROUNDS * counts.odd / historicalItems.length;
      even += HISTORY_PRIOR_ROUNDS * counts.even / historicalItems.length;
      triples += HISTORY_PRIOR_ROUNDS * counts.triple / historicalItems.length;
      total += HISTORY_PRIOR_ROUNDS;
    }
    const sizeProbability = (PRIOR_SIDE + big) / (PRIOR_SIDE * 2 + big + small);
    const parityProbability = (PRIOR_SIDE + odd) / (PRIOR_SIDE * 2 + odd + even);
    return {
      big: sizeProbability,
      small: 1 - sizeProbability,
      odd: parityProbability,
      even: 1 - parityProbability,
      triple: (TRIPLE_PRIOR_HITS + triples) / (TRIPLE_PRIOR_TOTAL + total),
    };
  }

  function diceBiasModel(items, historicalItems) {
    const counts = Array.from({ length: 3 }, () => Array(6).fill(0));
    items.forEach((record) => record.officialDice.forEach((value, position) => {
      counts[position][Number(value) - 1] += 1;
    }));
    if (historicalItems.length) {
      const historicalCounts = Array.from({ length: 3 }, () => Array(6).fill(0));
      historicalItems.forEach((record) => record.officialDice.forEach((value, position) => {
        historicalCounts[position][Number(value) - 1] += 1;
      }));
      historicalCounts.forEach((positionCounts, position) => positionCounts.forEach((count, face) => {
        counts[position][face] += HISTORY_PRIOR_ROUNDS * count / historicalItems.length;
      }));
    }
    const probabilities = counts.map((positionCounts) => {
      const total = positionCounts.reduce((sum, count) => sum + count, 0) + DICE_PRIOR_FACE * 6;
      return positionCounts.map((count) => (count + DICE_PRIOR_FACE) / total);
    });
    let big = 0;
    let small = 0;
    let odd = 0;
    let even = 0;
    let triple = 0;
    for (let first = 1; first <= 6; first += 1) {
      for (let second = 1; second <= 6; second += 1) {
        for (let third = 1; third <= 6; third += 1) {
          const probability = probabilities[0][first - 1] * probabilities[1][second - 1] * probabilities[2][third - 1];
          const result = classify([first, second, third]);
          if (result.size === "big") big += probability;
          if (result.size === "small") small += probability;
          if (result.parity === "odd") odd += probability;
          if (result.parity === "even") even += probability;
          if (result.triple) triple += probability;
        }
      }
    }
    const sizeTotal = big + small;
    return {
      big: sizeTotal ? big / sizeTotal : 0.5,
      small: sizeTotal ? small / sizeTotal : 0.5,
      odd,
      even,
      triple,
    };
  }

  function pooledDiceBiasModel(items, historicalItems) {
    const counts = Array(6).fill(0);
    items.forEach((record) => record.officialDice.forEach((value) => {
      counts[Number(value) - 1] += 1;
    }));
    if (historicalItems.length) {
      const historicalCounts = Array(6).fill(0);
      historicalItems.forEach((record) => record.officialDice.forEach((value) => {
        historicalCounts[Number(value) - 1] += 1;
      }));
      historicalCounts.forEach((count, face) => {
        counts[face] += HISTORY_PRIOR_ROUNDS * 3 * count / (historicalItems.length * 3);
      });
    }
    const total = counts.reduce((sum, count) => sum + count, 0) + DICE_PRIOR_FACE * 6;
    const probabilities = counts.map((count) => (count + DICE_PRIOR_FACE) / total);
    let big = 0;
    let small = 0;
    let odd = 0;
    let even = 0;
    let triple = 0;
    for (let first = 1; first <= 6; first += 1) {
      for (let second = 1; second <= 6; second += 1) {
        for (let third = 1; third <= 6; third += 1) {
          const probability = probabilities[first - 1] * probabilities[second - 1] * probabilities[third - 1];
          const result = classify([first, second, third]);
          if (result.size === "big") big += probability;
          if (result.size === "small") small += probability;
          if (result.parity === "odd") odd += probability;
          if (result.parity === "even") even += probability;
          if (result.triple) triple += probability;
        }
      }
    }
    const sizeTotal = big + small;
    return {
      big: sizeTotal ? big / sizeTotal : 0.5,
      small: sizeTotal ? small / sizeTotal : 0.5,
      odd,
      even,
      triple,
    };
  }

  function predictionAvailable(record, key) {
    const prediction = record.modelPredictions?.[key];
    return Number.isFinite(Number(prediction?.big))
      && Number.isFinite(Number(prediction?.odd))
      && Number.isFinite(Number(prediction?.triple));
  }

  function ensembleWeights(items, metric) {
    const losses = Object.fromEntries(BASE_MODEL_KEYS.map((key) => [key, 0]));
    items.filter((record) => BASE_MODEL_KEYS.every((key) => predictionAvailable(record, key))).forEach((record) => {
      const result = classify(record.officialDice);
      BASE_MODEL_KEYS.forEach((key) => {
        losses[key] += ModelCore.metricBrierLoss(record.modelPredictions[key], result, metric);
      });
    });
    const bestLoss = Math.min(...Object.values(losses));
    const raw = Object.fromEntries(BASE_MODEL_KEYS.map((key) => [key, Math.exp(-ENSEMBLE_ETA * (losses[key] - bestLoss))]));
    const total = Object.values(raw).reduce((sum, weight) => sum + weight, 0);
    return Object.fromEntries(BASE_MODEL_KEYS.map((key) => [key, raw[key] / total]));
  }

  function weightedProbability(predictions, weights, field) {
    return BASE_MODEL_KEYS.reduce((sum, key) => sum + predictions[key][field] * weights[key], 0);
  }

  function shadowPredictions(items) {
    const historicalItems = historicalPriorItems(items);
    const predictions = {
      baseline: { big: 0.5, small: 0.5, odd: 0.5, even: 0.5, triple: 1 / 36 },
      static: bayesModel(items, false, historicalItems),
      dynamic: bayesModel(items, true, historicalItems),
      diceBias: diceBiasModel(items, historicalItems),
      pooledBias: pooledDiceBiasModel(items, historicalItems),
    };
    const sizeWeights = ensembleWeights(items, "size");
    const parityWeights = ensembleWeights(items, "parity");
    const big = weightedProbability(predictions, sizeWeights, "big");
    const odd = weightedProbability(predictions, parityWeights, "odd");
    const triple = weightedProbability(predictions, sizeWeights, "triple");
    predictions.ensemble = { big, small: 1 - big, odd, even: 1 - odd, triple };
    return predictions;
  }

  function pairPercent(probability) {
    const first = Math.round(probability * 1000) / 10;
    return [first, Math.round((100 - first) * 10) / 10];
  }

  function predictionText(prediction) {
    if (!prediction) return "旧记录未保存模型值";
    const size = pairPercent(Number(prediction.big));
    const parity = pairPercent(Number(prediction.odd));
    const prefix = prediction.modelKeys
      ? `大小${modelName(prediction.modelKeys.size)} / 单双${modelName(prediction.modelKeys.parity)} · `
      : prediction.modelKey ? `${modelName(prediction.modelKey)} · ` : "";
    return `${prefix}大 ${size[0].toFixed(1)}% · 小 ${size[1].toFixed(1)}% · 单 ${parity[0].toFixed(1)}% · 双 ${parity[1].toFixed(1)}%`;
  }

  function hasComparablePredictions(record) {
    return record.evidenceInvalidated !== true
      && !invalidatedSessions.has(record.sessionId)
      && validModelBlock(record)
      && MODEL_DEFINITIONS.every(({ key }) => predictionAvailable(record, key));
  }

  function evaluateModels(items) {
    const comparable = items.filter(hasComparablePredictions);
    const models = {};
    MODEL_DEFINITIONS.forEach(({ key }) => {
      let sizeError = 0;
      let sizeCount = 0;
      let parityError = 0;
      let parityCount = 0;
      let hits = 0;
      let decisions = 0;
      comparable.forEach((record) => {
        const prediction = record.modelPredictions[key];
        const result = classify(record.officialDice);
        const sizeDirection = ModelCore.directionObservation(prediction, result, "size");
        if (sizeDirection.decided) {
          decisions += 1;
          if (sizeDirection.won) hits += 1;
        }
        sizeError += ModelCore.metricBrierLoss(prediction, result, "size");
        sizeCount += 1;
        const parityDirection = ModelCore.directionObservation(prediction, result, "parity");
        if (parityDirection.decided) {
          decisions += 1;
          if (parityDirection.won) hits += 1;
        }
        parityError += ModelCore.metricBrierLoss(prediction, result, "parity");
        parityCount += 1;
      });
      const observations = sizeCount + parityCount;
      models[key] = {
        key,
        size: sizeCount ? sizeError / sizeCount : null,
        parity: parityCount ? parityError / parityCount : null,
        combined: observations ? (sizeError + parityError) / observations : null,
        hitRate: decisions ? hits / decisions : null,
        decisions,
      };
    });
    return { rounds: comparable.length, models };
  }

  function selectActiveModel(evaluation, metric, excludedKey = null) {
    if (evaluation.rounds < VALIDATION_BLOCK_SIZE) return "baseline";
    const baseline = evaluation.models.baseline[metric];
    const candidates = MODEL_DEFINITIONS.filter(({ key }) => key !== "baseline").map(({ key }) => evaluation.models[key])
      .filter((model) => model.key !== excludedKey)
      .filter((model) => Number.isFinite(model[metric]))
      .sort((first, second) => first[metric] - second[metric]);
    return candidates[0]?.[metric] < baseline ? candidates[0].key : "baseline";
  }

  function savedModelKeys(record) {
    const saved = record?.modelPrediction?.modelKeys;
    if (saved && MODEL_DEFINITIONS.some(({ key }) => key === saved.size) && MODEL_DEFINITIONS.some(({ key }) => key === saved.parity)) {
      return { size: saved.size, parity: saved.parity };
    }
    const legacyKey = record?.modelPrediction?.modelKey;
    if (MODEL_DEFINITIONS.some(({ key }) => key === legacyKey)) return { size: legacyKey, parity: legacyKey };
    return { size: "baseline", parity: "baseline" };
  }

  function blockImprovement(blockItems, modelKey, metric) {
    const differences = [];
    blockItems.forEach((record) => {
      if (!hasComparablePredictions(record)) return;
      const result = classify(record.officialDice);
      differences.push(ModelCore.brierImprovement(
        record.modelPredictions.baseline,
        record.modelPredictions[modelKey],
        result,
        metric,
      ));
    });
    return differences.length ? differences.reduce((sum, value) => sum + value, 0) / differences.length : null;
  }

  function blockRecords(items, blockIndex) {
    return items.filter(hasComparablePredictions)
      .filter((record) => record.modelBlock.index === blockIndex)
      .sort((first, second) => first.modelBlock.position - second.modelBlock.position);
  }

  function completeBlockRecords(items, blockIndex) {
    const blockItems = blockRecords(items, blockIndex);
    if (blockItems.length !== VALIDATION_BLOCK_SIZE) return [];
    const blockIds = new Set(blockItems.map((record) => record.modelBlock.id));
    const positions = blockItems.map((record) => record.modelBlock.position);
    const expected = Array.from({ length: VALIDATION_BLOCK_SIZE }, (_, index) => index);
    if (blockIds.size !== 1 || positions.some((position, index) => position !== expected[index])) return [];
    return blockItems;
  }

  function blockModelKey(blockItems, metric) {
    if (!blockItems.length) return null;
    const modelKey = blockItems[0].modelBlock.lockedModelKeys[metric];
    return blockItems.every((record) => record.modelBlock.lockedModelKeys[metric] === modelKey) ? modelKey : null;
  }

  function validationStreak(items, blockIndex, modelKey, metric) {
    if (modelKey === "baseline") return 0;
    let streak = 0;
    for (let index = blockIndex - 1; index >= 1; index -= 1) {
      const blockItems = completeBlockRecords(items, index);
      if (!blockItems.length || blockModelKey(blockItems, metric) !== modelKey) break;
      if (!(blockImprovement(blockItems, modelKey, metric) > 0)) break;
      streak += 1;
    }
    return streak;
  }

  function nextBlockModel(items, evaluation, blockIndex, metric) {
    if (blockIndex === 0) return "baseline";
    if (blockIndex > 1) {
      const previousBlock = completeBlockRecords(items, blockIndex - 1);
      const previousKey = blockModelKey(previousBlock, metric);
      if (previousKey && previousKey !== "baseline" && blockImprovement(previousBlock, previousKey, metric) > 0) return previousKey;
      if (previousKey && previousKey !== "baseline") return selectActiveModel(evaluation, metric, previousKey);
    }
    return selectActiveModel(evaluation, metric);
  }

  function resolveActiveBlock(items, evaluation, blockIndex) {
    const savedBlock = session.activeProtocolBlock;
    if (savedBlock?.protocolVersion === MODEL_PROTOCOL_VERSION
      && savedBlock.index === blockIndex
      && validLockedModelKeys(savedBlock.lockedModelKeys)) return savedBlock;

    const currentRecords = blockRecords(items, blockIndex);
    const currentKeys = currentRecords.length ? currentRecords[0].modelBlock.lockedModelKeys : null;
    const consistentKeys = currentKeys && currentRecords.every((record) => (
      record.modelBlock.lockedModelKeys.size === currentKeys.size
      && record.modelBlock.lockedModelKeys.parity === currentKeys.parity
    )) ? currentKeys : null;
    const lockedModelKeys = consistentKeys || {
      size: nextBlockModel(items, evaluation, blockIndex, "size"),
      parity: nextBlockModel(items, evaluation, blockIndex, "parity"),
    };
    const activeBlock = {
      protocolVersion: MODEL_PROTOCOL_VERSION,
      id: `${session.id}-v${MODEL_PROTOCOL_VERSION}-block-${blockIndex}`,
      index: blockIndex,
      lockedModelKeys: { ...lockedModelKeys },
    };
    return activeBlock;
  }

  function lockedBlockState(items, evaluation) {
    const round = session.nextProtocolRound;
    const position = round % VALIDATION_BLOCK_SIZE;
    const index = Math.floor(round / VALIDATION_BLOCK_SIZE);
    const activeBlock = resolveActiveBlock(items, evaluation, index);
    const activeKeys = activeBlock.lockedModelKeys;
    const validationStreaks = {
      size: validationStreak(items, index, activeKeys.size, "size"),
      parity: validationStreak(items, index, activeKeys.parity, "parity"),
    };
    return { id: activeBlock.id, round, index, position, activeKeys, validationStreaks };
  }

  function lockedValidationPoints(items, metric) {
    const blockIndexes = [...new Set(items.filter(hasComparablePredictions).map((record) => record.modelBlock.index))]
      .filter((index) => index >= 1)
      .sort((first, second) => first - second);
    const points = [];
    blockIndexes.forEach((blockIndex) => {
      const completed = completeBlockRecords(items, blockIndex);
      const modelKey = blockModelKey(completed, metric);
      if (!completed.length || !modelKey || modelKey === "baseline") return;
      completed.forEach((record) => {
        const result = classify(record.officialDice);
        const prediction = record.modelPredictions[modelKey];
        points.push({
          modelKey,
          improvement: ModelCore.brierImprovement(record.modelPredictions.baseline, prediction, result, metric),
          direction: ModelCore.directionObservation(prediction, result, metric),
        });
      });
    });
    return points;
  }

  function brierEvidence(items, metric) {
    const values = lockedValidationPoints(items, metric).map((point) => point.improvement);
    const evidence = ModelCore.boundedMeanEValue(values);
    return { count: values.length, mean: evidence.mean, eValue: evidence.value };
  }

  function crossSessionSummary() {
    const groups = new Map();
    records.forEach((record) => {
      if (!record.sessionId || !hasComparablePredictions(record)) return;
      if (!groups.has(record.sessionId)) groups.set(record.sessionId, []);
      groups.get(record.sessionId).push(record);
    });
    const wins = {
      size: Object.fromEntries(MODEL_DEFINITIONS.map(({ key }) => [key, 0])),
      parity: Object.fromEntries(MODEL_DEFINITIONS.map(({ key }) => [key, 0])),
    };
    let qualified = 0;
    groups.forEach((items) => {
      const evaluation = evaluateModels(items);
      if (evaluation.rounds < 40) return;
      qualified += 1;
      wins.size[selectActiveModel(evaluation, "size")] += 1;
      wins.parity[selectActiveModel(evaluation, "parity")] += 1;
    });
    const stable = {};
    ["size", "parity"].forEach((metric) => {
      const winner = MODEL_DEFINITIONS.map(({ key }) => key).filter((key) => key !== "baseline")
        .sort((first, second) => wins[metric][second] - wins[metric][first])[0];
      stable[metric] = qualified >= 3 && wins[metric][winner] >= 3 && wins[metric][winner] / qualified >= 0.6 ? winner : null;
    });
    return { qualified, wins, stable };
  }

  function confidenceState(items, metric) {
    const evidence = brierEvidence(items, metric);
    let label = "收集中";
    if (evidence.count >= VALIDATION_BLOCK_SIZE) {
      if (!(evidence.mean > 0)) label = "未优于基准";
      else if (evidence.eValue >= TRIAL_E_VALUE_THRESHOLD) label = "序贯优势";
      else label = "优势未确认";
    }
    return { evidence, label };
  }

  function directionEvidence(items, metric) {
    const observations = lockedValidationPoints(items, metric)
      .map((point) => point.direction)
      .filter((direction) => direction.decided);
    const hits = observations.filter((direction) => direction.won).length;
    const profitEvidence = ModelCore.oneSidedBernoulliEValue(hits, observations.length, BREAK_EVEN_PROBABILITY);
    const fairProbability = metric === "size"
      ? ModelCore.FAIR_SIZE_WIN_PROBABILITY
      : ModelCore.FAIR_PARITY_WIN_PROBABILITY;
    const fairEvidence = ModelCore.oneSidedBernoulliEValue(hits, observations.length, fairProbability);
    return {
      hits,
      count: observations.length,
      rate: observations.length ? hits / observations.length : null,
      profitEValue: profitEvidence.value,
      fairEValue: fairEvidence.value,
    };
  }

  function metricChangeState(items, metric) {
    const values = [...items].reverse().map((record) => {
      const result = classify(record.officialDice);
      if (metric === "size" && result.triple) return null;
      return metric === "size" ? (result.size === "big" ? 1 : 0) : (result.parity === "odd" ? 1 : 0);
    }).filter((value) => value !== null);
    const needed = CUSUM_REFERENCE_SIZE + CUSUM_RECENT_SIZE;
    if (values.length < needed) return { active: false, score: 0, samples: values.length };
    const reference = values.slice(-needed, -CUSUM_RECENT_SIZE);
    const recent = values.slice(-CUSUM_RECENT_SIZE);
    const referenceRate = (reference.reduce((sum, value) => sum + value, 0) + 5) / (reference.length + 10);
    const deviation = Math.sqrt(referenceRate * (1 - referenceRate));
    let positive = 0;
    let negative = 0;
    let score = 0;
    recent.forEach((value) => {
      const standardized = (value - referenceRate) / deviation;
      positive = Math.max(0, positive + standardized - CUSUM_ALLOWANCE);
      negative = Math.min(0, negative + standardized + CUSUM_ALLOWANCE);
      score = Math.max(score, positive, -negative);
    });
    return { active: score >= CUSUM_THRESHOLD, score, samples: values.length };
  }

  function changeState(items) {
    return {
      size: metricChangeState(items, "size"),
      parity: metricChangeState(items, "parity"),
    };
  }

  function signalState(items, state, metric) {
    const firstLabel = metric === "size" ? "大" : "单";
    const secondLabel = metric === "size" ? "小" : "双";
    const modelKey = state.activeKeys[metric];
    const sizeProbabilities = ModelCore.sizeClassProbabilities(state.active);
    const firstProbability = metric === "size" ? sizeProbabilities.big : state.active.odd;
    const secondProbability = metric === "size" ? sizeProbabilities.small : state.active.even;
    const actualWinProbability = Math.max(firstProbability, secondProbability);
    const calibrationEvidence = brierEvidence(items, metric);
    const winEvidence = directionEvidence(items, metric);
    const direction = firstProbability >= secondProbability ? firstLabel : secondLabel;
    const streak = state.block.validationStreaks[metric];
    const changing = state.changes[metric].active;
    const issued = !changing
      && modelKey !== "baseline"
      && streak >= 1
      && calibrationEvidence.count >= VALIDATION_BLOCK_SIZE
      && calibrationEvidence.mean > 0
      && actualWinProbability > BREAK_EVEN_PROBABILITY
      && winEvidence.count >= VALIDATION_BLOCK_SIZE
      && winEvidence.profitEValue >= TRIAL_E_VALUE_THRESHOLD;
    const stable = issued
      && streak >= 2
      && winEvidence.profitEValue >= STABLE_E_VALUE_THRESHOLD
      && calibrationEvidence.eValue >= TRIAL_E_VALUE_THRESHOLD;
    let label = "观望";
    if (changing) label = "变化中 · 观望";
    else if (modelKey !== "baseline" && streak < 1) label = "验证中 · 观望";
    else if (issued) label = `${direction} · ${stable ? "稳定信号" : "试验信号"}`;
    return {
      issued,
      stable,
      direction: issued ? direction : null,
      label,
      modelKey,
      probability: actualWinProbability,
      breakEven: BREAK_EVEN_PROBABILITY,
      validationStreak: streak,
      brierMean: calibrationEvidence.mean,
      brierEValue: calibrationEvidence.eValue,
      evidenceCount: winEvidence.count,
      evidenceHits: winEvidence.hits,
      evidenceRate: winEvidence.rate,
      profitEValue: winEvidence.profitEValue,
      fairEValue: winEvidence.fairEValue,
    };
  }

  function signalMetrics(items, metric) {
    let eligible = 0;
    let decisions = 0;
    let hits = 0;
    items.filter(hasComparablePredictions).forEach((record) => {
      const saved = record.modelPrediction?.signals?.[metric];
      if (!saved || typeof saved.issued !== "boolean") return;
      const result = classify(record.officialDice);
      eligible += 1;
      if (!saved.issued) return;
      decisions += 1;
      const actual = metric === "size" ? LABELS[result.size] : LABELS[result.parity];
      if (saved.direction === actual) hits += 1;
    });
    return {
      eligible,
      decisions,
      hits,
      coverage: eligible ? decisions / eligible : null,
      hitRate: decisions ? hits / decisions : null,
    };
  }

  function currentModelState(items) {
    const predictions = shadowPredictions(items);
    const evaluation = evaluateModels(items);
    const block = lockedBlockState(items, evaluation);
    const activeKeys = block.activeKeys;
    const sizePrediction = predictions[activeKeys.size];
    const parityPrediction = predictions[activeKeys.parity];
    const active = {
      big: sizePrediction.big,
      small: sizePrediction.small,
      odd: parityPrediction.odd,
      even: parityPrediction.even,
      triple: sizePrediction.triple,
    };
    const crossSession = crossSessionSummary();
    const changes = changeState(items);
    const signalContext = { activeKeys, active, block, changes };
    const signals = {
      size: signalState(items, signalContext, "size"),
      parity: signalState(items, signalContext, "parity"),
    };
    return { predictions, evaluation, block, activeKeys, active, signals, crossSession, changes };
  }

  function loadArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }

  function pendingForecast() {
    return forecastLedger.find((entry) => entry.status === "locked" && !invalidatedSessions.has(entry.sessionId)
      && !records.some((record) => record.forecast?.id === entry.id)) || null;
  }

  function inputFingerprint() {
    return records.map((record) => record.id + ":" + record.officialDice.join("")).join("|");
  }

  function ensureV5Storage() {
    if (localStorage.getItem(STORAGE_KEY) !== null) return;
    saveBankrollState();
    saveInvalidatedSessions();
    touchSession();
    saveRecords();
  }

  function readStreamers() {
    return [...els.streamerInputs.querySelectorAll(".streamer-row")].map((row) => ({
      name: row.querySelector("[data-streamer-name]").value.trim(),
      size: row.querySelector("[data-streamer-size]").value,
      parity: row.querySelector("[data-streamer-parity]").value,
    })).filter((entry) => entry.name);
  }

  function renderStreamers(entries) {
    els.streamerInputs.innerHTML = entries.slice(0, 2).map((entry) => {
      const options = (values, chosen) => values.map(([value, label]) => '<option value="' + value + '"' + (chosen === value ? " selected" : "") + ">" + label + "</option>").join("");
      return '<div class="streamer-row"><input data-streamer-name aria-label="主播名称" maxlength="24" placeholder="主播名称" value="' + escapeHtml(entry.name || "") + '" />'
        + '<select data-streamer-size aria-label="主播大小判断">' + options([["none", "大小观望"], ["big", "大"], ["small", "小"]], entry.size || "none") + "</select>"
        + '<select data-streamer-parity aria-label="主播单双判断">' + options([["none", "单双观望"], ["odd", "单"], ["even", "双"]], entry.parity || "none") + "</select>"
        + '<button type="button" class="text-button" data-remove-streamer aria-label="移除主播">移除</button></div>';
    }).join("");
    els.addStreamer.disabled = entries.length >= 2 || Boolean(pendingForecast());
  }

  function buildLegacyFields(items) {
    const state = currentModelState(items);
    const predictions = Object.fromEntries(Object.entries(state.predictions).map(([key, value]) => [key, { ...value, basedOn: items.length }]));
    return {
      modelProtocolVersion: MODEL_PROTOCOL_VERSION,
      modelBlock: {
        protocolVersion: MODEL_PROTOCOL_VERSION, id: state.block.id, round: state.block.round,
        index: state.block.index, position: state.block.position,
        role: state.block.index === 0 ? "selection" : "validation",
        lockedModelKeys: { ...state.activeKeys },
      },
      modelPredictions: predictions,
      modelPrediction: { ...state.active, basedOn: items.length, modelKeys: state.activeKeys, signals: state.signals },
    };
  }

  function readParticipation() {
    const mode = els.participationMode.value;
    const selection = mode === "observe" ? "none" : els.quickBetSelection.value;
    const stake = els.quickStake.value === "" || mode === "observe" ? null : roundMoney(Number(els.quickStake.value));
    if (mode !== "observe" && selection === "none") throw new Error("请先选择本轮方向，或将参与方式设为观望。");
    if (stake !== null && (!Number.isFinite(stake) || stake < 2)) throw new Error("填写金额时最低为 2 元。");
    if (mode === "simulate" && stake !== null && (!bankroll || stake > currentBalance())) throw new Error("请先设置足够的模拟本金，或留空金额只验证方向。");
    return { mode, selection, stake };
  }

  function hasSequenceGap(latest) {
    return Boolean(latest && forecastLedger.some((entry) => entry.status === "missed"
      && entry.sessionId === latest.sessionId && Date.parse(entry.missedAt) >= Date.parse(latest.createdAt)));
  }

  function liveItems(items = records) {
    return items.map((record, index) => ({ ...record,
      evidenceInvalidated: record.evidenceInvalidated === true || invalidatedSessions.has(record.sessionId),
      nextIsUnknown: index === 0 && hasSequenceGap(record),
    }));
  }

  async function lockNextForecast() {
    try {
      await withStorageWriteLock(() => {
        syncStoredState();
        if (pendingForecast()) throw new Error("已有待开奖预判，请先记录结果或跳过该期。");
        if (els.quickResult.value.trim()) throw new Error("请先记录输入框中的开奖结果，再锁定下一期。");
        const issue = els.quickIssue.value.trim();
        if (!issue) throw new Error("请填写待开奖期号，确保主播判断与结果属于同一期。");
        if (records.some((record) => record.issue === issue)) throw new Error("该期号已有记录，请使用含日期的完整期号。");
        if (forecastLedger.some((entry) => entry.issue === issue)) throw new Error("该期号已有锁定或跳过记录，请勿重复验证。");
        const unnamed = [...els.streamerInputs.querySelectorAll(".streamer-row")].some((row) => (
          !row.querySelector("[data-streamer-name]").value.trim()
          && [row.querySelector("[data-streamer-size]"), row.querySelector("[data-streamer-parity]")].some((input) => input.value !== "none")
        ));
        if (unnamed) throw new Error("请给已有判断的主播填写名称。");
        const streamers = readStreamers();
        if (new Set(streamers.map((entry) => entry.name)).size !== streamers.length) throw new Error("主播名称不能重复。");
        const participation = readParticipation();
        const items = sessionRecords();
        const legacyFields = buildLegacyFields(items);
        const forecast = LiveModel.forecast(liveItems(items), streamers, legacyFields.modelPrediction);
        const lockedAt = new Date().toISOString();
        const entry = {
          ...forecast, id: "forecast-" + Date.now() + "-" + Math.random().toString(16).slice(2),
          status: "locked", issue, sessionId: session.id, lockedAt,
          fingerprint: inputFingerprint(), streamers, participation, legacyFields,
        };
        ensureV5Storage();
        touchSession();
        localStorage.setItem(STREAMERS_KEY, JSON.stringify(streamers.map((value) => ({ name: value.name }))));
        const updated = [entry, ...forecastLedger];
        localStorage.setItem(LEDGER_KEY, JSON.stringify(updated));
        forecastLedger = updated;
        renderAll();
        els.preRoundOptions.open = false;
        els.quickMessage.className = "form-message success";
        els.quickMessage.textContent = "第 " + issue + " 期已锁定。开奖后输入三个数字即可验证。";
        els.quickResult.focus();
      });
    } catch (error) {
      els.quickMessage.className = "form-message";
      els.quickMessage.textContent = error.message || "锁定失败，请重试。";
    }
  }

  async function skipPendingForecast() {
    try {
      await withStorageWriteLock(() => {
        syncStoredState();
        const pending = pendingForecast();
        if (!pending) return;
        const updated = forecastLedger.map((entry) => entry.id === pending.id ? { ...entry, status: "missed", missedAt: new Date().toISOString() } : entry);
        localStorage.setItem(LEDGER_KEY, JSON.stringify(updated));
        forecastLedger = updated;
        els.quickIssue.value = "";
        renderStreamers(loadArray(STREAMERS_KEY));
        renderAll();
        els.quickMessage.className = "form-message";
        els.quickMessage.textContent = "已保留本期未录到的记录；漏期不会伪装成完整验证。";
      });
    } catch (error) { els.quickMessage.textContent = error.message || "操作失败，请重试。"; }
  }

  function renderModel() {
    const items = sessionRecords();
    const pending = pendingForecast();
    if (pending && renderedPendingId !== pending.id) {
      renderStreamers(pending.streamers);
      els.participationMode.value = pending.participation.mode;
      els.quickBetSelection.value = pending.participation.selection;
      els.quickStake.value = pending.participation.stake ?? "";
      renderedPendingId = pending.id;
    } else if (!pending && renderedPendingId) {
      renderStreamers(loadArray(STREAMERS_KEY));
      els.quickIssue.value = "";
      els.participationMode.value = "observe";
      els.quickBetSelection.value = "none";
      els.quickStake.value = "";
      renderedPendingId = null;
    }
    const forecast = pending || LiveModel.forecast(liveItems(items), readStreamers());
    const model = forecast.candidates.live;
    const size = pairPercent(model.big), parity = pairPercent(model.odd);
    const evalCurrent = LiveModel.evaluate(liveItems(items));
    els.sessionStatus.textContent = "本场 " + items.length + " 轮";
    els.modelSample.textContent = "提前验证 " + evalCurrent.count + " 轮";
    els.modelConfidence.textContent = pending ? "第 " + pending.issue + " 期 · 已锁定" : items.length < 10 ? "再记 " + (10 - items.length) + " 轮，开始方向参考" : "随每轮结果更新";
    els.probBig.textContent = size[0].toFixed(1) + "%";
    els.probSmall.textContent = size[1].toFixed(1) + "%";
    els.probOdd.textContent = parity[0].toFixed(1) + "%";
    els.probEven.textContent = parity[1].toFixed(1) + "%";
    els.barBig.style.width = size[0] + "%";
    els.barOdd.style.width = parity[0] + "%";
    const statusLabels = { warmup: "准备中", balanced: "接近均衡", changing: "变化中 · 观望", conflict: "分歧较大 · 观望" };
    for (const [metric, badge, note] of [["size", els.signalSize, els.sizeReason], ["parity", els.signalParity, els.parityReason]]) {
      const decision = forecast.decisions[metric];
      badge.textContent = decision.issued ? "参考偏" + LABELS[decision.direction] : statusLabels[decision.status];
      badge.className = decision.issued ? "signal-badge active" : "signal-badge";
      note.textContent = decision.reason;
      badge.closest(".model-pair").querySelectorAll(".model-pair-values > div").forEach((cell, index) => {
        const selected = metric === "size" ? ["big", "small"][index] : ["odd", "even"][index];
        cell.classList.toggle("favored", decision.direction === selected);
      });
    }
    const active = ["size", "parity"].filter((metric) => forecast.decisions[metric].issued);
    els.modelNote.textContent = active.length
      ? active.map((metric) => (metric === "size" ? "大小" : "单双") + "偏" + LABELS[forecast.decisions[metric].direction]).join(" · ") + "。仅作参考，尚未证明有优势。"
      : items.length < 10 ? "记录可立即开始；满 10 轮显示方向参考。" : "本轮暂无清晰方向，下一轮重新评估。";
    els.modelValidation.textContent = evalCurrent.count ? "本场已验证 " + evalCurrent.count + " 轮" : "补录不计提前验证";
    const actual = ModelCore.sizeClassProbabilities(model);
    els.actualProbabilities.textContent = "含三同号后的模型估计：大 " + (actual.big * 100).toFixed(1) + "%，小 " + (actual.small * 100).toFixed(1) + "%，三同号 " + (actual.triple * 100).toFixed(1) + "%。上方大小是排除三同号后的相对比例。";
    els.pendingStatus.textContent = pending
      ? "已于 " + new Date(pending.lockedAt).toLocaleTimeString("zh-CN", { hour12: false }) + " 锁定；期号、主播和选择均不可事后修改。"
      : "开奖前锁定才计入验证；也可直接输入结果作补录。";
    els.lockForecast.disabled = Boolean(pending) || savingResult || Boolean(els.quickResult.value.trim());
    els.skipForecast.classList.toggle("hidden", !pending);
    els.quickIssue.disabled = Boolean(pending);
    if (pending) els.quickIssue.value = pending.issue;
    els.preRoundOptions.querySelectorAll("input, select, button").forEach((input) => { input.disabled = Boolean(pending); });
    els.addStreamer.disabled = Boolean(pending) || els.streamerInputs.children.length >= 2;
    if (!pending) {
      const enabled = els.participationMode.value !== "observe";
      els.quickBetSelection.disabled = !enabled;
      els.quickStake.disabled = !enabled || els.quickBetSelection.value === "none";
    }
    els.quickStakeHint.textContent = els.participationMode.value === "actual"
      ? "只记录实际选择，不影响模拟本金；本页面不执行投注。"
      : els.participationMode.value === "simulate"
        ? (bankroll ? "模拟余额 " + formatMoney(currentBalance()) + "。" : "填金额前请在验证与记录中设置模拟本金。") + "金额也可留空，只验证方向。"
        : "实际与模拟分别统计；本页面不执行投注。";
    const latest = records[0];
    if (!latest) els.lastFeedback.textContent = "录入结果后，在这里查看上一期反馈。";
    else if (!LiveModel.isEvaluable(liveItems([latest])[0])) els.lastFeedback.textContent = resultLabel(classify(latest.officialDice)) + " · 补录或失效记录，不计提前验证";
    else {
      const actualResult = classify(latest.officialDice);
      const feedback = ["size", "parity"].map((metric) => {
        const direction = latest.forecast.decisions[metric].direction;
        return (metric === "size" ? "大小" : "单双") + (direction ? actualResult[metric] === direction ? "命中" : "未命中" : "观望");
      });
      els.lastFeedback.textContent = "上期 " + latest.issue + "：" + feedback.join(" · ");
    }
  }

  function roundMoney(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function formatMoney(value, signed = false) {
    const amount = roundMoney(value);
    const formatted = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(Math.abs(amount));
    if (!signed || amount === 0) return formatted;
    return `${amount > 0 ? "+" : "−"}${formatted}`;
  }

  function totalNet() {
    return roundMoney(records.reduce((total, record) => total + (Number(record.bet?.net) || 0), 0));
  }

  function currentBalance() {
    return bankroll ? roundMoney(bankroll.initial + totalNet()) : null;
  }

  function minimumInitialForHistory() {
    let cumulativeNet = 0;
    let required = 2;
    [...records].reverse().forEach((record) => {
      if (!record.bet) return;
      required = Math.max(required, Number(record.bet.stake) - cumulativeNet);
      cumulativeNet = roundMoney(cumulativeNet + Number(record.bet.net));
    });
    return roundMoney(required);
  }

  function balanceAfterEachRecord() {
    const balances = new Map();
    if (!bankroll) return balances;
    let balance = bankroll.initial;
    [...records].reverse().forEach((record) => {
      balance = roundMoney(balance + (Number(record.bet?.net) || 0));
      balances.set(record.id, balance);
    });
    return balances;
  }

  function betForResult(result, participation) {
    if (!participation || participation.selection === "none") return { bet: null, participation: participation || { mode: "observe", selection: "none", stake: null } };
    const { mode, selection, stake } = participation;
    const dimension = ["big", "small"].includes(selection) ? "size" : "parity";
    const won = selection === result[dimension];
    const payout = stake === null ? null : won ? roundMoney(stake * ODDS) : 0;
    const net = stake === null ? null : roundMoney(payout - stake);
    const settled = { ...participation, dimension, won, payout, net, odds: ODDS };
    if (mode !== "simulate" || stake === null) return { bet: null, participation: settled };
    if (!bankroll || stake > currentBalance()) throw new Error("模拟余额不足。请先在更多工具中调整模拟本金，再记录本期。");
    return { bet: { ...settled, outcome: result[dimension] }, participation: settled };
  }

  function saveQuickResultLocked(expectedForecastId) {
    els.quickMessage.className = "form-message";
    const dice = parseQuickDice(els.quickResult.value);
    if (!dice) { els.quickMessage.textContent = "请输入三个 1–6 的数字。"; return; }
    ensureSession();
    const pending = pendingForecast();
    if ((pending?.id || null) !== expectedForecastId) throw new Error("另一页面更新了待开奖预判，请核对当前期号后再记录结果。");
    const issue = pending?.issue || els.quickIssue.value.trim();
    if (issue && records.some((record) => record.issue === issue)) throw new Error("该期号已有记录，请核对后使用完整期号。");
    if (pending && pending.fingerprint !== inputFingerprint()) throw new Error("锁定后历史数据已变化，请先跳过该期并留痕，再将结果补录。");
    const result = classify(dice);
    const settlement = betForResult(result, pending?.participation);
    const legacyFields = pending?.legacyFields || buildLegacyFields(sessionRecords());
    const reference = pending || LiveModel.forecast(liveItems(sessionRecords()), [], legacyFields.modelPrediction);
    const entry = {
      id: "result-" + Date.now() + "-" + Math.random().toString(16).slice(2),
      issue, officialDice: dice, source: "quick", sequenceBreak: hasSequenceGap(sessionRecords()[0]),
      sessionId: pending?.sessionId || session.id,
      ...legacyFields,
      forecast: pending ? { ...pending, legacyFields: undefined, fingerprint: undefined } : null,
      referencePrediction: { version: LiveModel.VERSION, candidates: reference.candidates },
      participation: settlement.participation,
      bet: settlement.bet, excludeTriples: true,
      validation: { code: "unverified", label: "仅记录", exact: false, category: false, sum: false },
      createdAt: new Date().toISOString(),
    };
    ensureV5Storage();
    const updatedRecords = [entry, ...records];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedRecords));
    records = updatedRecords;
    if (pending) {
      forecastLedger = forecastLedger.map((item) => item.id === pending.id ? { ...item, status: "resolved" } : item);
      try { localStorage.setItem(LEDGER_KEY, JSON.stringify(forecastLedger)); } catch { /* The committed result also identifies a resolved forecast. */ }
    }
    if (entry.sessionId === session.id) {
      session.nextProtocolRound = legacyFields.modelBlock.round + 1;
      session.activeProtocolBlock = session.nextProtocolRound % VALIDATION_BLOCK_SIZE === 0 ? null : {
        protocolVersion: MODEL_PROTOCOL_VERSION, id: legacyFields.modelBlock.id,
        index: legacyFields.modelBlock.index, lockedModelKeys: legacyFields.modelBlock.lockedModelKeys,
      };
    }
    try { touchSession(); } catch { /* The saved record recovers the legacy cursor. */ }
    els.quickResult.value = "";
    els.quickIssue.value = "";
    els.participationMode.value = "observe";
    els.quickBetSelection.value = "none";
    els.quickStake.value = "";
    renderStreamers(loadArray(STREAMERS_KEY));
    els.quickMessage.className = "form-message success";
    els.quickMessage.textContent = "已记录 " + resultLabel(result) + (pending ? "；已验证锁定预判。" : "；按补录保存，不计提前验证。");
    renderAll();
    els.quickResult.focus();
  }

  async function saveQuickResult() {
    if (savingResult) return;
    const expectedForecastId = pendingForecast()?.id || null;
    savingResult = true;
    els.saveResult.disabled = true;
    try {
      await withStorageWriteLock(() => {
        syncStoredState();
        saveQuickResultLocked(expectedForecastId);
      });
    } catch (error) {
      els.quickMessage.className = "form-message";
      els.quickMessage.textContent = error?.message || "数据写入失败，请重试。";
    } finally {
      savingResult = false;
      renderQuickInput();
    }
  }

  function renderQuickInput() {
    const dice = parseQuickDice(els.quickResult.value);
    els.quickResultPreview.textContent = dice ? `${diceSymbols(dice)}  ${resultLabel(classify(dice))}` : "输入三个 1–6 的数字";
    els.saveResult.disabled = savingResult || !dice;
    els.lockForecast.disabled = savingResult || Boolean(pendingForecast()) || Boolean(els.quickResult.value.trim());
  }

  function renderBankroll() {
    if (!bankroll) {
      els.initialBalance.textContent = "未设置";
      els.currentBalance.textContent = "—";
      els.totalProfit.textContent = "—";
      els.returnRate.textContent = "—";
      els.saveBankroll.textContent = "设置本金";
      return;
    }
    const net = totalNet();
    els.initialBalance.textContent = formatMoney(bankroll.initial);
    els.currentBalance.textContent = formatMoney(currentBalance());
    els.totalProfit.textContent = formatMoney(net, true);
    els.returnRate.textContent = `${net > 0 ? "+" : ""}${((net / bankroll.initial) * 100).toFixed(2)}%`;
    els.totalProfit.className = net > 0 ? "positive" : net < 0 ? "negative" : "";
    els.returnRate.className = els.totalProfit.className;
    els.saveBankroll.textContent = "更新本金";
  }

  function renderQuickHistory() {
    els.quickHistoryCount.textContent = `${records.length} 期`;
    if (!records.length) {
      els.quickHistoryList.innerHTML = '<p class="recent-rail-empty">暂无记录</p>';
      return;
    }
    els.quickHistoryList.innerHTML = records.slice(0, 30).map((record) => {
      const result = classify(record.officialDice);
      const time = new Date(record.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
      const sizeChip = result.triple
        ? '<strong class="category-chip triple">三同号</strong>'
        : `<strong class="category-chip size">${LABELS[result.size]}</strong>`;
      const sessionTag = record.sessionId === session.id ? "本场" : "历史";
      return `<article class="recent-rail-item">
        <span class="recent-rail-dot" aria-hidden="true"></span>
        <div class="recent-rail-primary">
          <div class="recent-rail-categories">${sizeChip}<strong class="category-chip parity">${LABELS[result.parity]}</strong></div>
          <span class="status unverified">${sessionTag}</span>
        </div>
        <div class="recent-rail-secondary"><span>${record.forecast ? LiveModel.isEvaluable(liveItems([record])[0]) ? ["size", "parity"].map((metric) => { const direction = record.forecast.decisions[metric].direction; return direction ? `预${LABELS[direction]}${result[metric] === direction ? "✓" : "×"}` : "观望"; }).join(" · ") : "验证失效" : "补录"}</span><time>${time}</time></div>
      </article>`;
    }).join("");
  }

  function renderHistory() {
    const items = sessionRecords();
    els.sampleCount.textContent = `${items.length} 期`;
    if (!items.length) {
      els.historyStats.className = "history-stats empty-state";
      els.historyStats.textContent = "录入后显示大小与单双频率。";
      return;
    }
    const counts = { big: 0, small: 0, odd: 0, even: 0, triple: 0 };
    items.forEach((record) => {
      const result = classify(record.officialDice);
      if (result.triple) counts.triple += 1;
      else counts[result.size] += 1;
      counts[result.parity] += 1;
    });
    const sizeTotal = counts.big + counts.small;
    const sizeBig = sizeTotal ? (counts.big / sizeTotal) * 100 : 50;
    const odd = items.length ? (counts.odd / items.length) * 100 : 50;
    els.historyStats.className = "history-stats";
    els.historyStats.innerHTML = `
      <div class="stat-row"><span>大小</span><div class="bar"><i style="width:${sizeBig.toFixed(1)}%"></i></div><span>大 ${sizeBig.toFixed(1)}% · 小 ${(100 - sizeBig).toFixed(1)}%</span></div>
      <div class="stat-row"><span>单双</span><div class="bar"><i style="width:${odd.toFixed(1)}%"></i></div><span>单 ${odd.toFixed(1)}% · 双 ${(100 - odd).toFixed(1)}%</span></div>
      <div class="validation-summary"><div><strong>${sizeTotal}</strong>大小有效样本</div><div><strong>${counts.triple}</strong>三同号记录</div></div>`;
  }

  function renderValidation() {
    const evaluated = liveItems();
    const report = LiveModel.evaluate(evaluated);
    const pending = pendingForecast();
    const missing = forecastLedger.filter((entry) => entry.status === "missed").length;
    const removed = forecastLedger.filter((entry) => entry.status !== "missed" && entry.id !== pending?.id
      && !records.some((record) => record.forecast?.id === entry.id)).length;
    const scoreText = (value) => value === null ? "—" : value.toFixed(4);
    els.modelLeaderboard.innerHTML = '<div class="leaderboard-head"><span>同期对照 · 误差越低越好</span><span>大小</span><span>单双</span><span>综合</span></div>'
      + Object.entries(LiveModel.NAMES).map(([key, name]) => {
        const size = report.metrics.size.scores[key].loss;
        const parity = report.metrics.parity.scores[key].loss;
        return '<div class="leaderboard-row' + (key === "live" ? " active" : "") + '"><strong>' + name + "</strong><span>" + scoreText(size)
          + "</span><span>" + scoreText(parity) + "</span><span>" + scoreText(size === null ? null : (size + parity) / 2) + "</span></div>";
      }).join("");
    els.modelConfidenceDetails.innerHTML = ["size", "parity"].map((metric) => {
      const values = report.metrics[metric];
      const improvement = report.count ? values.scores.baseline.loss - values.scores.live.loss : null;
      const label = !report.count ? "暂无提前验证" : report.count < 20 ? "样本较少" : improvement > 0 ? "暂有改善 · 待验证" : "未优于基准";
      const rate = values.issued ? (100 * values.hits / values.issued).toFixed(1) + "%" : "无方向输出";
      return "<article><div><span>" + (metric === "size" ? "大小" : "单双") + "</span><strong>" + label + "</strong></div>"
        + "<p>累计提前验证 " + report.count + " 轮 · 参考命中 " + rate + "</p>"
        + "<small>出方向 " + values.issued + "/" + report.count + " · 最长连续观望 " + values.longestWait + " 轮</small>"
        + "<small>同一出方向期次：本版 " + values.hits + " 次命中，旧版 " + values.scores.legacy.hits + " 次，固定对照 " + values.scores.baseline.hits + " 次</small>"
        + "<small>全部期次 Brier 改善：" + (improvement === null ? "—" : (improvement >= 0 ? "+" : "") + improvement.toFixed(4)) + "</small></article>";
    }).join("");
    const modes = ["actual", "simulate", "observe"].map((mode) => {
      const entries = evaluated.filter(LiveModel.isEvaluable).filter((record) => record.participation?.mode === mode);
      const selected = entries.filter((record) => record.participation.selection !== "none");
      const wins = selected.filter((record) => record.participation.won).length;
      const net = entries.reduce((sum, record) => sum + (Number(record.participation.net) || 0), 0);
      return "<div><span>" + ({ actual: "实际参与", simulate: "模拟选择", observe: "观望记录" })[mode] + "</span><strong>" + entries.length
        + " 轮</strong><small>" + (mode === "observe" ? "不混入参与命中率" : "选择命中 " + wins + "/" + selected.length + " · 已填金额净额 " + formatMoney(net, true)) + "</small></div>";
    }).join("");
    const callers = new Map();
    evaluated.filter(LiveModel.isEvaluable).forEach((record) => {
      record.forecast.streamers.forEach((streamer) => {
        if (!callers.has(streamer.name)) callers.set(streamer.name, { size: 0, sizeHits: 0, parity: 0, parityHits: 0 });
        const data = callers.get(streamer.name), result = classify(record.officialDice);
        for (const metric of ["size", "parity"]) {
          if (streamer[metric] === "none") continue;
          data[metric] += 1;
          if (streamer[metric] === result[metric]) data[metric + "Hits"] += 1;
        }
      });
    });
    const streamerText = [...callers].map(([name, value]) => escapeHtml(name) + "：大小 " + value.sizeHits + "/" + value.size + "，单双 " + value.parityHits + "/" + value.parity);
    els.crossSessionStability.innerHTML = '<div class="stability-heading"><span>真实、模拟与观望分开</span></div><div class="stability-grid participation-grid">' + modes + "</div>"
      + '<p class="fine-print">' + (streamerText.length ? "主播累计命中（各场独立学习） · " + streamerText.join("；") : "尚无已验证的主播提前判断。") + "</p>";
    const tips = [
      "只统计开奖前手动锁定并已录入结果的 V5 记录；补录、旧版本与失效记录不计入。",
      "所有模型在相同的锁定期次对照；出方向的子集也在相同期次比较，固定对照为大/单。",
      "概率和权重按事先固定规则逐轮更新。观望不设强制结束轮数；旧版误报上限不适用于本版。",
      "主播同向、反向关联只从已锁定记录学习；多人判断取平均，不当作独立证据相乘。",
      "个人行为只记录和分组统计，未用于主概率；无法由个人输赢确认后台动机。",
      "真实参与的结果不能用模拟反选收益替代。大小三同号按未命中结算。",
      "本机时间不能证明官方开奖时间；请连续、无选择地记录，缺期会降低结论可信度。",
      "已留痕漏期 " + missing + " 条；删除后无结果的锁定记录 " + removed + " 条。所有结论仍待后续数据验证。",
    ];
    els.validationList.innerHTML = tips.map((tip) => "<li>" + tip + "</li>").join("");
  }

  function renderRecords() {
    els.recordsEmpty.classList.toggle("hidden", records.length > 0);
    const balances = balanceAfterEachRecord();
    els.recordsBody.innerHTML = records.map((record) => {
      const result = classify(record.officialDice);
      const time = new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false });
      const bet = record.bet;
      const settlement = bet
        ? `<strong>${LABELS[bet.selection] || bet.selection} · ${formatMoney(Number(bet.stake))}</strong><span class="subline">返还 ${formatMoney(Number(bet.payout))} · <span class="${Number(bet.net) > 0 ? "positive" : "negative"}">${formatMoney(Number(bet.net), true)}</span></span>`
        : '<span class="muted">未测试</span>';
      return `<tr>
        <td><strong>${escapeHtml(record.issue || "未填期号")}</strong><span class="subline">${time}</span></td>
        <td><span class="dice">${diceSymbols(record.officialDice)}</span><span class="subline">${resultLabel(result)}</span></td>
        <td><span class="model-record">${record.forecast ? `V5 ${LiveModel.isEvaluable(liveItems([record])[0]) ? "提前锁定" : "验证失效"} · ${predictionText(record.forecast.candidates.live)}` : "补录 / 旧版，不计 V5 验证"}</span>${record.participation?.mode === "actual" ? `<span class="subline">实际参与 ${LABELS[record.participation.selection] || "—"} · ${record.participation.won ? "命中" : "未命中"}${record.participation.net === null ? "" : ` · ${formatMoney(record.participation.net, true)}`}</span>` : ""}</td>
        <td>${settlement}</td>
        <td><strong>${balances.has(record.id) ? formatMoney(balances.get(record.id)) : "—"}</strong></td>
        <td><button class="icon-button" type="button" data-delete-id="${record.id}" aria-label="删除这条记录">删除</button></td>
      </tr>`;
    }).join("");
  }

  function loadOcrLibrary() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (ocrLibraryPromise) return ocrLibraryPromise;
    ocrLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = OCR_SCRIPT;
      script.crossOrigin = "anonymous";
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => reject(new Error("OCR 组件加载失败，请检查网络后重试。"));
      document.head.appendChild(script);
    });
    return ocrLibraryPromise;
  }

  function parseOcrText(text, fileName) {
    const candidates = [];
    String(text).split(/\r?\n/).forEach((rawLine, lineIndex) => {
      const line = rawLine.trim();
      if (!line) return;
      const tokens = line.split(/[^0-9]+/).filter(Boolean);
      const compact = tokens.filter((token) => /^[1-6]{3}$/.test(token));
      const singles = tokens.filter((token) => /^[1-6]$/.test(token));
      const groups = compact.map((token) => [...token].map(Number));
      if (!groups.length && singles.length === 3) groups.push(singles.map(Number));
      const issueToken = tokens.find((token) => token.length >= 4) || "";
      groups.forEach((dice, groupIndex) => candidates.push({
        id: `${fileName}-${lineIndex}-${groupIndex}`,
        issue: issueToken ? `截图 ${issueToken}` : "截图导入",
        dice,
      }));
    });
    return candidates;
  }

  function updateOcrProgress(message, progress = 0) {
    els.ocrProgress.classList.remove("hidden");
    els.ocrProgressBar.style.width = `${Math.max(0, Math.min(100, progress * 100)).toFixed(0)}%`;
    els.ocrProgressText.textContent = message;
  }

  function renderOcrCandidates() {
    els.ocrResults.classList.remove("hidden");
    els.ocrSummary.textContent = `识别到 ${ocrCandidates.length} 条候选记录`;
    els.importOcrRecords.disabled = ocrCandidates.length === 0;
    els.ocrRawText.textContent = ocrRawSections.join("\n\n");
    els.ocrCandidates.innerHTML = ocrCandidates.map((candidate, index) => {
      const result = classify(candidate.dice);
      return `<div class="ocr-candidate" data-ocr-index="${index}">
        <input type="checkbox" checked aria-label="选择第 ${index + 1} 条候选记录" />
        <input type="text" maxlength="30" value="${escapeHtml(candidate.issue)}" aria-label="期号或备注" />
        <div class="ocr-candidate-dice">${candidate.dice.map((value, dieIndex) => `<input type="number" min="1" max="6" value="${value}" aria-label="骰子 ${dieIndex + 1}" />`).join("")}</div>
        <span class="ocr-candidate-category">${resultLabel(result)}</span>
      </div>`;
    }).join("");
  }

  function resetOcrResults() {
    ocrCandidates = [];
    ocrRawSections = [];
    els.ocrFiles.value = "";
    els.ocrResults.classList.add("hidden");
    els.ocrProgress.classList.add("hidden");
    els.ocrMessage.textContent = "";
  }

  async function recognizeScreenshots(fileList) {
    const files = [...fileList].filter((file) => file.type.startsWith("image/")).slice(0, 10);
    if (!files.length) {
      els.ocrMessage.textContent = "请选择图片文件。";
      return;
    }
    els.ocrMessage.className = "form-message";
    els.ocrMessage.textContent = "";
    els.ocrResults.classList.add("hidden");
    updateOcrProgress("正在加载本地 OCR…", 0.02);
    let worker;
    try {
      const Tesseract = await loadOcrLibrary();
      worker = await Tesseract.createWorker("eng", 1, {
        logger: (event) => {
          const index = Math.max(0, Number(els.ocrFiles.dataset.activeIndex) || 0);
          updateOcrProgress(`第 ${index + 1}/${files.length} 张：${event.status || "识别中"}`, index / files.length + (Number(event.progress) || 0) / files.length);
        },
      });
      await worker.setParameters({ tessedit_char_whitelist: "0123456789 -,:./|[]" });
      ocrCandidates = [];
      ocrRawSections = [];
      for (let index = 0; index < files.length; index += 1) {
        els.ocrFiles.dataset.activeIndex = index;
        const result = await worker.recognize(files[index]);
        const text = result.data.text || "";
        ocrRawSections.push(`【${files[index].name}】\n${text.trim() || "（未识别到文本）"}`);
        ocrCandidates.push(...parseOcrText(text, files[index].name));
      }
      updateOcrProgress("识别完成", 1);
      renderOcrCandidates();
      if (!ocrCandidates.length) els.ocrMessage.textContent = "没有提取到三枚 1–6 的数字组合，请检查原始文本或更换清晰截图。";
    } catch (error) {
      els.ocrMessage.textContent = error?.message || "截图识别失败，请重试。";
      els.ocrProgress.classList.add("hidden");
    } finally {
      if (worker) await worker.terminate();
      delete els.ocrFiles.dataset.activeIndex;
    }
  }

  function importOcrRecordsLocked() {
    ensureSession();
    if (pendingForecast()) throw new Error("请先完成待开奖预判，再导入历史截图。");
    ensureV5Storage();
    const imported = [];
    let invalid = 0;
    let duplicates = 0;
    $$(".ocr-candidate").forEach((row, index) => {
      if (!row.querySelector('input[type="checkbox"]').checked) return;
      const issue = row.querySelector('input[type="text"]').value.trim();
      const dice = [...row.querySelectorAll('input[type="number"]')].map((input) => Number(input.value));
      if (!validDice(dice)) {
        invalid += 1;
        return;
      }
      if ([...records, ...imported].some((record) => record.issue === issue && record.officialDice.join("") === dice.join(""))) {
        duplicates += 1;
        return;
      }
      imported.push({
        id: `ocr-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
        issue: issue || "截图导入",
        officialDice: dice,
        source: "screenshot",
        sessionId: session.id,
        modelPrediction: null,
        bet: null,
        excludeTriples: true,
        validation: { code: "unverified", label: "仅记录", exact: false, category: false, sum: false },
        createdAt: new Date(Date.now() - index * 1000).toISOString(),
      });
    });
    if (!imported.length) {
      els.ocrMessage.textContent = invalid ? "所选记录中有无效骰子，请改为 1–6。" : duplicates ? "所选记录已经存在。" : "请至少勾选一条记录。";
      return;
    }
    records = [...imported, ...records];
    saveRecords();
    try {
      touchSession();
    } catch {
      // Imported records are already committed; session state can recover on reload.
    }
    resetOcrResults();
    renderAll();
    els.ocrMessage.className = "form-message success";
    els.ocrMessage.textContent = `已导入当前场次 ${imported.length} 条记录${duplicates ? `，跳过 ${duplicates} 条重复记录` : ""}${invalid ? `，跳过 ${invalid} 条无效记录` : ""}。`;
  }

  async function importOcrRecords() {
    try {
      await withStorageWriteLock(() => {
        syncStoredState();
        importOcrRecordsLocked();
      });
    } catch (error) {
      els.ocrMessage.className = "form-message";
      els.ocrMessage.textContent = error?.message || "数据写入失败，请重试。";
    }
  }

  function exportCsv() {
    if (!records.length && !forecastLedger.length) {
      els.quickMessage.className = "form-message";
      els.quickMessage.textContent = "暂无可导出的记录。";
      return;
    }
    const balances = balanceAfterEachRecord();
    const rows = [["期号/备注", "验证状态", "结果录入时间", "锁定时间", "场次", "骰子", "和值", "大小", "单双", "锁定大%（不含三同号）", "锁定小%（不含三同号）", "锁定单%", "锁定双%", "大小参考", "单双参考", "主播提前判断", "参与方式", "选择", "金额", "赔率", "返还", "净盈亏", "模拟轮后余额", "来源", "完整审计明细JSON"]];
    const appendRow = (record, frozen, status) => {
      const result = record ? classify(record.officialDice) : null;
      const participation = record?.participation || frozen?.participation || (record?.bet ? { mode: "simulate", ...record.bet } : {});
      const p = frozen?.candidates.live;
      const percent = (value) => Number.isFinite(value) ? (100 * value).toFixed(2) : "";
      rows.push([
        record?.issue || frozen?.issue || "", status,
        record?.createdAt || "", frozen?.lockedAt || "", record?.sessionId || frozen?.sessionId || "",
        record?.officialDice.join("-") || "", result?.sum ?? "",
        result ? result.triple ? "三同号" : LABELS[result.size] : "", result ? LABELS[result.parity] : "",
        percent(p?.big), percent(p?.small), percent(p?.odd), percent(p?.even),
        frozen ? LABELS[frozen.decisions.size.direction] || "观望" : "",
        frozen ? LABELS[frozen.decisions.parity.direction] || "观望" : "",
        frozen ? JSON.stringify(frozen.streamers) : "",
        ({ observe: "观望", simulate: "模拟", actual: "实际" })[participation.mode] || "",
        LABELS[participation.selection] || "", participation.stake ?? "", participation.odds ?? (frozen ? ODDS : ""),
        participation.payout ?? "", participation.net ?? "", balances.get(record?.id) ?? "",
        record?.source || (record ? "legacy" : "forecast-ledger"), JSON.stringify(record || frozen),
      ]);
    };
    liveItems().forEach((record) => appendRow(record, record.forecast,
      LiveModel.isEvaluable(record) ? "已提前验证" : record.evidenceInvalidated ? "场次已作废" : "补录或旧版"));
    forecastLedger.filter((entry) => !records.some((record) => record.forecast?.id === entry.id)).forEach((entry) => {
      const status = entry.status === "missed" ? "漏期留痕" : invalidatedSessions.has(entry.sessionId) || entry.status === "resolved" ? "删除或失效留痕" : "待开奖";
      appendRow(null, entry, status);
    });
    const csv = "\ufeff" + rows.map((row) => row.map((cell) => {
      const value = typeof cell === "string" && /^[=+\-@\t\r]/.test(cell) ? "'" + cell : String(cell ?? "");
      return '"' + value.replace(/"/g, '""') + '"';
    }).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `结果记录-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function renderAll() {
    renderModel();
    renderQuickInput();
    renderQuickHistory();
    renderBankroll();
    renderHistory();
    renderValidation();
    renderRecords();
  }

  els.editTitle.addEventListener("click", () => {
    if (els.appTitleInput.classList.contains("hidden")) startTitleEdit();
    else finishTitleEdit(true);
  });
  els.appTitleInput.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") finishTitleEdit(true);
    if (event.key === "Escape") finishTitleEdit(false);
  });
  els.quickResult.addEventListener("input", renderQuickInput);
  els.quickResult.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !els.saveResult.disabled) saveQuickResult();
  });
  els.saveResult.addEventListener("click", saveQuickResult);
  els.lockForecast.addEventListener("click", lockNextForecast);
  els.skipForecast.addEventListener("click", skipPendingForecast);
  els.addStreamer.addEventListener("click", () => {
    if (pendingForecast() || els.streamerInputs.children.length >= 2) return;
    const entries = [...els.streamerInputs.querySelectorAll(".streamer-row")].map((row) => ({
      name: row.querySelector("[data-streamer-name]").value,
      size: row.querySelector("[data-streamer-size]").value,
      parity: row.querySelector("[data-streamer-parity]").value,
    }));
    renderStreamers([...entries, { name: "" }]);
    els.streamerInputs.lastElementChild.querySelector("input").focus();
  });
  els.streamerInputs.addEventListener("click", (event) => {
    if (!event.target.closest("[data-remove-streamer]") || pendingForecast()) return;
    event.target.closest(".streamer-row").remove();
    renderModel();
  });
  els.streamerInputs.addEventListener("change", renderModel);
  els.participationMode.addEventListener("change", () => {
    if (els.participationMode.value === "observe") { els.quickBetSelection.value = "none"; els.quickStake.value = ""; }
    renderModel();
  });
  els.startNewSession.addEventListener("click", async () => {
    try {
      await withStorageWriteLock(() => {
        syncStoredState();
        if (pendingForecast()) throw new Error("请先完成或跳过待开奖预判，再开始新场次。");
        ensureV5Storage();
        session = newSession();
        renderAll();
        els.quickMessage.className = "form-message success";
        els.quickMessage.textContent = "新场次已开始，旧记录仍保留在完整记录中。";
      });
    } catch (error) {
      els.quickMessage.className = "form-message";
      els.quickMessage.textContent = error?.message || "新场次创建失败，请重试。";
    }
  });
  els.quickBetSelection.addEventListener("change", () => {
    if (els.quickBetSelection.value === "none") els.quickStake.value = "";
    renderModel();
  });
  els.saveBankroll.addEventListener("click", async () => {
    try {
      await withStorageWriteLock(() => {
        syncStoredState();
        ensureV5Storage();
        els.bankrollMessage.className = "form-message";
        const initial = roundMoney(Number(els.initialBankroll.value));
        if (!Number.isFinite(initial) || initial < 2) {
          els.bankrollMessage.textContent = "模拟本金最低为 2 元。";
          return;
        }
        const required = minimumInitialForHistory();
        if (initial < required) {
          els.bankrollMessage.textContent = `按已有流水，本金不能低于 ${formatMoney(required)}。`;
          return;
        }
        bankroll = { initial, updatedAt: new Date().toISOString() };
        saveBankrollState();
        renderAll();
        els.bankrollMessage.className = "form-message success";
        els.bankrollMessage.textContent = "模拟本金已保存。";
      });
    } catch (error) {
      els.bankrollMessage.className = "form-message";
      els.bankrollMessage.textContent = error?.message || "本金保存失败，请重试。";
    }
  });
  els.exportData.addEventListener("click", exportCsv);
  els.clearData.addEventListener("click", () => els.confirmDialog.showModal());
  els.confirmDialog.addEventListener("close", async () => {
    if (els.confirmDialog.returnValue !== "confirm") return;
    try {
      await withStorageWriteLock(() => {
        syncStoredState();
        ensureV5Storage();
        records = [];
        saveRecords();
        forecastLedger = [];
        localStorage.setItem(LEDGER_KEY, "[]");
        invalidatedSessions = new Set();
        saveInvalidatedSessions();
        try {
          session = newSession();
        } catch {
          session = createSessionState();
        }
        renderAll();
      });
    } catch (error) {
      els.quickMessage.className = "form-message";
      els.quickMessage.textContent = error?.message || "记录清空失败，请重试。";
    }
  });
  els.recordsBody.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-id]");
    if (!button) return;
    const recordId = button.dataset.deleteId;
    try {
      await withStorageWriteLock(() => {
        syncStoredState();
        ensureV5Storage();
        const target = records.find((record) => record.id === recordId);
        if (!target) return;
        const invalidatesEvidence = validModelBlock(target);
        const wasCurrentSession = target.sessionId === session.id;
        if (invalidatesEvidence) {
          invalidatedSessions.add(target.sessionId);
          saveInvalidatedSessions();
          records = records.map((record) => record.sessionId === target.sessionId
            ? { ...record, evidenceInvalidated: true }
            : record);
        }
        records = records.filter((record) => record.id !== recordId);
        saveRecords();
        if (invalidatesEvidence && wasCurrentSession) {
          try {
            session = newSession();
          } catch {
            session = createSessionState();
          }
        }
        renderAll();
        if (invalidatesEvidence) {
          els.quickMessage.className = "form-message";
          els.quickMessage.textContent = wasCurrentSession
            ? "记录已删除；原场次验证证据已作废，并已自动开始新场次。"
            : "记录已删除；为防止事后筛选，该场次的验证证据已全部作废。";
        }
      });
    } catch (error) {
      els.quickMessage.className = "form-message";
      els.quickMessage.textContent = error?.message || "记录删除失败，请重试。";
    }
  });
  els.ocrFiles.addEventListener("change", () => recognizeScreenshots(els.ocrFiles.files));
  ["dragenter", "dragover"].forEach((eventName) => els.ocrDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.ocrDropzone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((eventName) => els.ocrDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.ocrDropzone.classList.remove("dragging");
  }));
  els.ocrDropzone.addEventListener("drop", (event) => recognizeScreenshots(event.dataTransfer.files));
  els.ocrCandidates.addEventListener("input", (event) => {
    const row = event.target.closest(".ocr-candidate");
    if (!row || event.target.type !== "number") return;
    const dice = [...row.querySelectorAll('input[type="number"]')].map((input) => Number(input.value));
    row.querySelector(".ocr-candidate-category").textContent = validDice(dice) ? resultLabel(classify(dice)) : "请检查骰子";
  });
  els.importOcrRecords.addEventListener("click", importOcrRecords);
  els.clearOcrResults.addEventListener("click", resetOcrResults);
  window.addEventListener("storage", (event) => {
    if (![STORAGE_KEY, BANKROLL_KEY, SESSION_KEY, INVALIDATED_SESSIONS_KEY, LEDGER_KEY].includes(event.key) && event.key !== null) return;
    clearTimeout(storageSyncTimer);
    storageSyncTimer = setTimeout(async () => {
      if (savingResult) return;
      try {
        await withStorageWriteLock(() => {
          syncStoredState();
          renderAll();
        });
      } catch {
        // The next local action performs another synchronized read.
      }
    }, 75);
  });

  renderStreamers(pendingForecast()?.streamers || loadArray(STREAMERS_KEY));
  renderAll();
})();
