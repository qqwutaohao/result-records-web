((root, factory) => {
  const core = typeof module === "object" && module.exports ? require("./model-core.js") : root.K3ModelCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.K3LiveModel = api;
})(globalThis, (core) => {
  "use strict";

  const VERSION = 5;
  const START_ROUNDS = 10;
  const BASELINE = Object.freeze({ big: 0.5, small: 0.5, odd: 0.5, even: 0.5, triple: 1 / 36 });
  const NAMES = { baseline: "理论基准", recent: "近期偏向", sequence: "前后顺序", history: "仅历史组合", streamers: "加入主播", live: "本版参考", legacy: "旧版对照" };

  function classify(dice) {
    const sum = dice.reduce((total, value) => total + Number(value), 0);
    const triple = dice.every((value) => Number(value) === Number(dice[0]));
    return { sum, triple, size: triple ? null : sum >= 11 ? "big" : "small", parity: sum % 2 ? "odd" : "even" };
  }

  function prediction(big, odd, triple) {
    return { big, small: 1 - big, odd, even: 1 - odd, triple };
  }

  // Input is newest first. All estimates only use already recorded outcomes.
  function recentModel(items) {
    let big = 0, size = 0, odd = 0, total = 0, triples = 0;
    items.slice(0, 80).forEach((record, index) => {
      const weight = 0.5 ** (index / 6);
      const result = classify(record.officialDice);
      total += weight;
      if (result.triple) triples += weight;
      else { size += weight; if (result.size === "big") big += weight; }
      if (result.parity === "odd") odd += weight;
    });
    return prediction((4 + big) / (8 + size), (4 + odd) / (8 + total), (1 + triples) / (36 + total));
  }

  function sequenceModel(items, recent) {
    if (!items.length || items[0].nextIsUnknown) return { prediction: recent, counts: { size: 0, parity: 0 } };
    const last = classify(items[0].officialDice);
    const sizeState = (result) => result.triple ? "triple" : result.size;
    let big = 0, size = 0, odd = 0, parity = 0;
    for (let index = 0; index < Math.min(items.length - 1, 80); index += 1) {
      const next = classify(items[index].officialDice);
      const previous = classify(items[index + 1].officialDice);
      const weight = 0.5 ** (index / 12);
      // Imports and explicitly missed rounds do not establish adjacency.
      if (items[index].sequenceBreak || items[index].source === "screenshot" || items[index + 1].source === "screenshot") continue;
      if (sizeState(previous) === sizeState(last) && !next.triple) {
        size += weight;
        if (next.size === "big") big += weight;
      }
      if (previous.parity === last.parity) {
        parity += weight;
        if (next.parity === "odd") odd += weight;
      }
    }
    return {
      prediction: prediction((4 * recent.big + big) / (4 + size), (4 * recent.odd + odd) / (4 + parity), recent.triple),
      counts: { size, parity },
    };
  }

  function isEvaluable(record) {
    const forecast = record.forecast;
    return forecast?.version === VERSION && forecast.status === "locked"
      && record.evidenceInvalidated !== true
      && Number.isFinite(Date.parse(forecast.lockedAt))
      && Date.parse(forecast.lockedAt) <= Date.parse(record.createdAt)
      && ["live", "baseline", "history", "recent", "sequence", "streamers", "legacy"].every((key) => (
        ["big", "small", "odd", "even", "triple"].every((field) => Number.isFinite(forecast.candidates?.[key]?.[field]))
      ));
  }

  function mix(candidates, weights, metric) {
    if (metric === "parity") return candidates.reduce((sum, item, index) => sum + item.odd * weights[index], 0);
    const probabilities = candidates.map(core.sizeClassProbabilities);
    const big = probabilities.reduce((sum, item, index) => sum + item.big * weights[index], 0);
    const small = probabilities.reduce((sum, item, index) => sum + item.small * weights[index], 0);
    const triple = probabilities.reduce((sum, item, index) => sum + item.triple * weights[index], 0);
    return { big: big + small ? big / (big + small) : 0.5, triple };
  }

  function historyWeights(items, metric) {
    const keys = ["baseline", "recent", "sequence"];
    const losses = keys.map(() => 0);
    const learningRows = items.filter((record) => isEvaluable(record) || (
      record.referencePrediction?.version === VERSION && record.evidenceInvalidated !== true
    ));
    learningRows.slice(0, 80).forEach((record, index) => {
      const weight = 0.5 ** (index / 20);
      const result = classify(record.officialDice);
      const saved = isEvaluable(record) ? record.forecast : record.referencePrediction;
      keys.forEach((key, offset) => { losses[offset] += weight * core.metricBrierLoss(saved.candidates[key], result, metric); });
    });
    const best = Math.min(...losses);
    const raw = losses.map((loss) => Math.exp(-4 * (loss - best)));
    const total = raw.reduce((sum, value) => sum + value, 0);
    return raw.map((value) => value / total);
  }

  function streamerModel(items, current, history) {
    const supported = { size: new Set(), parity: new Set() };
    const estimates = { size: [], parity: [] };
    for (const streamer of current.slice(0, 2)) {
      for (const metric of ["size", "parity"]) {
        const direction = streamer[metric];
        if (!["big", "small", "odd", "even"].includes(direction)) continue;
        const matching = items.filter(isEvaluable).filter((record) => record.forecast.streamers?.some((previous) => (
          previous.name === streamer.name && previous[metric] === direction
        ))).slice(0, 80);
        let first = 0, count = 0, triples = 0;
        matching.forEach((record) => {
          const result = classify(record.officialDice);
          supported[metric].add(record.id);
          if (metric === "size" && result.triple) triples += 1;
          else { count += 1; if (result[metric] === (metric === "size" ? "big" : "odd")) first += 1; }
        });
        if (!matching.length) continue;
        const prior = metric === "size" ? history.big : history.odd;
        estimates[metric].push({ first: (12 * prior + first) / (12 + count), triple: (36 * history.triple + triples) / (36 + matching.length) });
      }
    }
    const result = { ...history };
    for (const metric of ["size", "parity"]) {
      const values = estimates[metric];
      if (!values.length) continue;
      // Correlated callers are averaged, never multiplied into independent evidence.
      const influence = Math.min(0.35, supported[metric].size / (supported[metric].size + 30));
      const mean = values.reduce((sum, value) => sum + value.first, 0) / values.length;
      if (metric === "size") {
        result.big = (1 - influence) * history.big + influence * mean;
        result.small = 1 - result.big;
        result.triple = (1 - influence) * history.triple + influence * values.reduce((sum, value) => sum + value.triple, 0) / values.length;
      } else {
        result.odd = (1 - influence) * history.odd + influence * mean;
        result.even = 1 - result.odd;
      }
    }
    return { prediction: result, counts: { size: supported.size.size, parity: supported.parity.size } };
  }

  function decision(items, candidates, weights, metric, sequenceCounts) {
    const live = candidates.live;
    const first = metric === "size" ? "big" : "odd";
    const second = metric === "size" ? "small" : "even";
    const probability = live[first];
    const direction = probability > 0.5 ? first : second;
    const actual = metric === "size" ? core.sizeClassProbabilities(live)[direction] : live[direction];
    const recent = items.filter(isEvaluable).slice(0, 5);
    const issued = recent.filter((record) => record.forecast.decisions?.[metric]?.issued);
    const oldDirection = items.find(isEvaluable)?.forecast.decisions?.[metric]?.direction;
    const stillSame = oldDirection === direction;
    const poor = stillSame && issued.length >= 3 && issued.filter((record) => (
      record.forecast.decisions[metric].direction !== classify(record.officialDice)[metric]
    )).length >= Math.ceil(issued.length * 0.75);
    const newest = items.slice(0, 3).map((record) => classify(record.officialDice)[metric]);
    const older = items.slice(3, 13).map((record) => classify(record.officialDice)[metric]);
    const shift = newest.length === 3 && older.length >= 7 && newest.every((value) => value && value === newest[0])
      && older.filter((value) => value && value !== newest[0]).length / older.length >= 0.8;
    const gap = Math.abs(candidates.recent[first] - candidates.sequence[first]);
    const conflict = gap > 0.22 && Math.max(...weights) < 0.7;
    let status = "reference", reason = "逐轮更新的模型倾向，尚不代表已证实优势";
    if (items.length < START_ROUNDS) { status = "warmup"; reason = `再记录 ${START_ROUNDS - items.length} 轮，开始显示方向参考`; }
    else if (shift || poor) { status = "changing"; reason = shift ? "近期分布变化，旧判断已撤回" : "近期预判失准，暂缓采用旧方向"; }
    else if (conflict) { status = "conflict"; reason = "近期偏向与顺序模型分歧较大"; }
    else if (Math.abs(probability - 0.5) < 0.025 || actual <= core.BREAK_EVEN_PROBABILITY) { status = "balanced"; reason = "已分析，暂未发现明显方向"; }
    else if (items.length < 20) reason = "样本较少，当前倾向仅供模拟验证";
    else if (sequenceCounts >= 3 && weights[2] > weights[1]) reason = "主要参考前后顺序；按新结果持续验证";
    return { status, reason, direction: status === "reference" ? direction : null, issued: status === "reference", probability: actual, weights, sequenceCount: sequenceCounts };
  }

  function forecast(items, streamers = [], legacy = BASELINE) {
    const recent = recentModel(items);
    const sequence = sequenceModel(items, recent);
    const sizeWeights = historyWeights(items, "size");
    const parityWeights = historyWeights(items, "parity");
    const inputs = [BASELINE, recent, sequence.prediction];
    const size = mix(inputs, sizeWeights, "size");
    const history = prediction(size.big, mix(inputs, parityWeights, "parity"), size.triple);
    const caller = streamerModel(items, streamers, history);
    const candidates = { baseline: { ...BASELINE }, recent, sequence: sequence.prediction, history, streamers: caller.prediction, live: caller.prediction, legacy: { ...legacy } };
    return {
      version: VERSION, basedOn: items.length, candidates,
      streamerCounts: caller.counts,
      decisions: {
        size: decision(items, candidates, sizeWeights, "size", sequence.counts.size),
        parity: decision(items, candidates, parityWeights, "parity", sequence.counts.parity),
      },
    };
  }

  function evaluate(items) {
    const rows = items.filter(isEvaluable);
    const result = { count: rows.length, metrics: {} };
    for (const metric of ["size", "parity"]) {
      const scores = Object.fromEntries(Object.keys(NAMES).map((key) => [key, { loss: 0, selectedLoss: 0, hits: 0 }]));
      let issued = 0, hits = 0, streak = 0, longestWait = 0, wait = 0;
      [...rows].reverse().forEach((record) => {
        const outcome = classify(record.officialDice);
        const selected = record.forecast.decisions[metric].issued;
        if (selected) { issued += 1; wait = 0; } else { wait += 1; longestWait = Math.max(longestWait, wait); }
        for (const key of Object.keys(NAMES)) {
          const p = record.forecast.candidates[key];
          const loss = core.metricBrierLoss(p, outcome, metric);
          scores[key].loss += loss;
          if (selected) {
            scores[key].selectedLoss += loss;
            const first = metric === "size" ? "big" : "odd";
            const second = metric === "size" ? "small" : "even";
            const direction = p[first] >= 0.5 ? first : second;
            if (outcome[metric] === direction) scores[key].hits += 1;
          }
        }
        if (selected && outcome[metric] === record.forecast.decisions[metric].direction) hits += 1;
        if (!selected) streak += 1; else streak = 0;
      });
      for (const score of Object.values(scores)) {
        score.loss = rows.length ? score.loss / rows.length : null;
        score.selectedLoss = issued ? score.selectedLoss / issued : null;
      }
      result.metrics[metric] = { scores, issued, hits, coverage: rows.length ? issued / rows.length : null, longestWait, wait: streak };
    }
    return result;
  }

  return Object.freeze({ VERSION, START_ROUNDS, BASELINE, NAMES, classify, recentModel, sequenceModel, forecast, evaluate, isEvaluable });
});
