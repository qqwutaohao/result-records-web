(() => {
  "use strict";

  const STORAGE_KEY = "k3-verifier-records-v1";
  const RULE_KEY = "k3-verifier-exclude-triples-v1";
  const BANKROLL_KEY = "k3-verifier-bankroll-v1";
  const TITLE_KEY = "k3-verifier-title-v1";
  const PENDING_KEY = "k3-verifier-pending-v1";
  const STREAMER_KEY = "k3-verifier-streamer-v1";
  const STREAMER_PROFILES_KEY = "k3-verifier-streamer-profiles-v1";
  const STREAMER_SESSIONS_KEY = "k3-verifier-streamer-sessions-v1";
  const DEFAULT_TITLE = "结果记录台";
  const DEFAULT_STREAMER = "默认主播";
  const SESSION_GAP_MS = 30 * 60 * 1000;
  const ODDS = 1.96;
  const OCR_SCRIPT = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  const LABELS = { big: "大", small: "小", odd: "单", even: "双", triple: "三同号" };
  const COMBOS = [
    { key: "big-odd", label: "大单", tone: "#5eead4" },
    { key: "big-even", label: "大双", tone: "#7dd3fc" },
    { key: "small-odd", label: "小单", tone: "#c4b5fd" },
    { key: "small-even", label: "小双", tone: "#f9a8d4" },
  ];

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const els = {
    excludeTriples: $("#exclude-triples"),
    appTitle: $("#app-title"),
    appTitleInput: $("#app-title-input"),
    editTitle: $("#edit-title"),
    titleMessage: $("#title-message"),
    quickBalance: $("#quick-balance"),
    quickWatch: $("#quick-watch"),
    lockPrediction: $("#lock-prediction"),
    quickAnalysis: $("#quick-analysis"),
    quickAnalysisTitle: $("#quick-analysis-title"),
    quickAnalysisText: $("#quick-analysis-text"),
    quickBaseline: $("#quick-baseline"),
    quickResult: $("#quick-result"),
    quickResultPreview: $("#quick-result-preview"),
    settlePrediction: $("#settle-prediction"),
    quickMessage: $("#quick-message"),
    quickHistoryCount: $("#quick-history-count"),
    quickHistoryList: $("#quick-history-list"),
    quickStreamer: $("#quick-streamer"),
    manageStreamers: $("#manage-streamers"),
    quickProfileStatus: $("#quick-profile-status"),
    streamerDialog: $("#streamer-dialog"),
    managedStreamerName: $("#managed-streamer-name"),
    managedStreamerCount: $("#managed-streamer-count"),
    newStreamerName: $("#new-streamer-name"),
    addStreamer: $("#add-streamer"),
    startNewSession: $("#start-new-session"),
    resetStreamer: $("#reset-streamer"),
    deleteStreamer: $("#delete-streamer"),
    streamerMessage: $("#streamer-message"),
    initialBankroll: $("#initial-bankroll"),
    saveBankroll: $("#save-bankroll"),
    bankrollMessage: $("#bankroll-message"),
    initialBalance: $("#initial-balance"),
    currentBalance: $("#current-balance"),
    totalProfit: $("#total-profit"),
    returnRate: $("#return-rate"),
    hostCategoryFields: $("#host-category-fields"),
    hostDiceFields: $("#host-dice-fields"),
    hostSize: $("#host-size"),
    hostParity: $("#host-parity"),
    officialPreview: $("#official-preview"),
    officialQuick: $("#official-quick"),
    hostPreview: $("#host-preview"),
    issue: $("#issue"),
    betDimension: $("#bet-dimension"),
    stake: $("#stake"),
    stakeHint: $("#stake-hint"),
    addRecord: $("#add-record"),
    formMessage: $("#form-message"),
    probabilityCards: $("#probability-cards"),
    probabilityNote: $("#probability-note"),
    sampleCount: $("#sample-count"),
    historyStats: $("#history-stats"),
    adviceList: $("#advice-list"),
    recordsBody: $("#records-body"),
    recordsEmpty: $("#records-empty"),
    exportData: $("#export-data"),
    clearData: $("#clear-data"),
    confirmDialog: $("#confirm-dialog"),
    confirmTitle: $("#confirm-title"),
    confirmText: $("#confirm-text"),
    confirmSubmit: $("#confirm-submit"),
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
  let pendingPrediction = loadPendingPrediction();
  let streamerProfiles = loadStreamerProfiles();
  let streamerSessions = loadStreamerSessions();
  let selectedStreamer = loadSelectedStreamer();
  if (!streamerProfiles.includes(selectedStreamer)) streamerProfiles.push(selectedStreamer);
  if (pendingPrediction?.streamerName && !streamerProfiles.includes(normalizeStreamer(pendingPrediction.streamerName))) {
    streamerProfiles.push(normalizeStreamer(pendingPrediction.streamerName));
  }
  saveStreamerProfiles();
  let quickDraft = { size: "", parity: "" };
  let confirmAction = { type: "clear-all" };
  let ocrCandidates = [];
  let ocrRawSections = [];
  let ocrLibraryPromise = null;
  els.excludeTriples.checked = localStorage.getItem(RULE_KEY) !== "false";
  if (bankroll) els.initialBankroll.value = bankroll.initial;

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

  applyTitle(localStorage.getItem(TITLE_KEY) || DEFAULT_TITLE);

  function loadRecords() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
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

  function saveBankroll() {
    localStorage.setItem(BANKROLL_KEY, JSON.stringify(bankroll));
  }

  function loadPendingPrediction() {
    try {
      const saved = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
      return saved && saved.id && typeof saved.observe === "boolean" ? saved : null;
    } catch {
      return null;
    }
  }

  function savePendingPrediction() {
    if (pendingPrediction) localStorage.setItem(PENDING_KEY, JSON.stringify(pendingPrediction));
    else localStorage.removeItem(PENDING_KEY);
  }

  function normalizeStreamer(value) {
    return String(value || "").trim().slice(0, 20) || DEFAULT_STREAMER;
  }

  function loadSelectedStreamer() {
    return normalizeStreamer(localStorage.getItem(STREAMER_KEY));
  }

  function belongsToStreamer(record, streamerName) {
    return (record.host || record.validation?.label === "主播观望") && recordStreamer(record) === streamerName;
  }

  function loadStreamerProfiles() {
    let saved = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(STREAMER_PROFILES_KEY) || "[]");
      if (Array.isArray(parsed)) saved = parsed.map(normalizeStreamer);
    } catch {
      saved = [];
    }
    records.forEach((record) => {
      if (record.host || record.validation?.label === "主播观望") saved.push(recordStreamer(record));
    });
    const unique = [...new Set(saved)];
    return unique.length ? unique : [DEFAULT_STREAMER];
  }

  function saveStreamerProfiles() {
    localStorage.setItem(STREAMER_PROFILES_KEY, JSON.stringify(streamerProfiles));
  }

  function saveSelectedStreamer(value) {
    selectedStreamer = normalizeStreamer(value);
    if (!streamerProfiles.includes(selectedStreamer)) streamerProfiles.push(selectedStreamer);
    saveStreamerProfiles();
    localStorage.setItem(STREAMER_KEY, selectedStreamer);
  }

  function recordStreamer(record) {
    return normalizeStreamer(record.streamerName);
  }

  function loadStreamerSessions() {
    try {
      const saved = JSON.parse(localStorage.getItem(STREAMER_SESSIONS_KEY) || "{}");
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch {
      return {};
    }
  }

  function saveStreamerSessions() {
    localStorage.setItem(STREAMER_SESSIONS_KEY, JSON.stringify(streamerSessions));
  }

  function sameLocalDay(first, second) {
    return first.getFullYear() === second.getFullYear()
      && first.getMonth() === second.getMonth()
      && first.getDate() === second.getDate();
  }

  function sessionIsActive(lastActiveAt) {
    const last = new Date(lastActiveAt);
    const now = new Date();
    return Number.isFinite(last.getTime()) && sameLocalDay(last, now) && now.getTime() - last.getTime() <= SESSION_GAP_MS;
  }

  function createSession(streamerName) {
    const now = new Date().toISOString();
    const session = { id: `session-${Date.now()}-${Math.random().toString(16).slice(2)}`, lastActiveAt: now };
    streamerSessions[streamerName] = session;
    saveStreamerSessions();
    return session.id;
  }

  function currentSessionId(streamerName, create = false) {
    const saved = streamerSessions[streamerName];
    if (saved?.id && sessionIsActive(saved.lastActiveAt)) return saved.id;
    const latest = records.find((record) => belongsToStreamer(record, streamerName));
    if (latest?.sessionId && sessionIsActive(latest.createdAt)) {
      streamerSessions[streamerName] = { id: latest.sessionId, lastActiveAt: latest.createdAt };
      saveStreamerSessions();
      return latest.sessionId;
    }
    return create ? createSession(streamerName) : null;
  }

  function touchSession(streamerName, sessionId) {
    streamerSessions[streamerName] = { id: sessionId, lastActiveAt: new Date().toISOString() };
    saveStreamerSessions();
  }

  function activeSessionId(streamerName) {
    return currentSessionId(streamerName, true);
  }

  function streamerStats(streamerName, sessionId = null) {
    const all = records.filter((record) => record.host && recordStreamer(record) === streamerName);
    const session = sessionId ? all.filter((record) => record.sessionId === sessionId) : [];
    const recent = session.slice(0, 20);
    const summarize = (items) => ({ total: items.length, matched: items.filter((record) => record.validation?.category).length });
    return { all: summarize(all), recent: summarize(recent), session: summarize(session) };
  }

  function confidenceLabel(total) {
    if (total < 10) return `收集中 ${total}/10`;
    if (total < 20) return "低可信度";
    if (total < 50) return "初步趋势";
    return "可供复盘";
  }

  function formatRatio(summary) {
    return summary.total ? `${summary.matched}/${summary.total}` : "0/0";
  }

  function renderStreamerProfiles() {
    const active = pendingPrediction ? normalizeStreamer(pendingPrediction.streamerName) : selectedStreamer;
    els.quickStreamer.innerHTML = streamerProfiles.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
    els.quickStreamer.value = active;
  }

  function renderStreamerDialog() {
    const count = records.filter((record) => belongsToStreamer(record, selectedStreamer)).length;
    const sessionId = currentSessionId(selectedStreamer, false);
    const currentCount = sessionId ? records.filter((record) => belongsToStreamer(record, selectedStreamer) && record.sessionId === sessionId).length : 0;
    els.managedStreamerName.textContent = selectedStreamer;
    els.managedStreamerCount.textContent = `本场 ${currentCount} 轮 · 档案 ${count} 轮`;
    els.resetStreamer.disabled = count === 0;
    els.deleteStreamer.disabled = streamerProfiles.length <= 1;
    els.deleteStreamer.title = streamerProfiles.length <= 1 ? "至少保留一个主播档案" : "";
  }

  function addStreamerProfile() {
    const raw = els.newStreamerName.value.trim();
    if (!raw) {
      els.streamerMessage.textContent = "请输入主播名称。";
      els.newStreamerName.focus();
      return;
    }
    const name = normalizeStreamer(raw);
    const existed = streamerProfiles.includes(name);
    if (!existed) streamerProfiles.push(name);
    saveSelectedStreamer(name);
    createSession(name);
    els.newStreamerName.value = "";
    els.streamerMessage.className = "form-message success";
    els.streamerMessage.textContent = existed ? "该主播已存在，已切换并开始新场次。" : "主播已添加并开始新场次。";
    renderAll();
    renderStreamerDialog();
  }

  function beginNewSession(streamerName) {
    cancelPendingForStreamer(streamerName);
    createSession(streamerName);
    els.quickMessage.className = "form-message success";
    els.quickMessage.textContent = `“${streamerName}”已开始新场次，本场统计从 0 轮开始。`;
  }

  function cancelPendingForStreamer(streamerName) {
    if (!pendingPrediction || normalizeStreamer(pendingPrediction.streamerName) !== streamerName) return;
    pendingPrediction = null;
    quickDraft = { size: "", parity: "" };
    els.quickResult.value = "";
    savePendingPrediction();
  }

  function openConfirm(type, streamerName = null) {
    confirmAction = { type, streamerName };
    if (type === "reset-streamer") {
      els.confirmTitle.textContent = `重置“${streamerName}”的历史？`;
      els.confirmText.textContent = "将删除该主播的全部轮次，但保留主播档案。此操作无法撤销。";
      els.confirmSubmit.textContent = "确认重置";
    } else if (type === "delete-streamer") {
      els.confirmTitle.textContent = `删除“${streamerName}”？`;
      els.confirmText.textContent = "将同时删除该主播档案及其全部轮次。此操作无法撤销。";
      els.confirmSubmit.textContent = "确认删除";
    } else {
      els.confirmTitle.textContent = "清空全部轮次？";
      els.confirmText.textContent = "此操作无法撤销，验证与资金流水会被删除；主播档案和模拟本金保留。";
      els.confirmSubmit.textContent = "确认清空";
    }
    els.confirmDialog.showModal();
  }

  function resetStreamerHistory(streamerName) {
    records = records.filter((record) => !belongsToStreamer(record, streamerName));
    cancelPendingForStreamer(streamerName);
    createSession(streamerName);
    saveRecords();
    els.quickMessage.className = "form-message success";
    els.quickMessage.textContent = `已重置“${streamerName}”的历史记录。`;
  }

  function deleteStreamerProfile(streamerName) {
    if (streamerProfiles.length <= 1) return;
    records = records.filter((record) => !belongsToStreamer(record, streamerName));
    streamerProfiles = streamerProfiles.filter((name) => name !== streamerName);
    delete streamerSessions[streamerName];
    cancelPendingForStreamer(streamerName);
    if (selectedStreamer === streamerName) selectedStreamer = streamerProfiles[0];
    saveStreamerProfiles();
    saveStreamerSessions();
    saveSelectedStreamer(selectedStreamer);
    saveRecords();
    els.quickMessage.className = "form-message success";
    els.quickMessage.textContent = `已删除“${streamerName}”及其历史记录。`;
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
      required = Math.max(required, record.bet.stake - cumulativeNet);
      cumulativeNet = roundMoney(cumulativeNet + record.bet.net);
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

  function activeHostMode() {
    return $("input[name='host-mode']:checked").value;
  }

  function readDice(prefix) {
    const values = [1, 2, 3].map((index) => Number($("#" + prefix + "-" + index).value));
    return values.every((value) => Number.isInteger(value) && value >= 1 && value <= 6) ? values : null;
  }

  function parseQuickDice(value) {
    const allDigits = String(value).match(/\d/g) || [];
    return allDigits.length === 3 && allDigits.every((digit) => /^[1-6]$/.test(digit))
      ? allDigits.map(Number)
      : null;
  }

  function fillOfficialDice(dice) {
    dice.forEach((value, index) => { $("#official-" + (index + 1)).value = value; });
    renderPreviews();
  }

  function classify(dice, excludeTriples = els.excludeTriples.checked) {
    const sum = dice.reduce((total, value) => total + value, 0);
    const triple = dice.every((value) => value === dice[0]);
    if (excludeTriples && triple) {
      return { sum, triple, size: "triple", parity: "triple", combo: "triple" };
    }
    const size = sum >= 11 ? "big" : "small";
    const parity = sum % 2 ? "odd" : "even";
    return { sum, triple, size, parity, combo: `${size}-${parity}` };
  }

  function diceSymbols(dice) {
    return dice.map((value) => `[${value}]`).join(" ");
  }

  function resultLabel(result) {
    if (result.combo === "triple") return `和值 ${result.sum} · 三同号`;
    return `和值 ${result.sum} · ${LABELS[result.size]}${LABELS[result.parity]}${result.triple ? " · 三同号" : ""}`;
  }

  function predictionLabel(host) {
    if (!host) return "主播观望";
    return [host.size, host.parity].filter(Boolean).map((value) => LABELS[value]).join(" · ");
  }

  function predictionProbability(host, excludeTriples) {
    if (!host) return null;
    const counts = enumerateProbabilities(excludeTriples);
    if (host.size && host.parity) return counts[`${host.size}-${host.parity}`] / 216;
    if (host.size) return (counts[`${host.size}-odd`] + counts[`${host.size}-even`]) / 216;
    return (counts[`big-${host.parity}`] + counts[`small-${host.parity}`]) / 216;
  }

  function predictionHistory(host, streamerName, sessionId) {
    if (!host) return { total: 0, matched: 0, systemTotal: 0, systemMatched: 0 };
    const matchesHost = (record) => {
      if (!record.host) return false;
      const recordedHost = record.host.mode === "dice" ? classify(record.host.dice, record.excludeTriples) : record.host;
      return (!host.size || recordedHost.size === host.size)
        && (!host.parity || recordedHost.parity === host.parity);
    };
    const matchesOfficial = (record) => {
      const official = classify(record.officialDice, record.excludeTriples);
      return (!host.size || official.size === host.size) && (!host.parity || official.parity === host.parity);
    };
    const comparable = records.filter((record) => record.officialDice && record.sessionId === sessionId && recordStreamer(record) === streamerName && matchesHost(record));
    const recent = records.filter((record) => record.officialDice && record.sessionId === sessionId).slice(0, 20);
    return {
      total: comparable.length,
      matched: comparable.filter(matchesOfficial).length,
      systemTotal: recent.length,
      systemMatched: recent.filter(matchesOfficial).length,
    };
  }

  function systemSnapshot(excludeTriples, sessionId) {
    const recent = records.filter((record) => record.officialDice && record.sessionId === sessionId).slice(0, 20);
    const counts = { big: 0, small: 0, odd: 0, even: 0, triple: 0 };
    recent.forEach((record) => {
      const result = classify(record.officialDice, excludeTriples);
      if (result.combo === "triple") counts.triple += 1;
      else {
        counts[result.size] += 1;
        counts[result.parity] += 1;
      }
    });
    return { total: recent.length, counts };
  }

  function renderQuickBaseline(excludeTriples) {
    const counts = enumerateProbabilities(excludeTriples);
    const single = (counts["big-odd"] + counts["big-even"]) / 216;
    els.quickBaseline.innerHTML = `
      <span>理论基线 · 大/小/单/双单项均为 ${(single * 100).toFixed(2)}%</span>
      <div class="quick-baseline-grid">${COMBOS.map(({ key, label }) => `<span>${label}<b>${((counts[key] / 216) * 100).toFixed(2)}%</b></span>`).join("")}</div>`;
  }

  function renderQuickRound() {
    els.quickBalance.textContent = bankroll ? `余额 ${formatMoney(currentBalance())}` : "余额未设置";
    const locked = Boolean(pendingPrediction);
    const streamerName = locked ? normalizeStreamer(pendingPrediction.streamerName) : normalizeStreamer(els.quickStreamer.value);
    const sessionId = locked ? pendingPrediction.sessionId : currentSessionId(streamerName, false);
    const profile = streamerStats(streamerName, sessionId);
    renderQuickBaseline(locked ? pendingPrediction.excludeTriples : els.excludeTriples.checked);
    els.quickStreamer.disabled = locked;
    els.manageStreamers.disabled = locked;
    if (locked) els.quickStreamer.value = streamerName;
    els.quickProfileStatus.textContent = confidenceLabel(profile.session.total);
    $$('[data-quick-size], [data-quick-parity]').forEach((button) => {
      const dimension = button.dataset.quickSize ? "size" : "parity";
      const value = button.dataset.quickSize || button.dataset.quickParity;
      const selected = locked
        ? !pendingPrediction.observe && pendingPrediction.host?.[dimension] === value
        : quickDraft[dimension] === value;
      button.classList.toggle("selected", selected);
      button.disabled = locked;
    });
    els.quickWatch.disabled = locked;
    els.lockPrediction.textContent = locked ? "取消预判" : "确认预判";
    els.lockPrediction.classList.toggle("secondary-button", locked);
    els.lockPrediction.classList.toggle("primary-button", !locked);
    els.quickResult.disabled = !locked;

    if (!locked) {
      els.quickAnalysis.classList.remove("ready");
      els.quickAnalysisTitle.textContent = `${streamerName} · 等待预判`;
      els.quickAnalysisText.textContent = profile.session.total < 10
        ? `本场已记录 ${profile.session.total}/10 轮。旧档案 ${Math.max(0, profile.all.total - profile.session.total)} 轮不参与本场统计。`
        : `本场 ${formatRatio(profile.session)} · ${confidenceLabel(profile.session.total)}。继续先锁定主播预判，再输入结果验证。`;
      els.quickResultPreview.textContent = "确认预判后输入结果";
      els.settlePrediction.disabled = true;
      return;
    }

    els.quickAnalysis.classList.add("ready");
    if (pendingPrediction.observe) {
      const snapshot = systemSnapshot(pendingPrediction.excludeTriples, sessionId);
      els.quickAnalysisTitle.textContent = `${streamerName} · 主播观望`;
      els.quickAnalysisText.textContent = snapshot.total
        ? `本场 ${snapshot.total} 期：大 ${snapshot.counts.big}、小 ${snapshot.counts.small}、单 ${snapshot.counts.odd}、双 ${snapshot.counts.even}${snapshot.counts.triple ? `、三同号 ${snapshot.counts.triple}` : ""}。结论：观望。`
        : "本场暂无历史记录。独立随机下没有可验证的方向优势；结论：观望。";
    } else {
      const host = pendingPrediction.host;
      const probability = predictionProbability(host, pendingPrediction.excludeTriples);
      const history = predictionHistory(host, streamerName, sessionId);
      els.quickAnalysisTitle.textContent = `${streamerName} · ${predictionLabel(host)} · 理论 ${(probability * 100).toFixed(2)}%`;
      els.quickAnalysisText.textContent = profile.session.total < 10
        ? `本场 ${profile.session.total}/10 轮，仍在收集；该方向本场出现 ${history.systemMatched}/${history.systemTotal}。旧数据不参与；结论：观望。`
        : `本场 ${formatRatio(profile.session)}；本场近20轮 ${formatRatio(profile.recent)}（${confidenceLabel(profile.session.total)}）。该方向本场出现 ${history.systemMatched}/${history.systemTotal}；结论：观望。`;
    }
    const dice = parseQuickDice(els.quickResult.value);
    els.quickResultPreview.textContent = dice ? resultLabel(classify(dice, pendingPrediction.excludeTriples)) : "输入三个 1–6 的数字";
    els.settlePrediction.disabled = !dice;
  }

  function renderQuickHistory() {
    els.quickHistoryCount.textContent = `${records.length} 期`;
    if (!records.length) {
      els.quickHistoryList.innerHTML = '<p class="recent-rail-empty">暂无记录</p>';
      return;
    }
    els.quickHistoryList.innerHTML = records.slice(0, 10).map((record) => {
      const official = classify(record.officialDice, record.excludeTriples);
      const time = new Date(record.createdAt).toLocaleString("zh-CN", {
        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
      });
      const categories = official.combo === "triple"
        ? '<strong class="category-chip triple">三同号</strong>'
        : `<strong class="category-chip size">${LABELS[official.size]}</strong><strong class="category-chip parity">${LABELS[official.parity]}</strong>`;
      return `<article class="recent-rail-item">
        <span class="recent-rail-dot" aria-hidden="true"></span>
        <div class="recent-rail-primary">
          <div class="recent-rail-categories">${categories}</div>
          <span class="status ${record.validation.code}">${record.validation.label}</span>
        </div>
        <div class="recent-rail-secondary">
          <span>和值 ${official.sum} · <span class="dice">${diceSymbols(record.officialDice)}</span></span>
          <time>${time}</time>
        </div>
      </article>`;
    }).join("");
  }

  function lockQuickPrediction(observe = false) {
    if (!observe && !quickDraft.size && !quickDraft.parity) {
      els.quickMessage.textContent = "请选择主播预判，或点击“主播观望”。";
      return;
    }
    const streamerName = normalizeStreamer(els.quickStreamer.value);
    saveSelectedStreamer(streamerName);
    pendingPrediction = {
      id: `pending-${Date.now()}`,
      observe,
      host: observe ? null : { mode: "category", size: quickDraft.size, parity: quickDraft.parity },
      streamerName,
      sessionId: activeSessionId(streamerName),
      excludeTriples: els.excludeTriples.checked,
      lockedAt: new Date().toISOString(),
    };
    savePendingPrediction();
    els.quickMessage.className = "form-message success";
    els.quickMessage.textContent = observe ? "已记录主播观望，等待开奖结果。" : `已锁定：${predictionLabel(pendingPrediction.host)}。`;
    renderQuickRound();
    els.quickResult.focus();
  }

  function cancelQuickPrediction() {
    pendingPrediction = null;
    savePendingPrediction();
    els.quickResult.value = "";
    els.quickMessage.className = "form-message";
    els.quickMessage.textContent = "预判已取消，可重新选择。";
    renderQuickRound();
  }

  function settleQuickPrediction() {
    if (!pendingPrediction) return;
    const dice = parseQuickDice(els.quickResult.value);
    if (!dice) {
      els.quickMessage.textContent = "请输入三个 1–6 的数字。";
      return;
    }
    const host = pendingPrediction.host;
    const streamerName = normalizeStreamer(pendingPrediction.streamerName);
    const sessionId = pendingPrediction.sessionId || activeSessionId(streamerName);
    const validation = host
      ? validateRecord(dice, host, pendingPrediction.excludeTriples)
      : { code: "unverified", label: "主播观望", exact: false, category: false, sum: false };
    records.unshift({
      id: `quick-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      issue: "一分钟验证",
      officialDice: dice,
      host,
      bet: null,
      source: "quick",
      streamerName,
      sessionId,
      excludeTriples: pendingPrediction.excludeTriples,
      validation,
      predictionLockedAt: pendingPrediction.lockedAt,
      createdAt: new Date().toISOString(),
    });
    touchSession(streamerName, sessionId);
    saveRecords();
    pendingPrediction = null;
    quickDraft = { size: "", parity: "" };
    savePendingPrediction();
    els.quickResult.value = "";
    els.quickMessage.className = "form-message success";
    els.quickMessage.textContent = host ? `已验证：${validation.label}。` : "已记录开奖结果：主播本轮观望。";
    renderAll();
  }

  function hostFromForm() {
    const mode = activeHostMode();
    if (mode === "dice") {
      const dice = readDice("host");
      return dice ? { mode, dice } : null;
    }
    const size = els.hostSize.value;
    const parity = els.hostParity.value;
    return size || parity ? { mode, size, parity } : null;
  }

  function validateRecord(officialDice, host, excludeTriples) {
    const official = classify(officialDice, excludeTriples);
    if (host.mode === "dice") {
      const hostResult = classify(host.dice, excludeTriples);
      const exact = [...officialDice].sort().join("") === [...host.dice].sort().join("");
      const category = official.combo === hostResult.combo;
      const sum = official.sum === hostResult.sum;
      return {
        code: exact ? "match" : category ? "partial" : "mismatch",
        label: exact ? "骰子一致" : category ? "方向一致" : "不一致",
        exact,
        category,
        sum,
      };
    }
    const checks = [];
    if (host.size) checks.push(host.size === official.size);
    if (host.parity) checks.push(host.parity === official.parity);
    const matched = checks.length > 0 && checks.every(Boolean);
    return { code: matched ? "match" : "mismatch", label: matched ? "口播一致" : "口播不一致", exact: false, category: matched, sum: false };
  }

  function betFromForm(officialDice, host, excludeTriples) {
    const dimension = els.betDimension.value;
    if (dimension === "none") return { bet: null };
    if (!bankroll) return { error: "请先设置模拟本金。" };

    const stake = roundMoney(Number(els.stake.value));
    if (!Number.isFinite(stake) || stake < 2) return { error: "本轮投入最低为 2 元。" };
    if (stake > currentBalance()) return { error: `本轮投入不能超过当前模拟余额 ${formatMoney(currentBalance())}。` };

    const official = classify(officialDice, excludeTriples);
    const hostResult = host.mode === "dice" ? classify(host.dice, excludeTriples) : host;
    const selection = hostResult[dimension];
    const validSelections = dimension === "size" ? ["big", "small"] : ["odd", "even"];
    if (!validSelections.includes(selection)) {
      return { error: `主播没有可用于本轮测试的${dimension === "size" ? "大小" : "单双"}方向。` };
    }

    const outcome = official[dimension];
    const won = selection === outcome;
    const payout = won ? roundMoney(stake * ODDS) : 0;
    const net = won ? roundMoney(payout - stake) : -stake;
    return {
      bet: { dimension, selection, outcome, stake, odds: ODDS, won, payout, net },
    };
  }

  function enumerateProbabilities(excludeTriples) {
    const counts = { "big-odd": 0, "big-even": 0, "small-odd": 0, "small-even": 0, triple: 0 };
    for (let a = 1; a <= 6; a += 1) {
      for (let b = 1; b <= 6; b += 1) {
        for (let c = 1; c <= 6; c += 1) counts[classify([a, b, c], excludeTriples).combo] += 1;
      }
    }
    return counts;
  }

  function renderProbabilities() {
    const counts = enumerateProbabilities(els.excludeTriples.checked);
    els.probabilityCards.innerHTML = COMBOS.map(({ key, label, tone }) => `
      <article class="probability-card" style="--tone:${tone}">
        <span class="label">${label}</span>
        <strong>${((counts[key] / 216) * 100).toFixed(2)}%</strong>
        <small>${counts[key]} / 216 种</small>
      </article>`).join("");
    els.probabilityNote.textContent = els.excludeTriples.checked
      ? `另有三同号 6 / 216（2.78%）不计大小单双；大小、单双单项各为 105 / 216（48.61%）。`
      : "三同号已并入对应的大小与单双；大小、单双单项各为 108 / 216（50.00%）。";
  }

  function renderPreviews() {
    const officialDice = readDice("official");
    els.officialPreview.classList.toggle("muted", !officialDice);
    els.officialPreview.textContent = officialDice
      ? `${diceSymbols(officialDice)}  ${resultLabel(classify(officialDice))}`
      : "等待输入完整结果";

    const host = hostFromForm();
    els.hostPreview.classList.toggle("muted", !host);
    if (!host) {
      els.hostPreview.textContent = "等待主播结果";
    } else if (host.mode === "dice") {
      els.hostPreview.textContent = `${diceSymbols(host.dice)}  ${resultLabel(classify(host.dice))}`;
    } else {
      const labels = [host.size, host.parity].filter(Boolean).map((value) => LABELS[value]);
      els.hostPreview.textContent = `主播口播：${labels.join(" · ")}`;
    }
  }

  function formatHost(record) {
    if (!record.host) return record.validation?.label === "主播观望"
      ? `<strong>主播观望</strong><span class="subline">${escapeHtml(recordStreamer(record))} · 仅记录官方结果</span>`
      : `<strong>截图导入</strong><span class="subline">待补主播结果</span>`;
    if (record.host.mode === "dice") {
      const result = classify(record.host.dice, record.excludeTriples);
      return `<span class="dice">${diceSymbols(record.host.dice)}</span><span class="subline">${escapeHtml(recordStreamer(record))} · ${resultLabel(result)}</span>`;
    }
    const values = [record.host.size, record.host.parity].filter(Boolean).map((value) => LABELS[value]);
    return `<strong>${values.join(" · ")}</strong><span class="subline">${escapeHtml(recordStreamer(record))} · 主播口播</span>`;
  }

  function renderHistory() {
    els.sampleCount.textContent = `${records.length} 期`;
    const counts = Object.fromEntries(COMBOS.map(({ key }) => [key, 0]));
    let triples = 0;
    records.forEach((record) => {
      const combo = classify(record.officialDice, record.excludeTriples).combo;
      if (combo === "triple") triples += 1;
      else counts[combo] += 1;
    });

    if (!records.length) {
      els.historyStats.className = "history-stats empty-state";
      els.historyStats.textContent = "录入后显示历史频率与核对情况。";
      return;
    }

    const comparable = records.filter((record) => record.host);
    const verified = comparable.filter((record) => record.validation.code !== "mismatch").length;
    els.historyStats.className = "history-stats";
    els.historyStats.innerHTML = COMBOS.map(({ key, label }) => {
      const percent = (counts[key] / records.length) * 100;
      return `<div class="stat-row"><span>${label}</span><div class="bar"><i style="width:${percent.toFixed(1)}%"></i></div><span>${counts[key]} · ${percent.toFixed(1)}%</span></div>`;
    }).join("") + `
      <div class="validation-summary">
        <div><strong>${verified} / ${comparable.length}</strong>主播方向相符</div>
        <div><strong>${triples}</strong>三同号记录</div>
      </div>`;
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
    const balance = currentBalance();
    els.initialBalance.textContent = formatMoney(bankroll.initial);
    els.currentBalance.textContent = formatMoney(balance);
    els.totalProfit.textContent = formatMoney(net, true);
    els.returnRate.textContent = `${net > 0 ? "+" : ""}${((net / bankroll.initial) * 100).toFixed(2)}%`;
    els.totalProfit.className = net > 0 ? "positive" : net < 0 ? "negative" : "";
    els.returnRate.className = els.totalProfit.className;
    els.saveBankroll.textContent = "更新本金";
  }

  function longestRecentStreak() {
    if (!records.length) return null;
    const latestFirst = records.map((record) => classify(record.officialDice, record.excludeTriples).combo);
    const target = latestFirst[0];
    let length = 0;
    for (const combo of latestFirst) {
      if (combo !== target) break;
      length += 1;
    }
    return { combo: target, length };
  }

  function renderAdvice() {
    const tips = [];
    const comparable = records.filter((record) => record.host);
    if (comparable.length < 20) {
      tips.push(`当前有 ${records.length} 期结果，其中 ${comparable.length} 期含主播数据，样本不足以评价主播稳定性。`);
    } else {
      const matched = comparable.filter((record) => record.validation.code !== "mismatch").length;
      tips.push(`主播方向相符率为 ${((matched / comparable.length) * 100).toFixed(1)}%，它是历史核对值，不是下一期命中率。`);
    }
    const streak = longestRecentStreak();
    if (streak && streak.length >= 3) {
      tips.push(`最近连续 ${streak.length} 期为${LABELS[streak.combo.split("-")[0]] || "三同号"}${LABELS[streak.combo.split("-")[1]] || ""}，连开不会提高下一期反转或延续的概率。`);
    } else {
      tips.push("下一期仍按理论概率看待，不用近期冷热走势替代随机性。 ");
    }
    const testedRecords = records.filter((record) => record.bet);
    if (!bankroll) {
      tips.push("尚未设置模拟本金；本金应是即使全部损失也不影响生活的独立测试额度。");
    } else if (!testedRecords.length) {
      tips.push("模拟本金已设置，但还没有金额测试记录。页面不会自动替你决定投入额。");
    } else {
      const net = totalNet();
      const balance = currentBalance();
      const wins = testedRecords.filter((record) => record.bet.won).length;
      const totalStaked = roundMoney(testedRecords.reduce((total, record) => total + record.bet.stake, 0));
      tips.push(`已测试 ${testedRecords.length} 轮，投入累计 ${formatMoney(totalStaked)}，胜率 ${((wins / testedRecords.length) * 100).toFixed(1)}%，当前净额 ${formatMoney(net, true)}。`);
      const drawdown = balance < bankroll.initial ? ((bankroll.initial - balance) / bankroll.initial) * 100 : 0;
      if (drawdown >= 20) tips.push(`当前本金回撤 ${drawdown.toFixed(1)}%，已达到明显风险区，建议停止测试并复盘，而不是增加投入追回损失。`);

      const chronological = [...testedRecords].reverse();
      const chaseCount = chronological.slice(1).filter((record, index) => !chronological[index].bet.won && record.bet.stake > chronological[index].bet.stake).length;
      if (chaseCount) tips.push(`检测到 ${chaseCount} 次亏损后提高投入，属于追损行为；赔率 1.96 下它只会放大余额波动。`);
    }
    tips.push("如参与娱乐，先设固定预算和时间上限；不借款、不追损，也不因主播连续命中而加码。");
    els.adviceList.innerHTML = tips.map((tip) => `<li>${tip}</li>`).join("");
  }

  function renderRecords() {
    els.recordsEmpty.classList.toggle("hidden", records.length > 0);
    const balances = balanceAfterEachRecord();
    els.recordsBody.innerHTML = records.map((record) => {
      const official = classify(record.officialDice, record.excludeTriples);
      const time = new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false });
      const bet = record.bet;
      const settlement = bet
        ? `<strong>${LABELS[bet.selection]} · ${formatMoney(bet.stake)}</strong><span class="subline">返还 ${formatMoney(bet.payout)} · <span class="${bet.net > 0 ? "positive" : "negative"}">${formatMoney(bet.net, true)}</span></span>`
        : `<span class="muted">未测试</span>`;
      return `<tr>
        <td><strong>${escapeHtml(record.issue || "未填期号")}</strong><span class="subline">${time}</span></td>
        <td><span class="dice">${diceSymbols(record.officialDice)}</span><span class="subline">${resultLabel(official)}</span></td>
        <td>${formatHost(record)}</td>
        <td><span class="status ${record.validation.code}">${record.validation.label}</span></td>
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
      const compactTriples = tokens.filter((token) => /^[1-6]{3}$/.test(token));
      const singleDice = tokens.filter((token) => /^[1-6]$/.test(token));
      const groups = compactTriples.map((token) => [...token].map(Number));
      if (!groups.length && singleDice.length === 3) groups.push(singleDice.map(Number));
      const issueToken = tokens.find((token) => token.length >= 4) || "";
      groups.forEach((dice, groupIndex) => {
        candidates.push({
          id: `${fileName}-${lineIndex}-${groupIndex}`,
          issue: issueToken ? `截图 ${issueToken}` : "截图导入",
          dice,
          rawLine: line,
          fileName,
        });
      });
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
        <div class="ocr-candidate-dice">
          ${candidate.dice.map((value, dieIndex) => `<input type="number" min="1" max="6" value="${value}" aria-label="骰子 ${dieIndex + 1}" />`).join("")}
        </div>
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
          const base = index / files.length;
          const part = (Number(event.progress) || 0) / files.length;
          updateOcrProgress(`第 ${index + 1}/${files.length} 张：${event.status || "识别中"}`, base + part);
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
      if (!ocrCandidates.length) els.ocrMessage.textContent = "没有提取到三枚 1–6 的数字组合。可展开原始文本检查，或换一张更清晰的截图。";
    } catch (error) {
      els.ocrMessage.textContent = error?.message || "截图识别失败，请重试。";
      els.ocrProgress.classList.add("hidden");
    } finally {
      if (worker) await worker.terminate();
      delete els.ocrFiles.dataset.activeIndex;
    }
  }

  function importOcrRecords() {
    const imported = [];
    let invalid = 0;
    let duplicates = 0;
    $$(".ocr-candidate").forEach((row, index) => {
      if (!row.querySelector('input[type="checkbox"]').checked) return;
      const issue = row.querySelector('input[type="text"]').value.trim();
      const dice = [...row.querySelectorAll('input[type="number"]')].map((input) => Number(input.value));
      if (!dice.every((value) => Number.isInteger(value) && value >= 1 && value <= 6)) {
        invalid += 1;
        return;
      }
      const duplicate = [...records, ...imported].some((record) => record.issue === issue && record.officialDice.join("") === dice.join(""));
      if (duplicate) {
        duplicates += 1;
        return;
      }
      imported.push({
        id: `ocr-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
        issue: issue || "截图导入",
        officialDice: dice,
        host: null,
        bet: null,
        source: "screenshot",
        excludeTriples: els.excludeTriples.checked,
        validation: { code: "unverified", label: "待主播核对", exact: false, category: false, sum: false },
        createdAt: new Date(Date.now() - index * 1000).toISOString(),
      });
    });
    if (!imported.length) {
      els.ocrMessage.textContent = invalid ? "所选记录中有无效骰子，请改为 1–6。" : duplicates ? "所选记录已经存在。" : "请至少勾选一条记录。";
      return;
    }
    records = [...imported, ...records];
    saveRecords();
    renderAll();
    resetOcrResults();
    els.ocrMessage.className = "form-message success";
    els.ocrMessage.textContent = `已导入 ${imported.length} 条记录${duplicates ? `，跳过 ${duplicates} 条重复记录` : ""}${invalid ? `，跳过 ${invalid} 条无效记录` : ""}。`;
  }

  function renderAll() {
    renderBankroll();
    renderProbabilities();
    renderPreviews();
    renderHistory();
    renderAdvice();
    renderRecords();
    renderStreamerProfiles();
    renderQuickRound();
    renderQuickHistory();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function addRecord() {
    els.formMessage.className = "form-message";
    const officialDice = readDice("official");
    if (!officialDice) {
      els.formMessage.textContent = "请完整输入官方三枚骰子，每枚为 1–6。";
      return;
    }
    const host = hostFromForm();
    if (!host) {
      els.formMessage.textContent = activeHostMode() === "dice" ? "请完整输入主播三枚骰子。" : "请至少选择主播口播的大小或单双。";
      return;
    }
    const excludeTriples = els.excludeTriples.checked;
    const streamerName = normalizeStreamer(els.quickStreamer.value);
    saveSelectedStreamer(streamerName);
    const sessionId = activeSessionId(streamerName);
    const betResult = betFromForm(officialDice, host, excludeTriples);
    if (betResult.error) {
      els.formMessage.textContent = betResult.error;
      return;
    }
    records.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      issue: els.issue.value.trim(),
      officialDice,
      host,
      streamerName,
      sessionId,
      bet: betResult.bet,
      excludeTriples,
      validation: validateRecord(officialDice, host, excludeTriples),
      createdAt: new Date().toISOString(),
    });
    touchSession(streamerName, sessionId);
    saveRecords();
    ["official-1", "official-2", "official-3", "host-1", "host-2", "host-3"].forEach((id) => { $("#" + id).value = ""; });
    els.officialQuick.value = "";
    els.officialQuick.classList.remove("valid");
    els.hostSize.value = "";
    els.hostParity.value = "";
    els.issue.value = "";
    els.betDimension.value = "none";
    els.stake.value = "";
    els.stake.disabled = true;
    els.stakeHint.textContent = "选择模拟项后填写金额；投入不能超过当前模拟余额。";
    els.formMessage.className = "form-message success";
    els.formMessage.textContent = betResult.bet
      ? `已保存：${records[0].validation.label}，本轮${betResult.bet.won ? "赢" : "输"} ${formatMoney(betResult.bet.net, true)}。`
      : `已保存：${records[0].validation.label}。`;
    renderAll();
  }

  function exportCsv() {
    if (!records.length) {
      els.formMessage.className = "form-message";
      els.formMessage.textContent = "暂无可导出的记录。";
      return;
    }
    const balances = balanceAfterEachRecord();
    const rows = [["期号/备注", "时间", "主播档案", "场次", "官方骰子", "官方和值", "官方分类", "主播录入", "验证结果", "模拟方向", "投入", "赔率", "返还", "净盈亏", "轮后余额", "三同号排除"]];
    records.forEach((record) => {
      const official = classify(record.officialDice, record.excludeTriples);
      const hostText = !record.host
        ? ""
        : record.host.mode === "dice"
        ? record.host.dice.join("-")
        : [record.host.size, record.host.parity].filter(Boolean).map((value) => LABELS[value]).join("/");
      rows.push([
        record.issue,
        new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false }),
        record.host ? recordStreamer(record) : "",
        record.sessionId || "",
        record.officialDice.join("-"),
        official.sum,
        official.combo === "triple" ? "三同号" : LABELS[official.size] + LABELS[official.parity],
        hostText,
        record.validation.label,
        record.bet ? LABELS[record.bet.selection] : "",
        record.bet?.stake ?? "",
        record.bet?.odds ?? "",
        record.bet?.payout ?? "",
        record.bet?.net ?? "",
        balances.get(record.id) ?? "",
        record.excludeTriples ? "是" : "否",
      ]);
    });
    const csv = "\ufeff" + rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `快三验证记录-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  $$('input[name="host-mode"]').forEach((input) => input.addEventListener("change", () => {
    const diceMode = activeHostMode() === "dice";
    els.hostDiceFields.classList.toggle("hidden", !diceMode);
    els.hostCategoryFields.classList.toggle("hidden", diceMode);
    renderPreviews();
  }));
  els.editTitle.addEventListener("click", () => {
    if (els.appTitleInput.classList.contains("hidden")) startTitleEdit();
    else finishTitleEdit(true);
  });
  els.appTitleInput.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") finishTitleEdit(true);
    if (event.key === "Escape") finishTitleEdit(false);
  });
  els.quickStreamer.addEventListener("change", () => {
    if (pendingPrediction) return;
    saveSelectedStreamer(els.quickStreamer.value);
    createSession(selectedStreamer);
    els.quickMessage.className = "form-message success";
    els.quickMessage.textContent = `已切换到“${selectedStreamer}”，本场统计从 0 轮开始。`;
    renderAll();
  });
  els.manageStreamers.addEventListener("click", () => {
    els.streamerMessage.className = "form-message";
    els.streamerMessage.textContent = "";
    els.newStreamerName.value = "";
    renderStreamerDialog();
    els.streamerDialog.showModal();
  });
  els.addStreamer.addEventListener("click", addStreamerProfile);
  els.startNewSession.addEventListener("click", () => {
    beginNewSession(selectedStreamer);
    els.streamerMessage.className = "form-message success";
    els.streamerMessage.textContent = "新场次已开始，旧记录仍保留在档案中。";
    renderAll();
    renderStreamerDialog();
  });
  els.newStreamerName.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      addStreamerProfile();
    }
  });
  els.resetStreamer.addEventListener("click", () => {
    els.streamerDialog.close();
    openConfirm("reset-streamer", selectedStreamer);
  });
  els.deleteStreamer.addEventListener("click", () => {
    if (streamerProfiles.length <= 1) return;
    els.streamerDialog.close();
    openConfirm("delete-streamer", selectedStreamer);
  });
  $$('[data-quick-size], [data-quick-parity]').forEach((button) => button.addEventListener("click", () => {
    const dimension = button.dataset.quickSize ? "size" : "parity";
    const value = button.dataset.quickSize || button.dataset.quickParity;
    quickDraft[dimension] = quickDraft[dimension] === value ? "" : value;
    els.quickMessage.textContent = "";
    renderQuickRound();
  }));
  els.quickWatch.addEventListener("click", () => lockQuickPrediction(true));
  els.lockPrediction.addEventListener("click", () => {
    if (pendingPrediction) cancelQuickPrediction();
    else lockQuickPrediction(false);
  });
  els.quickResult.addEventListener("input", renderQuickRound);
  els.quickResult.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !els.settlePrediction.disabled) settleQuickPrediction();
  });
  els.settlePrediction.addEventListener("click", settleQuickPrediction);
  els.officialQuick.addEventListener("input", () => {
    const dice = parseQuickDice(els.officialQuick.value);
    els.officialQuick.classList.toggle("valid", Boolean(dice));
    if (dice) {
      fillOfficialDice(dice);
    } else {
      [1, 2, 3].forEach((index) => { $("#official-" + index).value = ""; });
      renderPreviews();
    }
  });
  [1, 2, 3].forEach((index) => $("#official-" + index).addEventListener("input", () => {
    const dice = readDice("official");
    if (dice && document.activeElement !== els.officialQuick) {
      els.officialQuick.value = dice.join("");
      els.officialQuick.classList.add("valid");
    }
  }));
  $$('input[type="number"], select').forEach((input) => input.addEventListener("input", renderPreviews));
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
    saveBankroll();
    els.bankrollMessage.className = "form-message success";
    els.bankrollMessage.textContent = "模拟本金已保存。";
    renderAll();
  });
  els.betDimension.addEventListener("change", () => {
    const enabled = els.betDimension.value !== "none";
    els.stake.disabled = !enabled;
    if (!enabled) els.stake.value = "";
    els.stakeHint.textContent = !enabled
      ? "选择模拟项后填写金额；投入不能超过当前模拟余额。"
      : bankroll
        ? `当前可用模拟余额 ${formatMoney(currentBalance())}；页面不会自动推荐投入额。`
        : "请先设置模拟本金。";
  });
  els.excludeTriples.addEventListener("change", () => {
    localStorage.setItem(RULE_KEY, String(els.excludeTriples.checked));
    renderProbabilities();
    renderPreviews();
  });
  els.addRecord.addEventListener("click", addRecord);
  els.exportData.addEventListener("click", exportCsv);
  els.clearData.addEventListener("click", () => openConfirm("clear-all"));
  els.confirmDialog.addEventListener("close", () => {
    if (els.confirmDialog.returnValue !== "confirm") return;
    if (confirmAction.type === "reset-streamer") resetStreamerHistory(confirmAction.streamerName);
    else if (confirmAction.type === "delete-streamer") deleteStreamerProfile(confirmAction.streamerName);
    else {
      records = [];
      streamerSessions = {};
      saveRecords();
      saveStreamerSessions();
    }
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
    row.querySelector(".ocr-candidate-category").textContent = dice.every((value) => Number.isInteger(value) && value >= 1 && value <= 6)
      ? resultLabel(classify(dice))
      : "请检查骰子";
  });
  els.importOcrRecords.addEventListener("click", importOcrRecords);
  els.clearOcrResults.addEventListener("click", resetOcrResults);

  renderAll();
})();
