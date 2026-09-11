const API_BASE = '/api';
const CACHE_KEY = 'voiceshield-demo-cache-v1';
const MAX_WAV_BYTES = 10 * 1024 * 1024;
const MIN_DURATION_SECONDS = 0.25;
const MAX_DURATION_SECONDS = 60;

const ui = {
  navButtons: [...document.querySelectorAll('.nav-btn')],
  sections: [...document.querySelectorAll('.page-section')],
  systemStatus: document.getElementById('system-status'),
  statusText: document.querySelector('.status-text'),
  protectionStatus: document.getElementById('protection-status'),
  protectionDetail: document.getElementById('protection-detail'),
  uploadInput: document.getElementById('audio-upload'),
  uploadStatus: document.getElementById('upload-status'),
  dropZone: document.getElementById('drop-zone'),
  alertsStatus: document.getElementById('alerts-status'),
  verificationPanel: document.getElementById('verification-panel'),
  verificationButton: document.getElementById('request-verification-button'),
  verifyLedgerButton: document.getElementById('verify-ledger-button')
};

let lastSnapshot = null;
let latestResult = null;
let selectedAlertId = null;

function escapeText(value) {
  return String(value ?? '');
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString([], {
    hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric'
  });
}

function formatNumber(value, suffix = '') {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1).replace(/\.0$/, '')}${suffix}` : 'No data';
}

function percent(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : '--';
}

function setText(id, value) {
  document.getElementById(id).textContent = escapeText(value);
}

function setSystemState(state, detail) {
  ui.systemStatus.className = `system-status status-${state}`;
  if (state === 'online') {
    ui.statusText.textContent = 'API Online';
    ui.protectionStatus.textContent = 'Monitoring available';
  } else if (state === 'offline') {
    ui.statusText.textContent = 'API Offline';
    ui.protectionStatus.textContent = 'Service unavailable';
  } else {
    ui.statusText.textContent = 'Checking API';
    ui.protectionStatus.textContent = 'Checking service';
  }
  ui.protectionDetail.textContent = detail;
}

function setInlineStatus(element, message, kind = '') {
  element.className = `inline-status ${kind}`.trim();
  element.textContent = message;
}

function createCell(value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = escapeText(value);
  if (className) cell.className = className;
  return cell;
}

function createBadge(value) {
  const badge = document.createElement('span');
  badge.className = `badge ${value}`;
  badge.textContent = value;
  return badge;
}

function clear(element) {
  element.replaceChildren();
}

function makeEmptyRow(colspan, message) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = colspan;
  cell.className = 'empty-state';
  cell.textContent = message;
  row.append(cell);
  return row;
}

async function apiRequest(path, options = {}) {
  const { timeoutMs = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: 'application/json', ...(fetchOptions.headers || {}) },
      ...fetchOptions,
      signal: controller.signal
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('The API returned an unexpected response. Please try again.');
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.detail || `Request failed (${response.status}).`);
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The API did not respond within 10 seconds. Please try again.');
    if (error instanceof TypeError) throw new Error('Unable to reach the API. Check the connection and try again.');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function normaliseSnapshot(candidate) {
  const snapshot = candidate && typeof candidate === 'object' ? candidate : {};
  const ledger = snapshot.ledger && typeof snapshot.ledger === 'object' ? snapshot.ledger : {};
  return {
    stats: snapshot.stats && typeof snapshot.stats === 'object' ? snapshot.stats : {},
    analyses: Array.isArray(snapshot.analyses) ? snapshot.analyses.filter((item) => item && typeof item === 'object') : [],
    alerts: Array.isArray(snapshot.alerts) ? snapshot.alerts.filter((item) => item && typeof item === 'object') : [],
    ledger: {
      ...ledger,
      valid: typeof ledger.valid === 'boolean' ? ledger.valid : false,
      items: Array.isArray(ledger.items) ? ledger.items.filter((item) => item && typeof item === 'object') : []
    }
  };
}

function mergeRecords(localItems, apiItems, idField, mergeRecord) {
  const merged = new Map();
  localItems.forEach((item) => {
    if (item[idField]) merged.set(item[idField], item);
  });
  apiItems.forEach((item) => {
    if (!item[idField]) return;
    const localItem = merged.get(item[idField]);
    merged.set(item[idField], localItem ? mergeRecord(localItem, item) : item);
  });
  return [...merged.values()].sort((first, second) => String(second.timestamp || '').localeCompare(String(first.timestamp || '')));
}

function mergeAnalysis(localAnalysis, apiAnalysis) {
  const merged = { ...localAnalysis, ...apiAnalysis };
  if (localAnalysis.local_verification_updated_at) {
    merged.verification_status = localAnalysis.verification_status;
    merged.verification_requested_at = localAnalysis.verification_requested_at || apiAnalysis.verification_requested_at;
    merged.local_verification_updated_at = localAnalysis.local_verification_updated_at;
  }
  return merged;
}

function mergeAlert(localAlert, apiAlert) {
  const merged = { ...localAlert, ...apiAlert };
  if (localAlert.local_status_updated_at) {
    merged.status = localAlert.status;
    merged.local_status_updated_at = localAlert.local_status_updated_at;
  }
  if (localAlert.local_verification_updated_at) {
    merged.verification_status = localAlert.verification_status;
    merged.local_verification_updated_at = localAlert.local_verification_updated_at;
  }
  return merged;
}

function mergeLedger(localLedger, apiLedger) {
  const items = new Map();
  // API items are newest-first. Keeping that order also appends each newly
  // returned event once without modifying its hash-chain fields.
  [...apiLedger.items, ...localLedger.items].forEach((item) => {
    const identifier = item.event_id || item.hash;
    if (identifier && !items.has(identifier)) items.set(identifier, item);
  });
  return {
    ...localLedger,
    ...apiLedger,
    valid: apiLedger.items.length ? apiLedger.valid : localLedger.valid,
    items: [...items.values()]
  };
}

function calculateSnapshotStats(analyses, alerts, apiStats = {}) {
  const total = analyses.length;
  const severity_distribution = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].reduce((distribution, severity) => {
    distribution[severity] = analyses.filter((item) => item.severity === severity).length;
    return distribution;
  }, {});
  const threat_distribution = analyses.reduce((distribution, item) => {
    const threat = item.threat_class || item.threat_type || 'Unknown';
    distribution[threat] = (distribution[threat] || 0) + 1;
    return distribution;
  }, {});
  const average = (field, places) => total
    ? Number((analyses.reduce((sum, item) => sum + (Number(item[field]) || 0), 0) / total).toFixed(places))
    : null;
  return {
    ...apiStats,
    total_analyses: total,
    total_alerts: alerts.length,
    high_risk_events: analyses.filter((item) => ['HIGH', 'CRITICAL'].includes(item.severity)).length,
    critical_events: analyses.filter((item) => item.severity === 'CRITICAL').length,
    average_risk: average('risk_score', 1),
    average_processing_latency_ms: average('processing_latency_ms', 2),
    severity_distribution,
    risk_distribution: severity_distribution,
    threat_distribution
  };
}

function mergeSnapshots(localSnapshot, apiSnapshot) {
  const local = normaliseSnapshot(localSnapshot);
  const api = normaliseSnapshot(apiSnapshot);
  const analyses = mergeRecords(local.analyses, api.analyses, 'analysis_id', mergeAnalysis);
  const alerts = mergeRecords(local.alerts, api.alerts, 'alert_id', mergeAlert);
  const ledger = mergeLedger(local.ledger, api.ledger);
  return {
    stats: calculateSnapshotStats(analyses, alerts, api.stats),
    analyses,
    alerts,
    ledger
  };
}

function storeSnapshot(snapshot) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), snapshot }));
  } catch (error) {
    console.warn('Local demo cache could not be saved.', error);
  }
}

function readSnapshot() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return cached?.snapshot ? normaliseSnapshot(cached.snapshot) : null;
  } catch (error) {
    console.warn('Local demo cache could not be read.', error);
    return null;
  }
}

function storeAndRender(snapshot) {
  const merged = normaliseSnapshot(snapshot);
  storeSnapshot(merged);
  renderSnapshot(merged);
  return merged;
}

function alertFromAnalysis(analysis) {
  if (!analysis.alert_created || !analysis.alert_id) return null;
  return {
    alert_id: analysis.alert_id,
    analysis_id: analysis.analysis_id,
    timestamp: analysis.timestamp,
    severity: analysis.severity,
    risk_score: analysis.risk_score,
    threat_type: analysis.threat_class,
    evidence: analysis.evidence,
    recommended_action: analysis.recommended_action,
    verification_status: analysis.verification_status,
    status: 'NEW'
  };
}

function persistAnalysisResult(analysis) {
  const alert = alertFromAnalysis(analysis);
  return storeAndRender(mergeSnapshots(readSnapshot() || lastSnapshot, {
    analyses: [analysis],
    alerts: alert ? [alert] : [],
    ledger: { items: [] }
  }));
}

function persistAlert(alert) {
  const savedAlert = { ...alert, local_status_updated_at: Date.now() };
  return storeAndRender(mergeSnapshots(readSnapshot() || lastSnapshot, {
    alerts: [savedAlert], ledger: { items: [] }
  }));
}

function persistVerification(analysisId, verificationStatus) {
  const current = normaliseSnapshot(readSnapshot() || lastSnapshot);
  const updatedAt = Date.now();
  const analyses = current.analyses.map((analysis) => analysis.analysis_id === analysisId ? {
    ...analysis,
    verification_status: verificationStatus,
    verification_requested_at: new Date(updatedAt).toISOString(),
    local_verification_updated_at: updatedAt
  } : analysis);
  const alerts = current.alerts.map((alert) => alert.analysis_id === analysisId ? {
    ...alert,
    verification_status: verificationStatus,
    local_verification_updated_at: updatedAt
  } : alert);
  return storeAndRender(mergeSnapshots(current, { analyses, alerts, ledger: { items: [] } }));
}

function renderStats(stats) {
  setText('total-analyses', stats.total_analyses ?? 0);
  setText('high-risk-events', stats.high_risk_events ?? 0);
  setText('critical-events', stats.critical_events ?? 0);
  setText('average-risk', stats.average_risk == null ? 'No data' : `${formatNumber(stats.average_risk)} / 100`);
  setText('average-latency', stats.average_processing_latency_ms == null ? 'No data' : `${formatNumber(stats.average_processing_latency_ms)} ms`);

  renderDistribution('severity-distribution', stats.risk_distribution || stats.severity_distribution, stats.total_analyses, 'severity');
  renderDistribution('risk-distribution', stats.risk_distribution || stats.severity_distribution, stats.total_analyses, 'severity');
  renderDistribution('threat-distribution', stats.threat_distribution, stats.total_analyses, 'threat');
}

function renderDistribution(containerId, distribution, total, type) {
  const container = document.getElementById(containerId);
  clear(container);
  if (!total) {
    const noData = document.createElement('p');
    noData.className = 'empty-state';
    noData.textContent = 'No sufficient data yet.';
    container.append(noData);
    return;
  }

  const entries = type === 'severity'
    ? ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((severity) => [severity, Number(distribution?.[severity] || 0)])
    : Object.entries(distribution || {}).sort((first, second) => second[1] - first[1]);
  for (const [labelText, rawCount] of entries) {
    const count = Number(rawCount || 0);
    const row = document.createElement('div');
    row.className = `distribution-row ${type === 'threat' ? 'threat' : ''}`;
    if (type === 'severity') row.dataset.severity = labelText;
    const label = document.createElement('span');
    label.textContent = labelText;
    const bar = document.createElement('div');
    bar.className = 'distribution-bar';
    const fill = document.createElement('span');
    fill.style.width = `${Math.max(0, Math.min(100, (count / total) * 100))}%`;
    fill.setAttribute('aria-label', `${labelText}: ${count}`);
    bar.append(fill);
    const number = document.createElement('strong');
    number.textContent = String(count);
    row.append(label, bar, number);
    container.append(row);
  }
}

function renderAnalyses(analyses) {
  const body = document.getElementById('analyses-body');
  clear(body);
  if (!analyses?.length) {
    body.append(makeEmptyRow(5, 'No analyses yet. Run a controlled scenario or upload a supported WAV file.'));
    return;
  }
  analyses.slice(0, 10).forEach((analysis) => {
    const row = document.createElement('tr');
    row.append(
      createCell(formatTimestamp(analysis.timestamp)),
      createCell(String(analysis.source || 'Unknown').replace('SIMULATION:', 'SIM: ')),
      createCell(`${formatNumber(analysis.risk_score)} / 100`)
    );
    const severity = document.createElement('td');
    severity.append(createBadge(analysis.severity));
    row.append(severity, createCell(analysis.recommended_action));
    body.append(row);
  });
}

function renderMonitor(analyses) {
  const body = document.getElementById('monitor-body');
  clear(body);
  if (!analyses?.length) {
    body.append(makeEmptyRow(10, 'No analyses yet. Run a controlled scenario or upload a supported WAV file.'));
    return;
  }
  analyses.forEach((analysis) => {
    const row = document.createElement('tr');
    row.append(
      createCell(formatTimestamp(analysis.timestamp)),
      createCell(String(analysis.source || 'Unknown').replace('SIMULATION:', 'SIM: ')),
      createCell(`${formatNumber(analysis.risk_score)} / 100`)
    );
    const severity = document.createElement('td');
    severity.append(createBadge(analysis.severity));
    row.append(
      severity,
      createCell(percent(analysis.clone_probability)),
      createCell(percent(analysis.speaker_match)),
      createCell(percent(analysis.liveness)),
      createCell(percent(analysis.replay_score)),
      createCell(percent(analysis.quality_score)),
      createCell(analysis.recommended_action)
    );
    body.append(row);
  });
}

function renderRecentAlerts(alerts) {
  const container = document.getElementById('recent-alerts');
  clear(container);
  if (!alerts?.length) {
    const noAlerts = document.createElement('p');
    noAlerts.className = 'empty-state';
    noAlerts.textContent = 'No HIGH or CRITICAL events have created alerts.';
    container.append(noAlerts);
    return;
  }
  alerts.slice(0, 3).forEach((alert) => {
    const item = document.createElement('div');
    item.className = `compact-alert ${alert.severity === 'CRITICAL' ? 'critical' : ''}`;
    const title = document.createElement('strong');
    title.textContent = `${alert.severity} · ${formatNumber(alert.risk_score)} / 100`;
    const detail = document.createElement('span');
    detail.textContent = `${alert.threat_type} · ${alert.status}`;
    item.append(title, detail);
    container.append(item);
  });
}

function renderAlerts(alerts) {
  const body = document.getElementById('alerts-body');
  clear(body);
  if (!alerts?.length) {
    body.append(makeEmptyRow(8, 'No alerts yet. HIGH and CRITICAL events will appear here.'));
    return;
  }
  alerts.forEach((alert) => {
    const row = document.createElement('tr');
    row.append(
      createCell(formatTimestamp(alert.timestamp)),
      createCell(alert.alert_id),
      createCell(`${formatNumber(alert.risk_score)} / 100`)
    );
    const severity = document.createElement('td');
    severity.append(createBadge(alert.severity));
    row.append(severity, createCell(alert.threat_type));

    const statusCell = document.createElement('td');
    const select = document.createElement('select');
    select.className = 'status-select';
    select.setAttribute('aria-label', `Change status for ${alert.alert_id}`);
    ['NEW', 'INVESTIGATING', 'RESOLVED'].forEach((status) => {
      const option = document.createElement('option');
      option.value = status;
      option.textContent = status;
      option.selected = status === alert.status;
      select.append(option);
    });
    select.addEventListener('change', () => updateAlertStatus(alert.alert_id, select));
    statusCell.append(select);
    const detailCell = document.createElement('td');
    const detailButton = document.createElement('button');
    detailButton.className = 'text-button';
    detailButton.type = 'button';
    detailButton.textContent = 'View evidence';
    detailButton.addEventListener('click', () => showAlertDetails(alert));
    detailCell.append(detailButton);
    row.append(statusCell, createCell(alert.recommended_action), detailCell);
    body.append(row);
  });
}

function showAlertDetails(alert) {
  selectedAlertId = alert.alert_id;
  const panel = document.getElementById('alert-detail');
  panel.hidden = false;
  setText('alert-detail-title', `${alert.alert_id} evidence`);
  setText('alert-detail-status', `${alert.severity} · ${alert.status}`);
  setText('alert-detail-action', `Recommended action: ${alert.recommended_action}. Verification state: ${alert.verification_status || 'NOT_REQUESTED'}.`);
  const evidence = document.getElementById('alert-detail-evidence');
  clear(evidence);
  (alert.evidence || []).forEach((item) => {
    const entry = document.createElement('li');
    const signal = document.createElement('strong');
    signal.textContent = `${item.signal}: `;
    entry.append(signal, document.createTextNode(item.interpretation));
    evidence.append(entry);
  });
}

function renderLedger(ledger) {
  const status = document.getElementById('ledger-status');
  const body = document.getElementById('ledger-body');
  status.className = `ledger-status ${ledger.valid ? 'valid' : 'invalid'}`;
  status.textContent = ledger.valid ? 'Ledger integrity verified: every returned entry links to the expected previous hash.' : 'Ledger integrity check failed. Do not trust this audit trail.';
  clear(body);
  if (!ledger.items?.length) {
    body.append(makeEmptyRow(5, 'No ledger entries yet. Analyses and alert updates will be chained here.'));
    return;
  }
  ledger.items.forEach((entry) => {
    const row = document.createElement('tr');
    const hash = document.createElement('span');
    hash.className = 'hash';
    hash.title = entry.hash;
    hash.textContent = entry.hash;
    const previous = document.createElement('span');
    previous.className = 'hash';
    previous.title = entry.previous_hash;
    previous.textContent = entry.previous_hash;
    const hashCell = document.createElement('td');
    hashCell.append(hash);
    const previousCell = document.createElement('td');
    previousCell.append(previous);
    row.append(createCell(entry.index), createCell(formatTimestamp(entry.timestamp)), createCell(entry.event_type), hashCell, previousCell);
    body.append(row);
  });
}

function renderSnapshot(snapshot) {
  if (!snapshot) return;
  lastSnapshot = snapshot;
  renderStats(snapshot.stats || {});
  renderAnalyses(snapshot.analyses || []);
  renderMonitor(snapshot.analyses || []);
  renderAlerts(snapshot.alerts || []);
  renderRecentAlerts(snapshot.alerts || []);
  if (selectedAlertId) {
    const selectedAlert = (snapshot.alerts || []).find((alert) => alert.alert_id === selectedAlertId);
    if (selectedAlert) {
      showAlertDetails(selectedAlert);
    } else {
      selectedAlertId = null;
      document.getElementById('alert-detail').hidden = true;
    }
  }
  renderLedger(snapshot.ledger || { valid: false, items: [] });
}

async function refreshDashboard() {
  const localSnapshot = readSnapshot() || lastSnapshot;
  if (localSnapshot) renderSnapshot(localSnapshot);
  try {
    const health = await apiRequest('/health');
    if (health.status !== 'online') throw new Error('Health check did not report online status.');
    setSystemState('online', 'Netlify Function health check succeeded. Raw audio is not sent by this client flow.');

    const [stats, analyses, alerts, ledger] = await Promise.all([
      apiRequest('/stats'), apiRequest('/analyses'), apiRequest('/alerts'), apiRequest('/ledger')
    ]);
    // A fresh Netlify invocation legitimately returns empty arrays. Merge it
    // into the browser snapshot instead of letting it erase demo results.
    storeAndRender(mergeSnapshots(localSnapshot, { stats, analyses, alerts, ledger }));
  } catch (error) {
    setSystemState('offline', `Live API data is unavailable. ${lastSnapshot ? 'Showing the last local demo snapshot.' : 'Run the Netlify Function to enable the dashboard.'}`);
    console.warn('Dashboard refresh failed:', error);
    if (!lastSnapshot) renderSnapshot(localSnapshot);
  }
}

function navigate(target, shouldFocus = false) {
  const destination = document.getElementById(target);
  if (!destination) return;
  ui.sections.forEach((section) => section.classList.toggle('active', section === destination));
  ui.navButtons.forEach((button) => {
    const active = button.dataset.target === target;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (shouldFocus) destination.focus({ preventScroll: true });
}

function displayResult(result) {
  latestResult = result;
  const panel = document.getElementById('result-panel');
  panel.hidden = false;
  setText('result-source', String(result.source || '').replace('SIMULATION:', 'SIM: '));
  setText('result-risk', formatNumber(result.risk_score));
  const severity = document.getElementById('result-severity');
  severity.textContent = result.severity || '--';
  severity.className = `severity-${result.severity || 'LOW'}`;
  setText('result-action', result.recommended_action || '--');
  setText('result-threat', result.threat_class || '--');
  setText('result-latency', `${formatNumber(result.processing_latency_ms)} ms measured processing`);
  setText('signal-clone', percent(result.clone_probability));
  setText('signal-speaker', percent(result.speaker_match));
  setText('signal-liveness', percent(result.liveness));
  setText('signal-replay', percent(result.replay_score));
  setText('signal-quality', percent(result.quality_score));
  setText('signal-confidence', `${formatNumber(result.confidence)} signal strength`);

  const evidence = document.getElementById('result-evidence');
  clear(evidence);
  (result.evidence || []).forEach((item) => {
    const entry = document.createElement('li');
    const signal = document.createElement('strong');
    signal.textContent = `${item.signal}: `;
    entry.append(signal, document.createTextNode(item.interpretation));
    evidence.append(entry);
  });
  renderVerification(result);
}

function renderVerification(result) {
  const isRequired = ['HIGH', 'CRITICAL'].includes(result.severity);
  ui.verificationPanel.hidden = !isRequired;
  if (!isRequired) return;
  const requested = result.verification_status === 'REQUESTED';
  setText('verification-status', requested
    ? 'Verification requested. Secondary verification is required; no account, payment, or identity action was performed.'
    : 'Request a separate approved verification channel before a sensitive workflow can proceed. This is a safe prototype simulation only.');
  ui.verificationButton.disabled = requested;
  ui.verificationButton.textContent = requested ? 'Verification requested' : 'Request verification';
}

async function runSimulation(button) {
  const scenario = button.dataset.scenario;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Processing...';
  try {
    const response = await apiRequest('/simulate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario })
    });
    displayResult(response.result);
    persistAnalysisResult(response.result);
    navigate('simulation');
    await refreshDashboard();
  } catch (error) {
    const panel = document.getElementById('result-panel');
    panel.hidden = false;
    setText('result-source', 'Simulation error');
    setText('result-risk', '--');
    setText('result-severity', 'API unavailable');
    setText('result-action', error.message);
    setText('result-threat', 'No result');
    setText('result-latency', '--');
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function updateAlertStatus(alertId, select) {
  const nextStatus = select.value;
  select.disabled = true;
  setInlineStatus(ui.alertsStatus, `Saving ${alertId} as ${nextStatus}...`);
  try {
    const alert = await apiRequest(`/alerts/${encodeURIComponent(alertId)}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus })
    });
    persistAlert(alert);
    setInlineStatus(ui.alertsStatus, `${alertId} is now ${nextStatus}. The update was recorded in the API state and audit chain.`, 'success');
    await refreshDashboard();
  } catch (error) {
    setInlineStatus(ui.alertsStatus, `Status update failed: ${error.message}`, 'error');
    await refreshDashboard();
  } finally {
    select.disabled = false;
  }
}

async function requestStepUpVerification() {
  if (!latestResult?.analysis_id) return;
  const originalLabel = ui.verificationButton.textContent;
  ui.verificationButton.disabled = true;
  ui.verificationButton.textContent = 'Requesting...';
  try {
    const response = await apiRequest(`/analyses/${encodeURIComponent(latestResult.analysis_id)}/verification`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    latestResult.verification_status = response.verification_status;
    persistVerification(response.analysis_id, response.verification_status);
    renderVerification(latestResult);
    await refreshDashboard();
  } catch (error) {
    setText('verification-status', `Verification request could not be recorded: ${error.message}`);
    ui.verificationButton.disabled = false;
    ui.verificationButton.textContent = originalLabel;
  }
}

async function verifyLedger() {
  const originalLabel = ui.verifyLedgerButton.textContent;
  ui.verifyLedgerButton.disabled = true;
  ui.verifyLedgerButton.textContent = 'Verifying...';
  const status = document.getElementById('ledger-status');
  status.className = 'ledger-status checking';
  status.textContent = 'Verifying SHA-256 hash chain...';
  try {
    const ledger = await apiRequest('/ledger');
    storeAndRender(mergeSnapshots(readSnapshot() || lastSnapshot, { ledger }));
  } catch (error) {
    status.className = 'ledger-status invalid';
    status.textContent = `Ledger verification could not run: ${error.message}`;
  } finally {
    ui.verifyLedgerButton.disabled = false;
    ui.verifyLedgerButton.textContent = originalLabel;
  }
}

function assertWav(condition, message) {
  if (!condition) throw new Error(message);
}

function textAt(view, offset, length) {
  let output = '';
  for (let index = 0; index < length; index += 1) output += String.fromCharCode(view.getUint8(offset + index));
  return output;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function spectralFeatures(samples, sampleRate) {
  const size = 512;
  const usable = Math.min(size, samples.length);
  const start = Math.max(0, Math.floor((samples.length - usable) / 2));
  const powers = [];
  for (let bin = 0; bin <= usable / 2; bin += 1) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < usable; index += 1) {
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, usable - 1));
      const phase = (2 * Math.PI * bin * index) / usable;
      const sample = samples[start + index] * window;
      real += sample * Math.cos(phase);
      imaginary -= sample * Math.sin(phase);
    }
    powers.push(real * real + imaginary * imaginary);
  }
  const frequencyStep = sampleRate / usable;
  const total = powers.reduce((sum, value) => sum + value, 0) || 1;
  const centroid = powers.reduce((sum, power, index) => sum + power * index * frequencyStep, 0) / total;
  const bandwidth = Math.sqrt(powers.reduce((sum, power, index) => sum + power * ((index * frequencyStep - centroid) ** 2), 0) / total);
  const arithmetic = total / powers.length;
  const flatness = Math.exp(mean(powers.map((power) => Math.log(power + 1e-12)))) / (arithmetic + 1e-12);
  let cumulative = 0;
  let rolloff = sampleRate / 2;
  for (let index = 0; index < powers.length; index += 1) {
    cumulative += powers[index];
    if (cumulative >= total * 0.85) {
      rolloff = index * frequencyStep;
      break;
    }
  }
  const highFrequencyEnergy = powers.reduce((sum, power, index) => sum + (index * frequencyStep >= sampleRate * 0.32 ? power : 0), 0);
  return {
    spectral_centroid: Math.min(24000, centroid),
    spectral_bandwidth: Math.min(24000, bandwidth),
    spectral_flatness: Math.min(1, Math.max(0, flatness)),
    spectral_rolloff: Math.min(24000, rolloff),
    high_freq_ratio: Math.min(1, Math.max(0, highFrequencyEnergy / total))
  };
}

function extractFeatures(samples, sampleRate, duration) {
  let sumSquares = 0;
  let peak = 0;
  let clipping = 0;
  let crossings = 0;
  let silence = 0;
  let previous = samples[0];
  const windows = [];
  const windowCount = 10;
  const windowSize = Math.max(1, Math.floor(samples.length / windowCount));

  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    assertWav(Number.isFinite(value), 'The WAV contains non-finite sample data.');
    const magnitude = Math.abs(value);
    sumSquares += value * value;
    peak = Math.max(peak, magnitude);
    if (magnitude >= 0.99) clipping += 1;
    if (magnitude < 0.008) silence += 1;
    if ((value >= 0 && previous < 0) || (value < 0 && previous >= 0)) crossings += 1;
    previous = value;
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  const silenceRatio = silence / samples.length;
  assertWav(rms >= 0.003 && silenceRatio < 0.995, 'This WAV is silent or unusable. Please select audible speech-like audio.');

  for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
    const from = windowIndex * windowSize;
    const to = windowIndex === windowCount - 1 ? samples.length : Math.min(samples.length, from + windowSize);
    if (to - from < 2) continue;
    let windowSquares = 0;
    let windowCrossings = 0;
    let old = samples[from];
    for (let index = from; index < to; index += 1) {
      const value = samples[index];
      windowSquares += value * value;
      if ((value >= 0 && old < 0) || (value < 0 && old >= 0)) windowCrossings += 1;
      old = value;
    }
    windows.push({ rms: Math.sqrt(windowSquares / (to - from)), crossingRate: windowCrossings / (to - from) });
  }
  const windowEnergies = windows.map((window) => window.rms);
  const meanCrossingRate = mean(windows.map((window) => window.crossingRate));
  const crossingDeviation = Math.sqrt(mean(windows.map((window) => (window.crossingRate - meanCrossingRate) ** 2)));
  const dynamicRange = (Math.max(...windowEnergies) - Math.min(...windowEnergies)) / Math.max(...windowEnergies, 1e-7);
  const zeroCrossingRate = crossings / samples.length;
  const pitchProxy = Math.min(600, Math.max(0, zeroCrossingRate * sampleRate * 0.5));
  const pitchVariation = Math.min(1, crossingDeviation / Math.max(meanCrossingRate, 1e-7));
  const clippingRatio = clipping / samples.length;
  const qualityScore = Math.min(1, Math.max(0,
    0.25 + 0.65 * Math.min(1, rms / 0.07) - 0.55 * clippingRatio - 0.35 * silenceRatio
  ));

  return {
    duration_s: duration,
    rms,
    peak,
    clipping_ratio: clippingRatio,
    zero_crossing_rate: zeroCrossingRate,
    ...spectralFeatures(samples, sampleRate),
    dynamic_range: dynamicRange,
    pitch_proxy: pitchProxy,
    pitch_variation: pitchVariation,
    silence_ratio: silenceRatio,
    quality_score: qualityScore
  };
}

async function parsePcmWav(file) {
  assertWav(file && file.size > 0, 'Select a WAV file first.');
  assertWav(file.size <= MAX_WAV_BYTES, 'This file exceeds the 10 MB demonstration limit.');
  assertWav(/\.wav$/i.test(file.name) || /audio\/(wav|x-wav)/i.test(file.type), 'Only WAV files are supported.');
  const arrayBuffer = await file.arrayBuffer();
  const view = new DataView(arrayBuffer);
  assertWav(view.byteLength >= 44, 'This file is too small to be a valid WAV file.');
  assertWav(textAt(view, 0, 4) === 'RIFF' && textAt(view, 8, 4) === 'WAVE', 'Unsupported audio container. Expected a RIFF/WAVE file.');
  assertWav(view.getUint32(4, true) + 8 <= view.byteLength, 'The WAV RIFF header length is invalid.');

  let format = null;
  let dataOffset = -1;
  let dataLength = 0;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkName = textAt(view, offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const payloadOffset = offset + 8;
    assertWav(payloadOffset + chunkLength <= view.byteLength, 'The WAV contains a malformed data chunk.');
    if (chunkName === 'fmt ') {
      assertWav(chunkLength >= 16, 'The WAV format chunk is incomplete.');
      format = {
        audioFormat: view.getUint16(payloadOffset, true),
        channels: view.getUint16(payloadOffset + 2, true),
        sampleRate: view.getUint32(payloadOffset + 4, true),
        blockAlign: view.getUint16(payloadOffset + 12, true),
        bitsPerSample: view.getUint16(payloadOffset + 14, true)
      };
    } else if (chunkName === 'data') {
      dataOffset = payloadOffset;
      dataLength = chunkLength;
    }
    offset = payloadOffset + chunkLength + (chunkLength % 2);
  }

  assertWav(format, 'The WAV does not contain a format chunk.');
  assertWav(dataOffset >= 0 && dataLength > 0, 'The WAV does not contain audio sample data.');
  assertWav(format.audioFormat === 1, 'Only uncompressed PCM WAV is supported in this prototype.');
  assertWav(format.bitsPerSample === 16, 'Only 16-bit PCM WAV is supported in this prototype.');
  assertWav(format.channels === 1 || format.channels === 2, 'Only mono or stereo WAV is supported in this prototype.');
  assertWav(format.sampleRate >= 8000 && format.sampleRate <= 48000, 'Supported sample rates are 8 kHz through 48 kHz.');
  assertWav(format.blockAlign === format.channels * 2 && dataLength % format.blockAlign === 0, 'The PCM block alignment is invalid.');

  const frameCount = dataLength / format.blockAlign;
  const duration = frameCount / format.sampleRate;
  assertWav(duration >= MIN_DURATION_SECONDS, 'The audio is too short. Provide at least 0.25 seconds.');
  assertWav(duration <= MAX_DURATION_SECONDS, 'The audio is too long. The prototype accepts up to 60 seconds.');
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      sum += view.getInt16(dataOffset + frame * format.blockAlign + channel * 2, true) / 32768;
    }
    samples[frame] = sum / format.channels;
  }
  return extractFeatures(samples, format.sampleRate, duration);
}

async function handleAudioFile(file) {
  setInlineStatus(ui.uploadStatus, 'Validating and extracting browser-side PCM features...');
  try {
    const features = await parsePcmWav(file);
    setInlineStatus(ui.uploadStatus, 'Feature extraction complete. Sending derived numeric values to the API...');
    const result = await apiRequest('/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ features })
    });
    displayResult(result);
    persistAnalysisResult(result);
    navigate('simulation');
    setInlineStatus(ui.uploadStatus, 'Analysis complete. Raw audio was not sent to the API.', 'success');
    await refreshDashboard();
  } catch (error) {
    setInlineStatus(ui.uploadStatus, `Audio analysis could not start: ${error.message}`, 'error');
  } finally {
    ui.uploadInput.value = '';
  }
}

function bindEvents() {
  ui.navButtons.forEach((button) => button.addEventListener('click', () => navigate(button.dataset.target, true)));
  document.querySelectorAll('.nav-jump').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.target, true)));
  document.querySelector('.brand').addEventListener('click', (event) => { event.preventDefault(); navigate('dashboard', true); });
  document.querySelectorAll('.simulate-btn').forEach((button) => button.addEventListener('click', () => runSimulation(button)));
  ui.verificationButton.addEventListener('click', requestStepUpVerification);
  ui.verifyLedgerButton.addEventListener('click', verifyLedger);
  ui.uploadInput.addEventListener('change', () => handleAudioFile(ui.uploadInput.files?.[0]));
  ['dragenter', 'dragover'].forEach((eventName) => ui.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    ui.dropZone.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach((eventName) => ui.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    ui.dropZone.classList.remove('drag-over');
  }));
  ui.dropZone.addEventListener('drop', (event) => handleAudioFile(event.dataTransfer.files?.[0]));
}

function initialise() {
  bindEvents();
  renderSnapshot(readSnapshot());
  refreshDashboard();
  window.setInterval(refreshDashboard, 15000);
}

initialise();
