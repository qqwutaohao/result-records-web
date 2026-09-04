(() => {
  "use strict";

  const STORAGE_KEY = "k3-verifier-records-v1";
  const BANKROLL_KEY = "k3-verifier-bankroll-v1";
  const TITLE_KEY = "k3-verifier-title-v1";
  const SESSION_KEY = "k3-verifier-model-session-v1";
  const DEFAULT_TITLE = "结果记录台";
  const SESSION_GAP_MS = 30 * 60 * 1000;
  const PRIOR_SIDE = 10;
  const DECAY_HALF_LIFE = 20;
  const ODDS = 1.96;
  const OCR_SCRIPT = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  const LABELS = { big: "大", small: "小", odd: "单", even: "双" };

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

  function confidenceLabel(total) {
    if (total < 10) return "理论基准";
    if (total < 20) return "低置信度";
    return "短期参考";
  }

  function modelFrom(items) {
    const total = items.length;
    if (total < 10) {
      return { big: 0.5, small: 0.5, odd: 0.5, even: 0.5, total, sizeEligible: items.filter((record) => !classify(record.officialDice).triple).length };
    }

    let big = 0;
    let small = 0;
    let odd = 0;
    let even = 0;
    items.forEach((record, index) => {
      const weight = 0.5 ** (index / DECAY_HALF_LIFE);
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
      total,
      sizeEligible: items.filter((record) => !classify(record.officialDice).triple).length,
    };
  }

  function pairPercent(probability) {
    const first = Math.round(probability * 1000) / 10;
    return [first, Math.round((100 - first) * 10) / 10];
  }

  function predictionText(prediction) {
    if (!prediction) return "旧记录未保存模型值";
    const size = pairPercent(Number(prediction.big));
    const parity = pairPercent(Number(prediction.odd));
    return `大 ${size[0].toFixed(1)}% · 小 ${size[1].toFixed(1)}% · 单 ${parity[0].toFixed(1)}% · 双 ${parity[1].toFixed(1)}%`;
  }

  function modelValidation(items) {
    let squaredError = 0;
    let observations = 0;
    let rounds = 0;
    items.forEach((record) => {
      const prediction = record.modelPrediction;
      if (!prediction || !Number.isFinite(Number(prediction.big)) || !Number.isFinite(Number(prediction.odd))) return;
      const result = classify(record.officialDice);
      let used = false;
      if (!result.triple) {
        squaredError += (Number(prediction.big) - (result.size === "big" ? 1 : 0)) ** 2;
        observations += 1;
        used = true;
      }
      squaredError += (Number(prediction.odd) - (result.parity === "odd" ? 1 : 0)) ** 2;
      observations += 1;
      used = true;
      if (used) rounds += 1;
    });
    const brier = observations ? squaredError / observations : null;
    const improvement = brier === null ? null : ((0.25 - brier) / 0.25) * 100;
    return { rounds, observations, brier, improvement };
  }

  function renderModel() {
    const items = sessionRecords();
    const model = modelFrom(items);
    const size = pairPercent(model.big);
    const parity = pairPercent(model.odd);
    const validation = modelValidation(items);

    els.sessionStatus.textContent = model.total < 10 ? `收集中 ${model.total}/10` : confidenceLabel(model.total);
    els.modelConfidence.textContent = confidenceLabel(model.total);
    els.modelSample.textContent = `本场 ${model.total} 轮`;
    els.probBig.textContent = `${size[0].toFixed(1)}%`;
    els.probSmall.textContent = `${size[1].toFixed(1)}%`;
    els.probOdd.textContent = `${parity[0].toFixed(1)}%`;
    els.probEven.textContent = `${parity[1].toFixed(1)}%`;
    els.barBig.style.width = `${size[0]}%`;
    els.barOdd.style.width = `${parity[0]}%`;

    if (model.total < 10) {
      els.modelNote.textContent = `还需 ${10 - model.total} 轮；当前按理论 50% / 50%`;
    } else if (model.total < 20) {
      els.modelNote.textContent = "Beta(10,10) 平滑 · 近期数据半衰期 20 轮";
    } else {
      els.modelNote.textContent = `大小有效 ${model.sizeEligible} 轮 · 三同号只计入单双`;
    }

    if (validation.rounds < 20) {
      els.modelValidation.textContent = `滚动验证 ${validation.rounds}/20`;
    } else if (validation.improvement > 0) {
      els.modelValidation.textContent = `Brier 较 50% 基准改善 ${validation.improvement.toFixed(1)}%`;
    } else {
      els.modelValidation.textContent = "暂未优于 50% 基准";
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
    const prediction = modelFrom(sessionRecords());
    records.unshift({
      id: `result-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      issue: els.quickIssue.value.trim(),
      officialDice: dice,
      source: "quick",
      sessionId: session.id,
      modelPrediction: { big: prediction.big, small: prediction.small, odd: prediction.odd, even: prediction.even, basedOn: prediction.total },
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
    const validation = modelValidation(items);
    const tips = [
      `本场 ${items.length} 轮；10 轮开始显示平滑值，20 轮后标记为短期参考。`,
      "每条新结果都保存录入前的概率，避免用结果反推预测。",
    ];
    if (validation.rounds < 20) {
      tips.push(`已有 ${validation.rounds}/20 轮可用于滚动检验，暂不评价模型提升。`);
    } else {
      tips.push(`当前 Brier Score 为 ${validation.brier.toFixed(4)}；固定 50% 基准为 0.2500。`);
      tips.push(validation.improvement > 0
        ? `相对基准改善 ${validation.improvement.toFixed(1)}%，仍需更多场次确认是否稳定。`
        : "当前没有优于固定 50% 基准，不应把短期波动视为优势。");
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
    const rows = [["期号/备注", "时间", "场次", "骰子", "和值", "大小", "单双", "录入前模型", "模拟方向", "投入", "赔率", "返还", "净盈亏", "轮后余额", "来源"]];
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
