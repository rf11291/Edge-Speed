(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  const els = {
    startButton: $('#startButton'),
    stopButton: $('#stopButton'),
    startLabel: $('#startLabel'),
    runState: $('#runState'),
    themeToggle: $('#themeToggle'),
    statusText: $('#statusText'),
    errorText: $('#errorText'),
    progressPercent: $('#progressPercent'),
    progressBar: $('#progressBar'),
    downloadValue: $('#downloadValue'),
    uploadValue: $('#uploadValue'),
    latencyValue: $('#latencyValue'),
    loadedLatencyValue: $('#loadedLatencyValue'),
    jitterValue: $('#jitterValue'),
    downloadSamples: $('#downloadSamples'),
    uploadSamples: $('#uploadSamples'),
    downloadHint: $('#downloadHint'),
    uploadHint: $('#uploadHint'),
    latencyHint: $('#latencyHint'),
    loadedLatencyHint: $('#loadedLatencyHint'),
    jitterHint: $('#jitterHint'),
    qualityGauge: $('#qualityGauge'),
    qualityScoreValue: $('#qualityScoreValue'),
    qualityWord: $('#qualityWord'),
    qualityNote: $('#qualityNote'),
    clientIpText: $('#clientIpText'),
    clientLocationText: $('#clientLocationText'),
    clientIspText: $('#clientIspText'),
    clientAsnText: $('#clientAsnText'),
    clientIpVersionText: $('#clientIpVersionText'),
    clientBrowserText: $('#clientBrowserText'),
    serverRegionText: $('#serverRegionText'),
    
    downloadChart: $('#downloadChart'),
    uploadChart: $('#uploadChart'),
    latencyChart: $('#latencyChart'),
    downloadTooltip: $('#downloadTooltip'),
    uploadTooltip: $('#uploadTooltip'),
    latencyTooltip: $('#latencyTooltip'),
    detailsBody: $('#detailsBody'),
    exportJsonButton: $('#exportJsonButton'),
    exportCsvButton: $('#exportCsvButton'),
    detailDialog: $('#detailDialog'),
    dialogKicker: $('#dialogKicker'),
    dialogTitle: $('#dialogTitle'),
    dialogSubtitle: $('#dialogSubtitle'),
    dialogStats: $('#dialogStats'),
    dialogTableHead: $('#dialogTableHead'),
    dialogTableBody: $('#dialogTableBody')
  };

  const VERSION = 'v0.4.0-workers';
  const MIN_BANDWIDTH_SAMPLE_MS = 30;
  const STABLE_GROUP_MS = 700;
  const SIZE_STOP_MS = 1000;
  const LOADED_LATENCY_INTERVAL_MS = 420;

  const FULL_PLAN = [
    { type: 'latency', numPackets: 1, label: 'warmup' },
    { type: 'download', bytes: 100000, count: 1, bypassStop: true },
    { type: 'latency', numPackets: 20, label: 'idle' },
    { type: 'download', bytes: 100000, count: 9 },
    { type: 'download', bytes: 1000000, count: 8 },
    { type: 'upload', bytes: 100000, count: 8 },
    { type: 'upload', bytes: 1000000, count: 6 },
    { type: 'download', bytes: 10000000, count: 6 },
    { type: 'upload', bytes: 10000000, count: 4 },
    { type: 'download', bytes: 25000000, count: 4 },
    { type: 'upload', bytes: 25000000, count: 4 },
    { type: 'download', bytes: 100000000, count: 3 },
    { type: 'upload', bytes: 50000000, count: 3 },
    { type: 'download', bytes: 250000000, count: 2 }
  ];

  const state = {
    config: null,
    client: null,
    running: false,
    controller: null,
    results: createEmptyResults(),
    totalWork: 1,
    completedWork: 0,
    uploadSeed: null,
    renderQueued: false,
    chartModels: new Map()
  };

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('resize', () => queueRender());

  function createEmptyResults() {
    return {
      version: VERSION,
      startedAt: null,
      finishedAt: null,
      server: {},
      download: [],
      upload: [],
      latency: [],
      loadedLatency: { download: [], upload: [] },
      skipped: [],
      errors: []
    };
  }

  async function init() {
    applyTheme();
    bindEvents();
    try {
      if (performance && typeof performance.setResourceTimingBufferSize === 'function') performance.setResourceTimingBufferSize(5000);
      await loadServerInfo();
      renderAll();
    } catch (error) {
      setError(`初始化失败：${safeErrorMessage(error)}`);
      renderAll();
    }
  }

  function bindEvents() {
    els.startButton.addEventListener('click', () => runTest().catch((error) => {
      if (!isAbortError(error)) setError(`测速失败：${safeErrorMessage(error)}`);
      finishRun(false);
    }));
    els.stopButton.addEventListener('click', stopTest);
    els.themeToggle.addEventListener('click', toggleTheme);
    els.exportJsonButton.addEventListener('click', exportJson);
    els.exportCsvButton.addEventListener('click', exportCsv);
    document.body.addEventListener('click', handleDetailClick);
    document.body.addEventListener('keydown', handleDetailKeydown);
    bindChart(els.downloadChart, els.downloadTooltip);
    bindChart(els.uploadChart, els.uploadTooltip);
    bindChart(els.latencyChart, els.latencyTooltip);
  }

  function applyTheme() {
    const saved = localStorage.getItem('open-edge-speed-theme');
    const preferred = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const theme = saved === 'light' || saved === 'dark' ? saved : preferred;
    document.documentElement.dataset.theme = theme;
    updateThemeButton(theme);
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('open-edge-speed-theme', next);
    updateThemeButton(next);
    queueRender();
  }

  function updateThemeButton(theme) {
    if (!els.themeToggle) return;
    const label = theme === 'dark' ? '切换为浅色主题' : '切换为深色主题';
    els.themeToggle.setAttribute('aria-label', label);
    els.themeToggle.setAttribute('title', label);
    els.themeToggle.innerHTML = themeIcon(theme === 'dark');
  }

  function themeIcon(isDark) {
    if (isDark) {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5V2m0 20v-2.5M4.5 12H2m20 0h-2.5M5.64 5.64 3.86 3.86m16.28 16.28-1.78-1.78m0-12.72 1.78-1.78M3.86 20.14l1.78-1.78"/><circle cx="12" cy="12" r="4.25"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 14.6A7.6 7.6 0 0 1 9.4 3.8a8.2 8.2 0 1 0 10.8 10.8Z"/></svg>';
  }

  async function loadServerInfo() {
    const [config, client] = await Promise.all([fetchJson('/api/config'), fetchJson('/api/client')]);
    state.config = config;
    state.client = client;
    state.results.server = buildServerSnapshot(config, client);
    renderConnectionInfo(config, client);
  }

  function buildServerSnapshot(config, client) {
    return {
      siteName: config?.siteName || 'Open Edge Speed',
      serverRegion: config?.serverRegion || client?.serverRegion || 'Cloudflare Edge',
      clientIp: client?.ip || null,
      ipVersion: client?.ipVersion || null,
      ipSource: client?.ipSource || null,
      ipInfo: client?.ipInfo || null,
      ipInfoStatus: client?.ipInfoStatus || null,
      serverTime: client?.serverTime || null
    };
  }

  function renderConnectionInfo(config, client) {
    const ipText = client.ip || 'hidden';
    setText(els.clientIpText, ipText);
    setText(els.clientLocationText, formatLocation(client.ipInfo, client.headers));
    setText(els.clientIspText, formatIsp(client.ipInfo));
    setText(els.clientAsnText, client.ipInfo?.asn || '--');
    setText(els.clientIpVersionText, client.ipVersion || client.connection?.remoteFamily || '--');
    setText(els.clientBrowserText, summarizeBrowser(navigator.userAgent || client.userAgent || ''));
    setText(els.serverRegionText, config.serverRegion || client.serverRegion || 'Cloudflare Edge');
  }

  function formatLocation(info, headers) {
    if (info) {
      const parts = [info.city, info.region, info.country].filter(Boolean);
      if (parts.length) return parts.join(' · ');
    }
    if (headers?.country) return headers.country;
    return '--';
  }

  function formatIsp(info) {
    if (!info) return '--';
    return info.isp || info.org || '--';
  }

  function summarizeBrowser(userAgent) {
    const ua = String(userAgent || '');
    const browsers = [['Edg/', 'Edge'], ['OPR/', 'Opera'], ['Chrome/', 'Chrome'], ['Firefox/', 'Firefox'], ['Safari/', 'Safari']];
    let browser = 'Browser';
    for (const [needle, name] of browsers) {
      if (ua.includes(needle)) {
        browser = name;
        break;
      }
    }
    let os = 'OS';
    if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
    else if (/Linux/i.test(ua)) os = 'Linux';
    return `${browser} on ${os}`;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.json();
  }

  async function runTest() {
    if (state.running) return;
    state.running = true;
    state.controller = new AbortController();
    state.results = createEmptyResults();
    state.results.startedAt = new Date().toISOString();
    state.results.server = buildServerSnapshot(state.config, state.client);
    state.completedWork = 0;
    const plan = buildPlan();
    state.totalWork = estimateWork(plan);
    setRunningUi(true);
    setError('');
    setStatus('准备测速');
    updateProgress();
    renderAll();

    const signal = state.controller.signal;
    const finishedDirection = { download: false, upload: false };

    try {
      for (const step of plan) {
        throwIfAborted(signal);
        if ((step.type === 'download' || step.type === 'upload') && finishedDirection[step.type] && !step.bypassStop) {
          state.results.skipped.push({ ...step, reason: `${step.type}_size_threshold_reached` });
          state.completedWork += stepWork(step);
          updateProgress();
          continue;
        }
        if (step.type === 'latency') {
          await runLatencyStep(step, signal);
        } else if (step.type === 'download' || step.type === 'upload') {
          const samples = await runBandwidthStep(step.type, step, signal);
          if (!step.bypassStop && median(samples.map((sample) => sample.durationMs)) >= SIZE_STOP_MS) finishedDirection[step.type] = true;
        }
      }
      state.results.finishedAt = new Date().toISOString();
      state.completedWork = state.totalWork;
      setStatus('测速完成');
      updateProgress();
      finishRun(true);
    } catch (error) {
      if (isAbortError(error)) {
        state.results.finishedAt = new Date().toISOString();
        setStatus('测速已停止');
        finishRun(false);
        return;
      }
      state.results.errors.push({ at: new Date().toISOString(), error: safeErrorMessage(error) });
      setError(safeErrorMessage(error));
      finishRun(false);
    }
  }

  function buildPlan() {
    const maxDownload = state.config?.maxDownloadBytes || Number.POSITIVE_INFINITY;
    const maxUpload = state.config?.maxUploadBytes || Number.POSITIVE_INFINITY;
    const plan = [];
    for (const step of FULL_PLAN) {
      if (step.type === 'download' && step.bytes > maxDownload) {
        state.results.skipped.push({ ...step, reason: `server_max_download_${maxDownload}` });
        continue;
      }
      if (step.type === 'upload' && step.bytes > maxUpload) {
        state.results.skipped.push({ ...step, reason: `server_max_upload_${maxUpload}` });
        continue;
      }
      plan.push({ ...step });
    }
    return plan;
  }

  function estimateWork(plan) {
    return Math.max(1, plan.reduce((total, step) => total + stepWork(step), 0));
  }

  function stepWork(step) {
    if (step.type === 'latency') return step.numPackets || 1;
    if (step.type === 'download' || step.type === 'upload') return step.count || 1;
    return 1;
  }

  async function runLatencyStep(step, signal) {
    for (let i = 0; i < step.numPackets; i += 1) {
      throwIfAborted(signal);
      setStatus(`延迟 ${i + 1}/${step.numPackets}`);
      const sample = await measureLatency(step.label || 'idle', signal);
      state.results.latency.push(sample);
      state.completedWork += 1;
      updateProgress();
      renderAll();
      await sleep(60, signal);
    }
  }

  async function runBandwidthStep(kind, step, signal) {
    const samples = [];
    const label = kind === 'download' ? '下载' : '上传';
    for (let i = 0; i < step.count; i += 1) {
      throwIfAborted(signal);
      setStatus(`${label} ${formatBytes(step.bytes)} ${i + 1}/${step.count}`);
      const operation = () => kind === 'download' ? measureDownload(step.bytes, signal) : measureUpload(step.bytes, signal);
      const sample = await runWithLoadedLatency(kind, operation, signal);
      state.results[kind].push(sample);
      samples.push(sample);
      state.completedWork += 1;
      updateProgress();
      renderAll();
      await sleep(120, signal);
    }
    return samples;
  }

  async function runWithLoadedLatency(kind, operationFactory, signal) {
    let stopped = false;
    const loop = (async () => {
      await sleep(120, signal).catch(() => undefined);
      while (!stopped && !signal.aborted) {
        try {
          const sample = await measureLatency(`${kind}-loaded`, signal);
          state.results.loadedLatency[kind].push(sample);
          renderAll();
        } catch (error) {
          if (!isAbortError(error)) state.results.errors.push({ at: new Date().toISOString(), error: `loaded latency: ${safeErrorMessage(error)}` });
        }
        await sleep(LOADED_LATENCY_INTERVAL_MS, signal).catch(() => undefined);
      }
    })();
    try {
      return await operationFactory();
    } finally {
      stopped = true;
      await Promise.race([loop, sleep(80)]).catch(() => undefined);
    }
  }

  async function measureLatency(label, signal) {
    const marker = randomMarker();
    const started = performance.now();
    const response = await fetch(`/__down?bytes=0&r=${marker}`, { cache: 'no-store', credentials: 'same-origin', signal });
    await response.arrayBuffer();
    const ended = performance.now();
    if (!response.ok) throw new Error(`latency HTTP ${response.status}`);
    const entry = getResourceEntry(marker);
    const resourceMs = entry && entry.responseStart > 0 && entry.requestStart > 0 ? Math.max(0, entry.responseStart - entry.requestStart) : null;
    const totalMs = Math.max(0, ended - started);
    return { type: 'latency', label, ms: resourceMs ?? totalMs, totalMs, at: new Date().toISOString() };
  }

  async function measureDownload(bytes, signal) {
    const marker = randomMarker();
    const started = performance.now();
    const response = await fetch(`/__down?bytes=${encodeURIComponent(String(bytes))}&r=${marker}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/octet-stream' },
      signal
    });
    if (!response.ok) throw new Error(`download HTTP ${response.status}`);
    let receivedBytes = 0;
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      while (true) {
        throwIfAborted(signal);
        const { value, done } = await reader.read();
        if (done) break;
        receivedBytes += value ? value.byteLength : 0;
      }
    } else {
      const data = await response.arrayBuffer();
      receivedBytes = data.byteLength;
    }
    const ended = performance.now();
    const entry = getResourceEntry(marker);
    const transferDuration = downloadDurationFromResourceTiming(entry, ended - started);
    const durationMs = Math.max(MIN_BANDWIDTH_SAMPLE_MS / 3, transferDuration);
    return {
      type: 'download',
      bytes: receivedBytes,
      requestedBytes: bytes,
      durationMs,
      totalMs: Math.max(0, ended - started),
      speedMbps: bytesToMbps(receivedBytes, durationMs),
      durationSource: entry ? 'resource.response' : 'browser.total',
      at: new Date().toISOString()
    };
  }

  async function measureUpload(bytes, signal) {
    const marker = randomMarker();
    const payload = makeUploadPayload(bytes);
    const started = performance.now();
    const response = await fetch(`/__up?bytes=${encodeURIComponent(String(bytes))}&r=${marker}`, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
      body: payload,
      signal
    });
    const headersAt = performance.now();
    const body = await response.json().catch(() => ({}));
    const ended = performance.now();
    if (!response.ok) throw new Error(`upload HTTP ${response.status}`);
    const entry = getResourceEntry(marker);
    const resourceDuration = uploadDurationFromResourceTiming(entry, headersAt - started);
    const serverDuration = numberOrNull(body.durationMs);
    const totalMs = Math.max(0, ended - started);
    const timing = chooseUploadTiming(serverDuration, resourceDuration, totalMs);
    const sentBytes = payload.size;
    const receivedBytes = Number.isFinite(body.receivedBytes) ? Number(body.receivedBytes) : null;
    const measuredBytes = receivedBytes && receivedBytes > 0 ? Math.min(receivedBytes, sentBytes) : sentBytes;
    return {
      type: 'upload',
      bytes: sentBytes,
      receivedBytes,
      requestedBytes: bytes,
      durationMs: timing.durationMs,
      totalMs,
      speedMbps: bytesToMbps(measuredBytes, timing.durationMs),
      serverDurationMs: serverDuration,
      resourceDurationMs: resourceDuration,
      durationSource: timing.source,
      at: new Date().toISOString()
    };
  }

  function downloadDurationFromResourceTiming(entry, fallbackMs) {
    if (!entry || entry.responseStart <= 0 || entry.responseEnd <= 0) return Math.max(0, fallbackMs);
    return Math.max(0, entry.responseEnd - entry.responseStart);
  }

  function uploadDurationFromResourceTiming(entry, fallbackMs) {
    if (!entry || entry.requestStart <= 0 || entry.responseStart <= 0) return Math.max(0, fallbackMs);
    return Math.max(0, entry.responseStart - entry.requestStart);
  }

  function chooseUploadTiming(serverDuration, resourceDuration, totalMs) {
    const candidates = [];
    if (Number.isFinite(serverDuration) && serverDuration > 0) candidates.push(['server.read', serverDuration]);
    if (Number.isFinite(resourceDuration) && resourceDuration > 0) candidates.push(['resource.request', resourceDuration]);
    if (Number.isFinite(totalMs) && totalMs > 0) candidates.push(['browser.total', totalMs]);
    if (!candidates.length) return { source: 'fallback', durationMs: MIN_BANDWIDTH_SAMPLE_MS };
    candidates.sort((a, b) => b[1] - a[1]);
    return { source: candidates[0][0], durationMs: Math.max(MIN_BANDWIDTH_SAMPLE_MS / 3, candidates[0][1]) };
  }

  function getResourceEntry(marker) {
    const entries = performance.getEntriesByType('resource');
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (typeof entries[i].name === 'string' && entries[i].name.includes(`r=${marker}`)) return entries[i];
    }
    return null;
  }

  function makeUploadPayload(bytes) {
    if (bytes <= 0) return new Blob([], { type: 'application/octet-stream' });
    const seed = getUploadSeed();
    const parts = [];
    let remaining = bytes;
    while (remaining > 0) {
      const n = Math.min(remaining, seed.byteLength);
      parts.push(seed.subarray(0, n));
      remaining -= n;
    }
    return new Blob(parts, { type: 'application/octet-stream' });
  }

  function getUploadSeed() {
    if (state.uploadSeed) return state.uploadSeed;
    const seed = new Uint8Array(1024 * 1024);
    for (let offset = 0; offset < seed.byteLength; offset += 65536) {
      crypto.getRandomValues(seed.subarray(offset, Math.min(offset + 65536, seed.byteLength)));
    }
    state.uploadSeed = seed;
    return seed;
  }

  function stopTest() {
    if (state.controller) state.controller.abort();
  }

  function finishRun(enableExports) {
    state.running = false;
    state.controller = null;
    setRunningUi(false);
    els.exportJsonButton.disabled = !enableExports && !hasAnySample();
    els.exportCsvButton.disabled = !enableExports && !hasAnySample();
    renderAll();
  }

  function setRunningUi(running) {
    els.startButton.disabled = running;
    els.stopButton.disabled = !running;
    setText(els.startLabel, hasAnySample() ? '重新测速' : '开始测速');
    if (els.runState) {
      const text = running ? '测速中' : (hasAnySample() ? '已完成' : '待测试');
      const cls = running ? 'running' : (hasAnySample() ? 'complete' : 'ready');
      els.runState.textContent = text;
      els.runState.className = `state-pill ${cls}`;
    }
    els.exportJsonButton.disabled = running || !hasAnySample();
    els.exportCsvButton.disabled = running || !hasAnySample();
  }

  function renderAll() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      const summary = computeSummary(state.results);
      renderSummary(summary);
      renderQuality(summary);
      renderDetails(summary);
      drawThroughputChart(els.downloadChart, state.results.download, '下载', getCssVar('--download'));
      drawThroughputChart(els.uploadChart, state.results.upload, '上传', getCssVar('--upload'));
      drawLatencyChart();
    });
  }

  function queueRender() {
    renderAll();
  }

  function computeSummary(results) {
    const downloadStats = summarizeBandwidth(results.download);
    const uploadStats = summarizeBandwidth(results.upload);
    const idleLatencies = results.latency.filter((sample) => sample.label !== 'warmup' && Number.isFinite(sample.ms)).map((sample) => sample.ms);
    const loadedDownload = results.loadedLatency.download.filter((sample) => Number.isFinite(sample.ms)).map((sample) => sample.ms);
    const loadedUpload = results.loadedLatency.upload.filter((sample) => Number.isFinite(sample.ms)).map((sample) => sample.ms);
    const loadedCombined = loadedDownload.concat(loadedUpload);
    return {
      downloadMbps: downloadStats.value,
      uploadMbps: uploadStats.value,
      downloadStats,
      uploadStats,
      latencyMs: percentile(idleLatencies, 0.5),
      jitterMs: computeJitter(idleLatencies),
      loadedLatencyMs: percentile(loadedCombined, 0.5),
      loadedDownloadMs: percentile(loadedDownload, 0.5),
      loadedUploadMs: percentile(loadedUpload, 0.5),
      sampleCounts: {
        download: downloadStats.validCount,
        upload: uploadStats.validCount,
        latency: idleLatencies.length,
        loadedLatency: loadedCombined.length
      }
    };
  }

  function summarizeBandwidth(samples) {
    const valid = samples.filter((sample) => Number.isFinite(sample.speedMbps) && Number.isFinite(sample.durationMs) && sample.durationMs >= MIN_BANDWIDTH_SAMPLE_MS && sample.bytes > 0);
    const groups = groupBandwidthSamples(valid);
    const stable = groups.filter((group) => group.samples.length >= 2 && group.durationP50 >= STABLE_GROUP_MS);
    const fallback = groups.filter((group) => group.samples.length >= 2);
    const candidates = stable.length ? stable : (fallback.length ? fallback : groups);
    const selected = candidates.length ? [...candidates].sort((a, b) => a.bytes - b.bytes)[candidates.length - 1] : null;
    return {
      value: selected ? selected.p50 : null,
      selected,
      groups,
      validCount: valid.length,
      rawCount: samples.length,
      source: selected ? (stable.includes(selected) ? 'stable-largest-p50' : 'largest-p50') : null
    };
  }

  function groupBandwidthSamples(samples) {
    const bySize = new Map();
    for (const sample of samples) {
      if (!bySize.has(sample.requestedBytes)) bySize.set(sample.requestedBytes, []);
      bySize.get(sample.requestedBytes).push(sample);
    }
    return [...bySize.entries()].sort((a, b) => a[0] - b[0]).map(([bytes, sizeSamples]) => {
      const values = sizeSamples.map((sample) => sample.speedMbps).filter(Number.isFinite);
      const durations = sizeSamples.map((sample) => sample.durationMs).filter(Number.isFinite);
      return {
        key: String(bytes),
        bytes,
        sizeLabel: formatBytes(bytes),
        samples: sizeSamples,
        p50: percentile(values, 0.5),
        p75: percentile(values, 0.75),
        p90: percentile(values, 0.9),
        min: min(values),
        max: max(values),
        durationP50: percentile(durations, 0.5),
        durationP90: percentile(durations, 0.9)
      };
    });
  }

  function renderSummary(summary) {
    setText(els.downloadValue, formatSpeed(summary.downloadMbps));
    setText(els.uploadValue, formatSpeed(summary.uploadMbps));
    setText(els.latencyValue, formatLatency(summary.latencyMs));
    setText(els.loadedLatencyValue, formatLatency(summary.loadedLatencyMs));
    setText(els.jitterValue, formatLatency(summary.jitterMs));
    setText(els.downloadSamples, `${summary.sampleCounts.download} 样本`);
    setText(els.uploadSamples, `${summary.sampleCounts.upload} 样本`);
    setText(els.downloadHint, bandwidthHint(summary.downloadStats));
    setText(els.uploadHint, bandwidthHint(summary.uploadStats));
    setText(els.latencyHint, summary.latencyMs ? `中位数 ${formatLatency(summary.latencyMs)} ms · ${summary.sampleCounts.latency} 样本` : '等待样本');
    setText(els.loadedLatencyHint, summary.loadedLatencyMs ? `中位数 ${formatLatency(summary.loadedLatencyMs)} ms · ${summary.sampleCounts.loadedLatency} 样本` : '等待样本');
    setText(els.jitterHint, summary.jitterMs ? `平均相邻差 ${formatLatency(summary.jitterMs)} ms` : '等待样本');
  }

  function bandwidthHint(stats) {
    if (!stats.selected) return '等待样本';
    const source = stats.source === 'stable-largest-p50' ? '稳定样本' : '最大样本组';
    return `${source} · ${stats.selected.sizeLabel} · P50 ${formatSpeed(stats.selected.p50)} Mbps`;
  }

  function renderQuality(summary) {
    const index = computeQualityIndex(summary);
    if (Number.isFinite(index)) {
      setText(els.qualityScoreValue, String(index));
      setText(els.qualityWord, qualityWord(index));
      setText(els.qualityNote, qualityNote(summary));
      els.qualityGauge.style.setProperty('--score', String(index));
    } else {
      setText(els.qualityScoreValue, '--');
      setText(els.qualityWord, '等待测试');
      setText(els.qualityNote, '完成后显示综合评分');
      els.qualityGauge.style.setProperty('--score', '0');
    }
  }

  function computeQualityIndex(summary) {
    if (!hasEnoughForQuality(summary)) return null;
    const loaded = Number.isFinite(summary.loadedLatencyMs) ? summary.loadedLatencyMs : summary.latencyMs;
    const jitter = Number.isFinite(summary.jitterMs) ? summary.jitterMs : 0;
    const download = scoreMetric(summary.downloadMbps, [5, 20, 50, 100]) / 4;
    const upload = scoreMetric(summary.uploadMbps, [2, 10, 25, 50]) / 4;
    const latency = scoreMetricInverse(summary.latencyMs, [220, 120, 65, 30]) / 4;
    const loadedLatency = scoreMetricInverse(loaded, [320, 180, 100, 60]) / 4;
    const jitterScore = scoreMetricInverse(jitter, [70, 35, 18, 8]) / 4;
    return Math.max(0, Math.min(100, Math.round((download * 0.26 + upload * 0.18 + latency * 0.28 + loadedLatency * 0.18 + jitterScore * 0.10) * 100)));
  }

  function hasEnoughForQuality(summary) {
    return Number.isFinite(summary.downloadMbps) && Number.isFinite(summary.uploadMbps) && Number.isFinite(summary.latencyMs);
  }

  function scoreMetric(value, thresholds) {
    if (!Number.isFinite(value)) return 0;
    if (value >= thresholds[3]) return 4;
    if (value >= thresholds[2]) return 3;
    if (value >= thresholds[1]) return 2;
    if (value >= thresholds[0]) return 1;
    return 0;
  }

  function scoreMetricInverse(value, thresholds) {
    if (!Number.isFinite(value)) return 0;
    if (value <= thresholds[3]) return 4;
    if (value <= thresholds[2]) return 3;
    if (value <= thresholds[1]) return 2;
    if (value <= thresholds[0]) return 1;
    return 0;
  }

  function qualityWord(index) {
    if (index >= 88) return '极佳';
    if (index >= 72) return '稳定';
    if (index >= 55) return '可用';
    if (index >= 38) return '受限';
    return '较差';
  }

  function qualityNote(summary) {
    const parts = [];
    if (Number.isFinite(summary.downloadMbps)) parts.push(`下载 ${formatSpeed(summary.downloadMbps)} Mbps`);
    if (Number.isFinite(summary.uploadMbps)) parts.push(`上传 ${formatSpeed(summary.uploadMbps)} Mbps`);
    if (Number.isFinite(summary.latencyMs)) parts.push(`延迟 ${formatLatency(summary.latencyMs)} ms`);
    return parts.join(' · ') || '完成后显示综合评分';
  }

  function renderDetails(summary) {
    const groups = buildDetailGroups(summary);
    replaceChildren(els.detailsBody);
    if (!groups.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 9;
      cell.className = 'empty-cell';
      cell.textContent = '暂无样本';
      row.appendChild(cell);
      els.detailsBody.appendChild(row);
      return;
    }
    for (const group of groups) {
      const row = document.createElement('tr');
      row.className = 'clickable';
      row.tabIndex = 0;
      row.dataset.detail = group.detail;
      if (group.bytes) row.dataset.bytes = String(group.bytes);
      row.dataset.label = group.sizeLabel || '';
      appendCell(row, pill(group.label, group.className));
      appendCell(row, group.sizeLabel);
      appendCell(row, String(group.count));
      appendCell(row, formatGroupedValue(group, group.main));
      appendCell(row, formatGroupedValue(group, group.p50));
      appendCell(row, formatGroupedValue(group, group.p90));
      appendCell(row, formatGroupedValue(group, group.min));
      appendCell(row, formatGroupedValue(group, group.max));
      appendCell(row, group.durationP50 === null ? '--' : `${formatLatency(group.durationP50)} ms`);
      els.detailsBody.appendChild(row);
    }
  }

  function buildDetailGroups(summary) {
    const groups = [];
    for (const group of summary.downloadStats.groups) {
      groups.push({ detail: 'download', bytes: group.bytes, label: 'Download', className: 'pill-download', sizeLabel: group.sizeLabel, unit: 'Mbps', count: group.samples.length, main: group === summary.downloadStats.selected ? summary.downloadStats.value : group.p50, p50: group.p50, p90: group.p90, min: group.min, max: group.max, durationP50: group.durationP50 });
    }
    for (const group of summary.uploadStats.groups) {
      groups.push({ detail: 'upload', bytes: group.bytes, label: 'Upload', className: 'pill-upload', sizeLabel: group.sizeLabel, unit: 'Mbps', count: group.samples.length, main: group === summary.uploadStats.selected ? summary.uploadStats.value : group.p50, p50: group.p50, p90: group.p90, min: group.min, max: group.max, durationP50: group.durationP50 });
    }
    addLatencyGroup(groups, 'latency', 'Latency', 'pill-latency', 'idle', state.results.latency.filter((sample) => sample.label !== 'warmup'));
    addLatencyGroup(groups, 'loaded', 'Loaded DL', 'pill-loaded', 'download loaded', state.results.loadedLatency.download);
    addLatencyGroup(groups, 'loaded', 'Loaded UL', 'pill-loaded', 'upload loaded', state.results.loadedLatency.upload);
    return groups;
  }

  function addLatencyGroup(groups, detail, label, className, sizeLabel, samples) {
    if (!samples.length) return;
    const values = samples.map((sample) => sample.ms).filter(Number.isFinite);
    groups.push({ detail, label, className, sizeLabel, unit: 'ms', count: samples.length, main: percentile(values, 0.5), p50: percentile(values, 0.5), p90: percentile(values, 0.9), min: min(values), max: max(values), durationP50: median(samples.map((sample) => sample.totalMs ?? sample.ms)) });
  }

  function formatGroupedValue(group, value) {
    if (group.unit === 'Mbps') return `${formatSpeed(value)} Mbps`;
    if (group.unit === '%') return Number.isFinite(value) ? `${formatNumber(value, 2)}%` : '--';
    return `${formatLatency(value)} ms`;
  }

  function handleDetailClick(event) {
    const target = event.target.closest('[data-detail]');
    if (!target) return;
    const kind = target.dataset.detail;
    const filter = target.dataset.bytes ? { bytes: Number(target.dataset.bytes), label: target.dataset.label || '' } : null;
    openDetails(kind, filter);
  }

  function handleDetailKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target.closest('[data-detail]');
    if (!target || !(target.matches('tr') || target.matches('.info-card'))) return;
    event.preventDefault();
    target.click();
  }

  function openDetails(kind, filter) {
    const model = buildDetailModel(kind, filter);
    setText(els.dialogKicker, model.kicker);
    setText(els.dialogTitle, model.title);
    setText(els.dialogSubtitle, model.subtitle);
    renderDialogStats(model.stats);
    renderDialogTable(model.columns, model.rows);
    if (typeof els.detailDialog.showModal === 'function') els.detailDialog.showModal();
    else els.detailDialog.setAttribute('open', '');
  }

  function buildDetailModel(kind, filter) {
    const summary = computeSummary(state.results);
    if (kind === 'download') return bandwidthDetail('download', state.results.download, summary.downloadStats, filter);
    if (kind === 'upload') return bandwidthDetail('upload', state.results.upload, summary.uploadStats, filter);
    if (kind === 'latency') return latencyDetail();
    if (kind === 'loaded') return loadedLatencyDetail();
    if (kind === 'jitter') return jitterDetail(summary);
    if (kind === 'connection') return connectionDetail();
    return qualityDetail(summary);
  }

  function bandwidthDetail(kind, samples, stats, filter) {
    const label = kind === 'download' ? '下载' : '上传';
    const filtered = filter && Number.isFinite(filter.bytes) ? samples.filter((sample) => sample.requestedBytes === filter.bytes) : samples;
    const values = filtered.map((sample) => sample.speedMbps).filter(Number.isFinite);
    const durations = filtered.map((sample) => sample.durationMs).filter(Number.isFinite);
    return {
      kicker: kind,
      title: `${label}样本${filter?.label ? ` · ${filter.label}` : ''}`,
      subtitle: stats.selected ? `主结果：${stats.selected.sizeLabel} · P50` : '等待可用样本',
      stats: [
        ['主结果', `${formatSpeed(stats.value)} Mbps`],
        ['样本', `${filtered.length} / ${samples.length}`],
        ['P50', `${formatSpeed(percentile(values, 0.5))} Mbps`],
        ['P90', `${formatSpeed(percentile(values, 0.9))} Mbps`],
        ['最小', `${formatSpeed(min(values))} Mbps`],
        ['最大', `${formatSpeed(max(values))} Mbps`],
        ['中位耗时', `${formatLatency(percentile(durations, 0.5))} ms`],
        ['主样本组', stats.selected ? stats.selected.sizeLabel : '--']
      ],
      columns: kind === 'upload'
        ? ['#', '大小', 'Mbps', '耗时', '服务端读取', '浏览器总耗时', '收到字节', '计时来源', '时间']
        : ['#', '大小', 'Mbps', '传输耗时', '浏览器总耗时', '字节', '计时来源', '时间'],
      rows: filtered.map((sample, index) => kind === 'upload'
        ? [index + 1, formatBytes(sample.requestedBytes), formatSpeed(sample.speedMbps), `${formatLatency(sample.durationMs)} ms`, `${formatLatency(sample.serverDurationMs)} ms`, `${formatLatency(sample.totalMs)} ms`, formatBytes(sample.receivedBytes), sample.durationSource || '--', formatTime(sample.at)]
        : [index + 1, formatBytes(sample.requestedBytes), formatSpeed(sample.speedMbps), `${formatLatency(sample.durationMs)} ms`, `${formatLatency(sample.totalMs)} ms`, formatBytes(sample.bytes), sample.durationSource || '--', formatTime(sample.at)])
    };
  }

  function latencyDetail() {
    const samples = state.results.latency.filter((sample) => sample.label !== 'warmup');
    const values = samples.map((sample) => sample.ms).filter(Number.isFinite);
    return {
      kicker: 'Latency',
      title: '空闲延迟样本',
      subtitle: samples.length ? `${samples.length} 个样本` : '等待样本',
      stats: [
        ['P50', `${formatLatency(percentile(values, 0.5))} ms`],
        ['P90', `${formatLatency(percentile(values, 0.9))} ms`],
        ['最小', `${formatLatency(min(values))} ms`],
        ['最大', `${formatLatency(max(values))} ms`]
      ],
      columns: ['#', '阶段', '延迟', '浏览器总耗时', '时间'],
      rows: samples.map((sample, index) => [index + 1, sample.label || 'idle', `${formatLatency(sample.ms)} ms`, `${formatLatency(sample.totalMs)} ms`, formatTime(sample.at)])
    };
  }

  function loadedLatencyDetail() {
    const samples = state.results.loadedLatency.download.map((sample) => ({ ...sample, direction: 'download' })).concat(state.results.loadedLatency.upload.map((sample) => ({ ...sample, direction: 'upload' })));
    const values = samples.map((sample) => sample.ms).filter(Number.isFinite);
    return {
      kicker: 'Loaded latency',
      title: '负载延迟样本',
      subtitle: samples.length ? `${samples.length} 个样本` : '等待样本',
      stats: [
        ['P50', `${formatLatency(percentile(values, 0.5))} ms`],
        ['P90', `${formatLatency(percentile(values, 0.9))} ms`],
        ['下载负载', `${state.results.loadedLatency.download.length} 样本`],
        ['上传负载', `${state.results.loadedLatency.upload.length} 样本`]
      ],
      columns: ['#', '方向', '延迟', '浏览器总耗时', '时间'],
      rows: samples.map((sample, index) => [index + 1, sample.direction, `${formatLatency(sample.ms)} ms`, `${formatLatency(sample.totalMs)} ms`, formatTime(sample.at)])
    };
  }

  function jitterDetail(summary) {
    const samples = state.results.latency.filter((sample) => sample.label !== 'warmup' && Number.isFinite(sample.ms));
    const rows = [];
    for (let i = 1; i < samples.length; i += 1) {
      rows.push([i, `${formatLatency(samples[i - 1].ms)} ms`, `${formatLatency(samples[i].ms)} ms`, `${formatLatency(Math.abs(samples[i].ms - samples[i - 1].ms))} ms`, formatTime(samples[i].at)]);
    }
    return {
      kicker: 'Jitter',
      title: '抖动样本',
      subtitle: rows.length ? `${rows.length} 个相邻差值` : '等待样本',
      stats: [
        ['抖动', `${formatLatency(summary.jitterMs)} ms`],
        ['延迟 P50', `${formatLatency(summary.latencyMs)} ms`],
        ['样本', String(samples.length)],
        ['算法', '相邻差平均值']
      ],
      columns: ['#', '上一样本', '当前样本', '差值', '时间'],
      rows
    };
  }

  function connectionDetail() {
    const client = state.client || {};
    const info = client.ipInfo || {};
    return {
      kicker: 'Connection',
      title: '客户端与节点',
      subtitle: state.config?.serverRegion || '--',
      stats: [
        ['客户端 IP', client.ip || 'hidden'],
        ['位置', formatLocation(client.ipInfo, client.headers)],
        ['ISP', formatIsp(client.ipInfo)],
        ['协议', client.ipVersion || '--']
      ],
      columns: ['字段', '值'],
      rows: [
        ['客户端 IP', client.ip || 'hidden'],
        ['国家/地区', info.country || client.headers?.country || '--'],
        ['区域', info.region || '--'],
        ['城市', info.city || '--'],
        ['ASN', info.asn || '--'],
        ['ISP', info.isp || info.org || '--'],
        ['时区', info.timezone || '--'],
        ['浏览器', summarizeBrowser(navigator.userAgent || client.userAgent || '')],
        ['Cloudflare Colo', client.edge?.colo || client.headers?.colo || '--'],
        ['测速节点', state.config?.serverRegion || client.serverRegion || '--']
      ]
    };
  }

  function qualityDetail(summary) {
    const index = computeQualityIndex(summary);
    return {
      kicker: 'Quality',
      title: '网络质量',
      subtitle: Number.isFinite(index) ? `${index}/100 · ${qualityWord(index)}` : '等待测试',
      stats: [
        ['质量评分', Number.isFinite(index) ? String(index) : '--'],
        ['下载', `${formatSpeed(summary.downloadMbps)} Mbps`],
        ['上传', `${formatSpeed(summary.uploadMbps)} Mbps`],
        ['空闲延迟', `${formatLatency(summary.latencyMs)} ms`]
      ],
      columns: ['指标', '值'],
      rows: [
        ['下载', `${formatSpeed(summary.downloadMbps)} Mbps`],
        ['上传', `${formatSpeed(summary.uploadMbps)} Mbps`],
        ['空闲延迟', `${formatLatency(summary.latencyMs)} ms`],
        ['负载延迟', `${formatLatency(summary.loadedLatencyMs)} ms`],
        ['抖动', `${formatLatency(summary.jitterMs)} ms`]
      ]
    };
  }

  function renderDialogStats(stats) {
    replaceChildren(els.dialogStats);
    for (const [label, value] of stats) {
      const box = document.createElement('div');
      box.className = 'dialog-stat';
      const span = document.createElement('span');
      span.textContent = label;
      const strong = document.createElement('strong');
      strong.textContent = value;
      box.append(span, strong);
      els.dialogStats.appendChild(box);
    }
  }

  function renderDialogTable(columns, rows) {
    replaceChildren(els.dialogTableHead);
    replaceChildren(els.dialogTableBody);
    const headRow = document.createElement('tr');
    for (const column of columns) {
      const th = document.createElement('th');
      th.textContent = column;
      headRow.appendChild(th);
    }
    els.dialogTableHead.appendChild(headRow);
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = columns.length;
      cell.className = 'empty-cell';
      cell.textContent = '暂无数据';
      row.appendChild(cell);
      els.dialogTableBody.appendChild(row);
      return;
    }
    for (const rowData of rows) {
      const row = document.createElement('tr');
      for (const value of rowData) appendCell(row, value);
      els.dialogTableBody.appendChild(row);
    }
  }

  function drawThroughputChart(canvas, samples, name, color) {
    const points = samples.map((sample, index) => ({
      x: index + 1,
      y: sample.speedMbps,
      label: formatBytes(sample.requestedBytes),
      meta: `${formatSpeed(sample.speedMbps)} Mbps · ${formatLatency(sample.durationMs)} ms`
    })).filter((point) => Number.isFinite(point.y));
    drawChart(canvas, [{ name, color, points }], 'Mbps', (value) => formatSpeed(value));
  }

  function drawLatencyChart() {
    const idle = state.results.latency.filter((sample) => sample.label !== 'warmup').map((sample, index) => ({ x: index + 1, y: sample.ms, label: 'idle', meta: `${formatLatency(sample.ms)} ms` })).filter((point) => Number.isFinite(point.y));
    const loadedDownload = state.results.loadedLatency.download.map((sample, index) => ({ x: index + 1, y: sample.ms, label: 'download loaded', meta: `${formatLatency(sample.ms)} ms` })).filter((point) => Number.isFinite(point.y));
    const loadedUpload = state.results.loadedLatency.upload.map((sample, index) => ({ x: index + 1, y: sample.ms, label: 'upload loaded', meta: `${formatLatency(sample.ms)} ms` })).filter((point) => Number.isFinite(point.y));
    drawChart(els.latencyChart, [
      { name: 'Idle', color: getCssVar('--latency'), points: idle },
      { name: 'Loaded DL', color: getCssVar('--download'), points: loadedDownload },
      { name: 'Loaded UL', color: getCssVar('--upload'), points: loadedUpload }
    ], 'ms', (value) => formatLatency(value));
  }

  function drawChart(canvas, series, unit, formatter) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(280, rect.width || canvas.clientWidth || 400);
    const height = Math.max(150, rect.height || canvas.clientHeight || 220);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const text = getCssVar('--muted');
    const textStrong = getCssVar('--text-strong');
    const line = getCssVar('--line-strong');
    const fill = getCssVar('--panel-solid');
    ctx.clearRect(0, 0, width, height);
    const plot = { left: 52, right: 16, top: 28, bottom: 32 };
    const plotWidth = width - plot.left - plot.right;
    const plotHeight = height - plot.top - plot.bottom;
    const allPoints = series.flatMap((item) => item.points.map((point) => ({ ...point, series: item.name, color: item.color })));
    drawLegend(ctx, series, width, text);
    if (!allPoints.length) {
      drawEmptyChart(ctx, width, height, text, line);
      state.chartModels.set(canvas.id, { points: [] });
      return;
    }
    const maxX = Math.max(1, max(allPoints.map((point) => point.x)) || 1);
    const maxY = niceMax((max(allPoints.map((point) => point.y)) || 1) * 1.12);
    ctx.fillStyle = fill;
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    roundRect(ctx, plot.left, plot.top, plotWidth, plotHeight, 13);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, plot.left, plot.top, plotWidth, plotHeight, 13);
    ctx.clip();
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i += 1) {
      const y = plot.top + plotHeight - (plotHeight * i) / 4;
      const value = (maxY * i) / 4;
      ctx.globalAlpha = i === 0 ? 0.8 : 0.45;
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.left + plotWidth, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(formatter(value), plot.left - 8, y);
    }
    const hitPoints = [];
    for (const item of series) {
      if (!item.points.length) continue;
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      item.points.forEach((point, index) => {
        const x = plot.left + ((point.x - 1) / Math.max(1, maxX - 1)) * plotWidth;
        const y = plot.top + plotHeight - (point.y / maxY) * plotHeight;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        hitPoints.push({ x, y, point, series: item.name, unit, color: item.color });
      });
      ctx.stroke();
      ctx.fillStyle = item.color;
      for (const point of item.points) {
        const x = plot.left + ((point.x - 1) / Math.max(1, maxX - 1)) * plotWidth;
        const y = plot.top + plotHeight - (point.y / maxY) * plotHeight;
        ctx.beginPath();
        ctx.arc(x, y, 2.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.fillStyle = text;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(unit, plot.left, height - 7);
    ctx.textAlign = 'right';
    ctx.fillText('samples', width - plot.right, height - 7);
    ctx.fillStyle = textStrong;
    const last = allPoints[allPoints.length - 1];
    ctx.textAlign = 'right';
    ctx.fillText(`${formatter(last.y)} ${unit}`, width - plot.right, plot.top - 8);
    state.chartModels.set(canvas.id, { points: hitPoints });
  }

  function bindChart(canvas, tooltip) {
    if (!canvas || !tooltip) return;
    canvas.addEventListener('mousemove', (event) => showChartTooltip(canvas, tooltip, event));
    canvas.addEventListener('mouseleave', () => { tooltip.hidden = true; });
  }

  function showChartTooltip(canvas, tooltip, event) {
    const model = state.chartModels.get(canvas.id);
    if (!model || !model.points.length) {
      tooltip.hidden = true;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best = null;
    let bestDistance = Infinity;
    for (const point of model.points) {
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < bestDistance) {
        best = point;
        bestDistance = distance;
      }
    }
    if (!best || bestDistance > 34) {
      tooltip.hidden = true;
      return;
    }
    tooltip.textContent = `${best.series}\n#${best.point.x} · ${best.point.label}\n${best.point.meta || ''}`.trim();
    tooltip.hidden = false;
    const left = Math.min(Math.max(8, best.x + 12), rect.width - tooltip.offsetWidth - 8);
    const top = Math.min(Math.max(8, best.y - tooltip.offsetHeight - 10), rect.height - tooltip.offsetHeight - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function drawLegend(ctx, series, width, textColor) {
    let x = 18;
    const y = 14;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const item of series) {
      if (!item.points.length || x > width - 90) continue;
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(x, y, 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = textColor;
      ctx.fillText(item.name, x + 8, y);
      x += Math.max(78, ctx.measureText(item.name).width + 28);
    }
  }

  function drawEmptyChart(ctx, width, height, textColor, lineColor) {
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    roundRect(ctx, 14, 24, width - 28, height - 48, 14);
    ctx.stroke();
    ctx.fillStyle = textColor;
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('等待样本', width / 2, height / 2);
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function updateProgress() {
    const pct = Math.max(0, Math.min(100, Math.round((state.completedWork / state.totalWork) * 100)));
    setText(els.progressPercent, `${pct}%`);
    els.progressBar.style.width = `${pct}%`;
  }

  function setStatus(text) {
    setText(els.statusText, text);
  }

  function setError(text) {
    setText(els.errorText, text || '');
    if (els.runState && text) {
      els.runState.textContent = '异常';
      els.runState.className = 'state-pill error';
    }
  }

  function exportJson() {
    const summary = computeSummary(state.results);
    const payload = JSON.stringify({ summary, results: state.results }, null, 2);
    downloadBlob(`open-edge-speed-${timestampForFilename()}.json`, 'application/json', payload);
  }

  function exportCsv() {
    const rows = [['type', 'label', 'bytes', 'requestedBytes', 'durationMs', 'totalMs', 'speedMbps', 'latencyMs', 'durationSource', 'serverDurationMs', 'receivedBytes', 'at']];
    for (const sample of state.results.download) rows.push(['download', '', sample.bytes, sample.requestedBytes, sample.durationMs, sample.totalMs, sample.speedMbps, '', sample.durationSource || '', '', '', sample.at]);
    for (const sample of state.results.upload) rows.push(['upload', '', sample.bytes, sample.requestedBytes, sample.durationMs, sample.totalMs, sample.speedMbps, '', sample.durationSource || '', sample.serverDurationMs || '', sample.receivedBytes || '', sample.at]);
    for (const sample of state.results.latency) rows.push(['latency', sample.label || 'idle', '', '', '', sample.totalMs, '', sample.ms, '', '', '', sample.at]);
    for (const sample of state.results.loadedLatency.download) rows.push(['loaded-latency', 'download', '', '', '', sample.totalMs, '', sample.ms, '', '', '', sample.at]);
    for (const sample of state.results.loadedLatency.upload) rows.push(['loaded-latency', 'upload', '', '', '', sample.totalMs, '', sample.ms, '', '', '', sample.at]);
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
    downloadBlob(`open-edge-speed-${timestampForFilename()}.csv`, 'text/csv', csv);
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
  }

  function downloadBlob(filename, type, text) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function hasAnySample() {
    return state.results.download.length > 0 || state.results.upload.length > 0 || state.results.latency.length > 0 || state.results.loadedLatency.download.length > 0 || state.results.loadedLatency.upload.length > 0;
  }

  function appendCell(row, value) {
    const cell = document.createElement('td');
    if (value instanceof Node) cell.appendChild(value);
    else cell.textContent = value == null ? '--' : String(value);
    row.appendChild(cell);
  }

  function pill(text, className) {
    const span = document.createElement('span');
    span.className = `pill ${className || ''}`.trim();
    span.textContent = text;
    return span;
  }

  function replaceChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function setText(node, text) {
    if (node) node.textContent = text == null ? '' : String(text);
  }

  function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#64748b';
  }

  function randomMarker() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(resolve, ms);
      if (!signal) return;
      const onAbort = () => {
        clearTimeout(timeoutId);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
  }

  function isAbortError(error) {
    return error && (error.name === 'AbortError' || /aborted/i.test(String(error.message || error)));
  }

  function safeErrorMessage(error) {
    return String(error && error.message ? error.message : error).slice(0, 240);
  }

  function bytesToMbps(bytes, durationMs) {
    if (!Number.isFinite(bytes) || !Number.isFinite(durationMs) || durationMs <= 0) return null;
    return (bytes * 8) / (durationMs / 1000) / 1000000;
  }

  function percentile(values, p) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  function median(values) {
    return percentile(values, 0.5);
  }

  function min(values) {
    const filtered = values.filter(Number.isFinite);
    return filtered.length ? Math.min(...filtered) : null;
  }

  function max(values) {
    const filtered = values.filter(Number.isFinite);
    return filtered.length ? Math.max(...filtered) : null;
  }

  function computeJitter(latencies) {
    const values = latencies.filter(Number.isFinite);
    if (values.length < 2) return null;
    let total = 0;
    for (let i = 1; i < values.length; i += 1) total += Math.abs(values[i] - values[i - 1]);
    return total / (values.length - 1);
  }

  function formatNumber(value, decimals) {
    return Number.isFinite(value) ? Number(value).toFixed(decimals) : '--';
  }

  function formatSpeed(value) {
    if (!Number.isFinite(value)) return '--';
    if (value >= 1000) return value.toFixed(0);
    if (value >= 100) return value.toFixed(1);
    return value.toFixed(2);
  }

  function formatLatency(value) {
    if (!Number.isFinite(value)) return '--';
    if (value >= 1000) return value.toFixed(0);
    return value.toFixed(1);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '--';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = Number(bytes);
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
      value /= 1000;
      unit += 1;
    }
    const decimals = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(decimals)} ${units[unit]}`;
  }

  function niceMax(value) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    const exponent = Math.floor(Math.log10(value));
    const fraction = value / Math.pow(10, exponent);
    let niceFraction = 1;
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
    return niceFraction * Math.pow(10, exponent);
  }

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatTime(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleTimeString();
  }

  function timestampForFilename() {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }
})();
