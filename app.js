(() => {
  "use strict";

  const STORAGE_KEY = "k3-verifier-records-v1";
  const BANKROLL_KEY = "k3-verifier-bankroll-v1";
  const TITLE_KEY = "k3-verifier-title-v1";
  const SESSION_KEY = "k3-verifier-model-session-v1";
  const DEFAULT_TITLE = "结果记录台";
  const SESSION_GAP_MS = 30 * 60 * 1000;
  const PRIOR_SIDE = 10;
  const DICE_PRIOR_FACE = 4;
  const DECAY_HALF_LIFE = 20;
  const ENSEMBLE_ETA = 2;
  const SIGNAL_MIN_EDGE = 0.04;
  const ODDS = 1.96;
  const OCR_SCRIPT = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  const LABELS = { big: "大", small: "小", odd: "单", even: "双" };
  const MODEL_DEFINITIONS = [
    { key: "baseline", name: "固定 50%" },
    { key: "static", name: "静态贝叶斯" },
    { key: "dynamic", name: "动态贝叶斯" },
    { key: "diceBias", name: "骰子偏差" },
    { key: "ensemble", name: "加权组合" },
  ];
  const BASE_MODEL_KEYS = ["baseline", "static", "dynamic", "diceBias"];

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

  let records = loadRecords();
  let bankroll = loadBankroll();
  let session = loadSession();
  let ocrCandidates = [];
  let ocrRawSections = [];
  let ocrLibraryPromise = null;

  if (bankroll) els.initialBankroll.value = bankroll.initial;
  applyTitle(localStorage.getItem(TITLE_KEY) || DEFAULT_TITLE);

  function validDice(dice) {
    return Array.isArray(dice) && dice.length === 3
      && dice.every((value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 6);
  }

  function loadRecords() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter((record) => validDice(record.officialDice)) : [];
    } catch {
      return [];
    }
  }

  function saveRecords() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function loadBankroll() {
    try {
      const saved = JSON.parse(localStorage.getItem(BANKROLL_KEY) || "null");
      return saved && Number.isFinite(saved.initial) && saved.initial >= 2 ? saved : null;
    } catch {
      return null;
    }
  }

  function saveBankrollState() {
    localStorage.setItem(BANKROLL_KEY, JSON.stringify(bankroll));
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

  function newSession() {
    const now = new Date().toISOString();
    const created = { id: `model-session-${Date.now()}-${Math.random().toString(16).slice(2)}`, startedAt: now, lastActiveAt: now };
    localStorage.setItem(SESSION_KEY, JSON.stringify(created));
    return created;
  }

  function loadSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (saved?.id && sessionIsActive(saved.lastActiveAt)) return saved;
    } catch {
      // Start a clean session below.
    }
    const latest = records[0];
    if (latest?.sessionId && sessionIsActive(latest.createdAt)) {
      const adopted = { id: latest.sessionId, startedAt: latest.createdAt, lastActiveAt: latest.createdAt };
      localStorage.setItem(SESSION_KEY, JSON.stringify(adopted));
      return adopted;
    }
    return newSession();
  }

  function ensureSession() {
    if (!sessionIsActive(session.lastActiveAt)) session = newSession();
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

  function bayesModel(items, decayed) {
    let big = 0;
    let small = 0;
    let odd = 0;
    let even = 0;
    items.forEach((record, index) => {
      const weight = decayed ? 0.5 ** (index / DECAY_HALF_LIFE) : 1;
      const result = classify(record.officialDice);
      if (result.size === "big") big += weight;
      if (result.size === "small") small += weight;
      if (result.parity === "odd") odd += weight;
      if (result.parity === "even") even += weight;
    });
    const sizeProbability = (PRIOR_SIDE + big) / (PRIOR_SIDE * 2 + big + small);
    const parityProbability = (PRIOR_SIDE + odd) / (PRIOR_SIDE * 2 + odd + even);
    return {
      big: sizeProbability,
      small: 1 - sizeProbability,
      odd: parityProbability,
      even: 1 - parityProbability,
    };
  }

  function diceBiasModel(items) {
    const counts = Array.from({ length: 3 }, () => Array(6).fill(0));
    items.forEach((record) => record.officialDice.forEach((value, position) => {
      counts[position][Number(value) - 1] += 1;
    }));
    const probabilities = counts.map((positionCounts) => {
      const total = positionCounts.reduce((sum, count) => sum + count, 0) + DICE_PRIOR_FACE * 6;
      return positionCounts.map((count) => (count + DICE_PRIOR_FACE) / total);
    });
    let big = 0;
    let small = 0;
    let odd = 0;
    let even = 0;
    for (let first = 1; first <= 6; first += 1) {
      for (let second = 1; second <= 6; second += 1) {
        for (let third = 1; third <= 6; third += 1) {
          const probability = probabilities[0][first - 1] * probabilities[1][second - 1] * probabilities[2][third - 1];
          const result = classify([first, second, third]);
          if (result.size === "big") big += probability;
          if (result.size === "small") small += probability;
          if (result.parity === "odd") odd += probability;
          if (result.parity === "even") even += probability;
        }
      }
    }
    const sizeTotal = big + small;
    return {
      big: sizeTotal ? big / sizeTotal : 0.5,
      small: sizeTotal ? small / sizeTotal : 0.5,
      odd,
      even,
    };
  }

  function predictionAvailable(record, key) {
    const prediction = record.modelPredictions?.[key];
    return Number.isFinite(Number(prediction?.big)) && Number.isFinite(Number(prediction?.odd));
  }

  function ensembleWeights(items, metric) {
    const field = metric === "size" ? "big" : "odd";
    const losses = Object.fromEntries(BASE_MODEL_KEYS.map((key) => [key, 0]));
    items.filter((record) => BASE_MODEL_KEYS.every((key) => predictionAvailable(record, key))).forEach((record) => {
      const result = classify(record.officialDice);
      if (metric === "size" && result.triple) return;
      const actual = metric === "size" ? (result.size === "big" ? 1 : 0) : (result.parity === "odd" ? 1 : 0);
      BASE_MODEL_KEYS.forEach((key) => {
        losses[key] += (Number(record.modelPredictions[key][field]) - actual) ** 2;
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
    const predictions = {
      baseline: { big: 0.5, small: 0.5, odd: 0.5, even: 0.5 },
      static: bayesModel(items, false),
      dynamic: bayesModel(items, true),
      diceBias: diceBiasModel(items),
    };
    const sizeWeights = ensembleWeights(items, "size");
    const parityWeights = ensembleWeights(items, "parity");
    const big = weightedProbability(predictions, sizeWeights, "big");
    const odd = weightedProbability(predictions, parityWeights, "odd");
    predictions.ensemble = { big, small: 1 - big, odd, even: 1 - odd };
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
    return MODEL_DEFINITIONS.every(({ key }) => predictionAvailable(record, key));
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
        if (!result.triple) {
          const actualBig = result.size === "big" ? 1 : 0;
          sizeError += (Number(prediction.big) - actualBig) ** 2;
          sizeCount += 1;
          if (Math.abs(Number(prediction.big) - 0.5) > 1e-9) {
            decisions += 1;
            if ((prediction.big > 0.5) === Boolean(actualBig)) hits += 1;
          }
        }
        const actualOdd = result.parity === "odd" ? 1 : 0;
        parityError += (Number(prediction.odd) - actualOdd) ** 2;
        parityCount += 1;
        if (Math.abs(Number(prediction.odd) - 0.5) > 1e-9) {
          decisions += 1;
          if ((prediction.odd > 0.5) === Boolean(actualOdd)) hits += 1;
        }
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

  function selectActiveModel(evaluation, metric) {
    if (evaluation.rounds < 20) return "baseline";
    const baseline = evaluation.models.baseline[metric];
    const candidates = MODEL_DEFINITIONS.filter(({ key }) => key !== "baseline").map(({ key }) => evaluation.models[key])
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

  function lockedBlockState(items, evaluation) {
    const chronological = items.filter(hasComparablePredictions).reverse();
    const position = chronological.length % 20;
    const index = Math.floor(chronological.length / 20);
    const activeKeys = position === 0
      ? { size: selectActiveModel(evaluation, "size"), parity: selectActiveModel(evaluation, "parity") }
      : savedModelKeys(chronological[index * 20]);
    return { index, position, activeKeys };
  }

  function bestCandidate(evaluation, metric) {
    return MODEL_DEFINITIONS.filter(({ key }) => key !== "baseline").map(({ key }) => evaluation.models[key])
      .filter((model) => Number.isFinite(model[metric]))
      .sort((first, second) => first[metric] - second[metric])[0]?.key || "static";
  }

  function pairedConfidence(items, modelKey, metric) {
    const differences = [];
    items.filter(hasComparablePredictions).forEach((record) => {
      const result = classify(record.officialDice);
      if (metric === "size" && result.triple) return;
      const field = metric === "size" ? "big" : "odd";
      const actual = metric === "size" ? (result.size === "big" ? 1 : 0) : (result.parity === "odd" ? 1 : 0);
      const probability = Number(record.modelPredictions[modelKey][field]);
      differences.push(0.25 - (probability - actual) ** 2);
    });
    if (!differences.length) return { count: 0, mean: null, lower: null, upper: null };
    const mean = differences.reduce((total, value) => total + value, 0) / differences.length;
    if (differences.length < 2) return { count: differences.length, mean, lower: null, upper: null };
    const variance = differences.reduce((total, value) => total + (value - mean) ** 2, 0) / (differences.length - 1);
    const margin = 1.96 * Math.sqrt(variance / differences.length);
    return { count: differences.length, mean, lower: mean - margin, upper: mean + margin };
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
      if (evaluation.rounds < 20) return;
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

  function confidenceState(items, evaluation, crossSession, metric) {
    const candidate = bestCandidate(evaluation, metric);
    const interval = pairedConfidence(items, candidate, metric);
    let label = "收集中";
    if (interval.count >= 20 && interval.lower !== null) {
      if (interval.upper < 0) label = "未优于基准";
      else if (interval.lower > 0 && crossSession.stable[metric] === candidate) label = "多场稳定";
      else if (interval.lower > 0) label = "初步优势";
      else label = "优势未确认";
    }
    return { candidate, interval, label };
  }

  function signalState(items, state, crossSession, metric) {
    const field = metric === "size" ? "big" : "odd";
    const firstLabel = metric === "size" ? "大" : "单";
    const secondLabel = metric === "size" ? "小" : "双";
    const modelKey = state.activeKeys[metric];
    const probability = Number(state.active[field]);
    const interval = pairedConfidence(items, modelKey, metric);
    const direction = probability >= 0.5 ? firstLabel : secondLabel;
    const stable = crossSession.stable[metric] === modelKey;
    const issued = modelKey !== "baseline"
      && interval.count >= 20
      && interval.lower !== null
      && interval.lower > 0
      && Math.abs(probability - 0.5) >= SIGNAL_MIN_EDGE;
    return {
      issued,
      direction: issued ? direction : null,
      label: issued ? `${direction} · ${stable ? "稳定信号" : "试验信号"}` : "观望",
      modelKey,
      probability,
      edge: Math.abs(probability - 0.5),
      confidenceLower: interval.lower,
      confidenceUpper: interval.upper,
    };
  }

  function signalMetrics(items, metric) {
    let eligible = 0;
    let decisions = 0;
    let hits = 0;
    items.forEach((record) => {
      const saved = record.modelPrediction?.signals?.[metric];
      if (!saved || typeof saved.issued !== "boolean") return;
      const result = classify(record.officialDice);
      if (metric === "size" && result.triple) return;
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
    };
    const crossSession = crossSessionSummary();
    const signals = {
      size: signalState(items, { activeKeys, active }, crossSession, "size"),
      parity: signalState(items, { activeKeys, active }, crossSession, "parity"),
    };
    return { predictions, evaluation, block, activeKeys, active, signals, crossSession };
  }

  function renderModel() {
    const items = sessionRecords();
    const state = currentModelState(items);
    const model = state.active;
    const size = pairPercent(model.big);
    const parity = pairPercent(model.odd);

    const bothBaseline = state.activeKeys.size === "baseline" && state.activeKeys.parity === "baseline";
    const sameModel = state.activeKeys.size === state.activeKeys.parity;
    els.sessionStatus.textContent = `第 ${state.block.index + 1} 段 · ${state.block.position}/20`;
    els.modelConfidence.textContent = state.block.index === 0
      ? "固定 50% · 首段锁定"
      : sameModel
        ? `${modelName(state.activeKeys.size)} · ${bothBaseline ? "自动降级" : state.evaluation.rounds < 100 ? "实验领先" : "当前最优"}`
        : `大小 ${modelName(state.activeKeys.size)} · 单双 ${modelName(state.activeKeys.parity)}`;
    els.modelSample.textContent = `本场 ${items.length} 轮 · 本段模型已锁定`;
    els.probBig.textContent = `${size[0].toFixed(1)}%`;
    els.probSmall.textContent = `${size[1].toFixed(1)}%`;
    els.probOdd.textContent = `${parity[0].toFixed(1)}%`;
    els.probEven.textContent = `${parity[1].toFixed(1)}%`;
    els.barBig.style.width = `${size[0]}%`;
    els.barOdd.style.width = `${parity[0]}%`;

    if (state.block.index === 0) {
      els.modelNote.textContent = `首段固定使用 50% 基准，还需 ${20 - state.block.position} 轮完成`;
    } else if (bothBaseline) {
      els.modelNote.textContent = `第 ${state.block.index + 1} 段已锁定 50% 基准，不会中途切换`;
    } else {
      els.modelNote.textContent = `第 ${state.block.index + 1} 段已分别择优并锁定，不会中途切换`;
    }

    els.signalSize.textContent = state.signals.size.label;
    els.signalParity.textContent = state.signals.parity.label;
    els.signalSize.className = state.signals.size.issued ? "signal-badge active" : "signal-badge";
    els.signalParity.className = state.signals.parity.issued ? "signal-badge active" : "signal-badge";

    const crossSession = state.crossSession;
    const sizeConfidence = confidenceState(items, state.evaluation, crossSession, "size");
    const parityConfidence = confidenceState(items, state.evaluation, crossSession, "parity");
    els.modelValidation.textContent = `大小${sizeConfidence.label} · 单双${parityConfidence.label}`;
    const issued = [["大小", state.signals.size], ["单双", state.signals.parity]].filter(([, signal]) => signal.issued);
    if (!issued.length) els.modelNote.textContent = "当前无有效信号，继续记录";
    else els.modelNote.textContent = issued.map(([metric, signal]) => `${metric}${signal.label}`).join(" · ");
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

  function betForResult(result) {
    const selection = els.quickBetSelection.value;
    if (selection === "none") return { bet: null };
    if (!bankroll) return { error: "请先在“更多工具”里设置模拟本金。" };
    const stake = roundMoney(Number(els.quickStake.value));
    if (!Number.isFinite(stake) || stake < 2) return { error: "本轮投入最低为 2 元。" };
    if (stake > currentBalance()) return { error: `本轮投入不能超过当前模拟余额 ${formatMoney(currentBalance())}。` };
    const dimension = ["big", "small"].includes(selection) ? "size" : "parity";
    const outcome = result[dimension];
    const won = selection === outcome;
    const payout = won ? roundMoney(stake * ODDS) : 0;
    const net = won ? roundMoney(payout - stake) : -stake;
    return { bet: { dimension, selection, outcome, stake, odds: ODDS, won, payout, net } };
  }

  function saveQuickResult() {
    els.quickMessage.className = "form-message";
    const dice = parseQuickDice(els.quickResult.value);
    if (!dice) {
      els.quickMessage.textContent = "请输入三个 1–6 的数字。";
      return;
    }
    ensureSession();
    const result = classify(dice);
    const betResult = betForResult(result);
    if (betResult.error) {
      els.quickMessage.textContent = betResult.error;
      return;
    }
    const before = sessionRecords();
    const state = currentModelState(before);
    const frozenPredictions = Object.fromEntries(Object.entries(state.predictions).map(([key, prediction]) => [key, {
      ...prediction,
      basedOn: before.length,
    }]));
    records.unshift({
      id: `result-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      issue: els.quickIssue.value.trim(),
      officialDice: dice,
      source: "quick",
      sessionId: session.id,
      modelPredictions: frozenPredictions,
      modelPrediction: {
        big: frozenPredictions[state.activeKeys.size].big,
        small: frozenPredictions[state.activeKeys.size].small,
        odd: frozenPredictions[state.activeKeys.parity].odd,
        even: frozenPredictions[state.activeKeys.parity].even,
        basedOn: before.length,
        modelKeys: state.activeKeys,
        signals: state.signals,
      },
      bet: betResult.bet,
      excludeTriples: true,
      validation: { code: "unverified", label: "仅记录", exact: false, category: false, sum: false },
      createdAt: new Date().toISOString(),
    });
    touchSession();
    saveRecords();
    els.quickResult.value = "";
    els.quickIssue.value = "";
    els.quickBetSelection.value = "none";
    els.quickStake.value = "";
    els.quickStake.disabled = true;
    els.quickResultPreview.textContent = "输入三个 1–6 的数字";
    els.saveResult.disabled = true;
    els.quickMessage.className = "form-message success";
    els.quickMessage.textContent = betResult.bet
      ? `已记录 ${resultLabel(result)}；本轮${betResult.bet.won ? "赢" : "输"} ${formatMoney(betResult.bet.net, true)}。`
      : `已记录 ${resultLabel(result)}，模型已更新。`;
    renderAll();
    els.quickResult.focus();
  }

  function renderQuickInput() {
    const dice = parseQuickDice(els.quickResult.value);
    els.quickResultPreview.textContent = dice ? `${diceSymbols(dice)}  ${resultLabel(classify(dice))}` : "输入三个 1–6 的数字";
    els.saveResult.disabled = !dice;
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
    els.quickHistoryList.innerHTML = records.slice(0, 12).map((record) => {
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
        <div class="recent-rail-secondary"><span>和值 ${result.sum} · <span class="dice">${diceSymbols(record.officialDice)}</span></span><time>${time}</time></div>
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
    const items = sessionRecords();
    const state = currentModelState(items);
    const crossSession = state.crossSession;
    const sizeConfidence = confidenceState(items, state.evaluation, crossSession, "size");
    const parityConfidence = confidenceState(items, state.evaluation, crossSession, "parity");
    const sizeSignals = signalMetrics(items, "size");
    const paritySignals = signalMetrics(items, "parity");
    const ranked = [...MODEL_DEFINITIONS]
      .map((definition) => ({ ...definition, ...state.evaluation.models[definition.key] }))
      .sort((first, second) => {
        if (first.combined === null) return 1;
        if (second.combined === null) return -1;
        return first.combined - second.combined;
      });
    const score = (value) => Number.isFinite(value) ? value.toFixed(4) : "—";
    els.modelLeaderboard.innerHTML = `
      <div class="leaderboard-head"><span>模型</span><span>大小</span><span>单双</span><span>综合</span></div>
      ${ranked.map((model, index) => {
        const activeFor = [state.activeKeys.size === model.key ? "大小" : "", state.activeKeys.parity === model.key ? "单双" : ""].filter(Boolean);
        return `<div class="leaderboard-row ${activeFor.length ? "active" : ""}">
        <div><strong>${escapeHtml(model.name)}</strong><small>${state.evaluation.rounds ? `综合第 ${index + 1}` : "等待数据"}${activeFor.length ? ` · ${activeFor.join("/")}展示` : ""}</small></div>
        <span>${score(model.size)}</span>
        <span>${score(model.parity)}</span>
        <span><b>${score(model.combined)}</b><small>${model.hitRate === null ? "无方向" : `方向命中 ${(model.hitRate * 100).toFixed(1)}%`}</small></span>
      </div>`;
      }).join("")}`;

    const signedScore = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
    els.modelConfidenceDetails.innerHTML = [
      { metric: "大小", confidence: sizeConfidence },
      { metric: "单双", confidence: parityConfidence },
    ].map(({ metric, confidence }) => {
      const metrics = metric === "大小" ? sizeSignals : paritySignals;
      const coverage = metrics.coverage === null ? "—" : `${(metrics.coverage * 100).toFixed(1)}%`;
      const hitRate = metrics.hitRate === null ? "—" : `${(metrics.hitRate * 100).toFixed(1)}%`;
      return `<article>
      <div><span>${metric}可信度</span><strong>${confidence.label}</strong></div>
      <p>${escapeHtml(modelName(confidence.candidate))} 对比固定 50%</p>
      <small>${confidence.interval.lower === null ? `有效样本 ${confidence.interval.count}/20` : `近似 95% Brier 差值区间 ${signedScore(confidence.interval.lower)} ～ ${signedScore(confidence.interval.upper)}`}</small>
      <small>信号覆盖 ${coverage} · 输出 ${metrics.decisions}/${metrics.eligible} · 命中 ${hitRate}</small>
    </article>`;
    }).join("");

    const stabilityText = (metric, label) => {
      const stableKey = crossSession.stable[metric];
      if (crossSession.qualified < 3) return `<div><span>${label}</span><strong>继续收集</strong><small>${crossSession.qualified}/3 个合格场次</small></div>`;
      if (!stableKey) return `<div><span>${label}</span><strong>尚未稳定</strong><small>没有模型重复胜出</small></div>`;
      return `<div><span>${label}</span><strong>${escapeHtml(modelName(stableKey))}</strong><small>${crossSession.wins[metric][stableKey]}/${crossSession.qualified} 场胜出 · 多场稳定</small></div>`;
    };
    els.crossSessionStability.innerHTML = `<div class="stability-heading"><span>跨场稳定性</span><strong>${crossSession.qualified} 个合格场次</strong></div><div class="stability-grid">${stabilityText("size", "大小")}${stabilityText("parity", "单双")}</div>`;

    const tips = ["每个验证段固定 20 轮，段内展示模型不会切换；五套影子模型持续同步评分。"];
    const legacyCount = items.length - state.evaluation.rounds;
    if (legacyCount > 0) tips.push(`本场有 ${legacyCount} 条旧版或截图记录用于计算概率，但不参与五模型公平排名。`);
    if (state.block.index === 0) {
      tips.push(`首段进度 ${state.block.position}/20；固定使用 50% 基准。`);
    } else {
      const bothBaseline = state.activeKeys.size === "baseline" && state.activeKeys.parity === "baseline";
      tips.push(bothBaseline
        ? `第 ${state.block.index + 1} 段大小与单双均锁定 50% 基准。`
        : `第 ${state.block.index + 1} 段已分别锁定模型；${state.evaluation.rounds < 100 ? "仍处于实验状态。" : "已达到初步比较样本。"}`);
    }
    els.validationList.innerHTML = tips.map((tip) => `<li>${tip}</li>`).join("");
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
        <td><span class="model-record">${predictionText(record.modelPrediction)}</span></td>
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

  function importOcrRecords() {
    ensureSession();
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
    touchSession();
    saveRecords();
    resetOcrResults();
    renderAll();
    els.ocrMessage.className = "form-message success";
    els.ocrMessage.textContent = `已导入当前场次 ${imported.length} 条记录${duplicates ? `，跳过 ${duplicates} 条重复记录` : ""}${invalid ? `，跳过 ${invalid} 条无效记录` : ""}。`;
  }

  function exportCsv() {
    if (!records.length) {
      els.quickMessage.className = "form-message";
      els.quickMessage.textContent = "暂无可导出的记录。";
      return;
    }
    const balances = balanceAfterEachRecord();
    const rows = [["期号/备注", "时间", "场次", "骰子", "和值", "大小", "单双", "当时展示模型", "固定50%预测", "静态贝叶斯预测", "动态贝叶斯预测", "骰子偏差预测", "加权组合预测", "大小信号", "单双信号", "模拟方向", "投入", "赔率", "返还", "净盈亏", "轮后余额", "来源"]];
    records.forEach((record) => {
      const result = classify(record.officialDice);
      rows.push([
        record.issue || "",
        new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false }),
        record.sessionId || "",
        record.officialDice.join("-"),
        result.sum,
        result.triple ? "三同号" : LABELS[result.size],
        LABELS[result.parity],
        predictionText(record.modelPrediction),
        record.modelPredictions ? predictionText(record.modelPredictions.baseline) : "",
        record.modelPredictions ? predictionText(record.modelPredictions.static) : "",
        record.modelPredictions ? predictionText(record.modelPredictions.dynamic) : "",
        record.modelPredictions?.diceBias ? predictionText(record.modelPredictions.diceBias) : "",
        record.modelPredictions?.ensemble ? predictionText(record.modelPredictions.ensemble) : "",
        record.modelPrediction?.signals?.size?.label || "",
        record.modelPrediction?.signals?.parity?.label || "",
        record.bet ? LABELS[record.bet.selection] || record.bet.selection : "",
        record.bet?.stake ?? "",
        record.bet?.odds ?? "",
        record.bet?.payout ?? "",
        record.bet?.net ?? "",
        balances.get(record.id) ?? "",
        record.source || "legacy",
      ]);
    });
    const csv = "\ufeff" + rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
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
  els.startNewSession.addEventListener("click", () => {
    session = newSession();
    els.quickMessage.className = "form-message success";
    els.quickMessage.textContent = "新场次已开始，旧记录仍保留在完整记录中。";
    renderAll();
  });
  els.quickBetSelection.addEventListener("change", () => {
    const enabled = els.quickBetSelection.value !== "none";
    els.quickStake.disabled = !enabled;
    if (!enabled) els.quickStake.value = "";
    els.quickStakeHint.textContent = enabled
      ? bankroll ? `当前模拟余额 ${formatMoney(currentBalance())}；最低投入 2 元。` : "请先在“更多工具”里设置模拟本金。"
      : "选择方向后填写投入；页面不会推荐投入额。";
  });
  els.saveBankroll.addEventListener("click", () => {
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
    els.bankrollMessage.className = "form-message success";
    els.bankrollMessage.textContent = "模拟本金已保存。";
    renderAll();
  });
  els.exportData.addEventListener("click", exportCsv);
  els.clearData.addEventListener("click", () => els.confirmDialog.showModal());
  els.confirmDialog.addEventListener("close", () => {
    if (els.confirmDialog.returnValue !== "confirm") return;
    records = [];
    saveRecords();
    session = newSession();
    renderAll();
  });
  els.recordsBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-id]");
    if (!button) return;
    records = records.filter((record) => record.id !== button.dataset.deleteId);
    saveRecords();
    renderAll();
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

  renderAll();
})();
