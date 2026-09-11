const crypto = require('crypto');

// Demo state is intentionally process-local. Netlify can start a new function
// instance at any time, so this is not presented as durable audit storage.
const state = {
  alerts: [],
  analyses: [],
  ledger: []
};

const MAX_RETURNED_ITEMS = 100;
const ZERO_HASH = '0'.repeat(64);
const VALID_ALERT_STATUSES = new Set(['NEW', 'INVESTIGATING', 'RESOLVED']);
const FEATURE_BOUNDS = Object.freeze({
  duration_s: [0.25, 60],
  rms: [0.00001, 1],
  peak: [0.00001, 1],
  clipping_ratio: [0, 1],
  zero_crossing_rate: [0, 1],
  spectral_centroid: [0, 24000],
  spectral_bandwidth: [0, 24000],
  spectral_flatness: [0, 1],
  spectral_rolloff: [0, 24000],
  dynamic_range: [0, 1],
  pitch_proxy: [0, 600],
  pitch_variation: [0, 1],
  silence_ratio: [0, 1],
  high_freq_ratio: [0, 1],
  quality_score: [0, 1]
});

const PRESETS = Object.freeze({
  NORMAL: {
    description: 'Controlled synthetic/preset feature profile for pipeline testing.',
    clone_probability: 0.06,
    features: {
      duration_s: 2.5, rms: 0.15, peak: 0.61, clipping_ratio: 0.001,
      zero_crossing_rate: 0.10, spectral_centroid: 1200, spectral_bandwidth: 1500,
      spectral_flatness: 0.15, spectral_rolloff: 2500, dynamic_range: 0.70,
      pitch_proxy: 150, pitch_variation: 0.05, silence_ratio: 0.10,
      high_freq_ratio: 0.05, quality_score: 0.95
    }
  },
  CLONED_VOICE: {
    description: 'Controlled synthetic/preset feature profile for pipeline testing.',
    clone_probability: 0.86,
    features: {
      duration_s: 2.5, rms: 0.14, peak: 0.52, clipping_ratio: 0.002,
      zero_crossing_rate: 0.03, spectral_centroid: 1100, spectral_bandwidth: 1300,
      spectral_flatness: 0.03, spectral_rolloff: 2200, dynamic_range: 0.28,
      pitch_proxy: 235, pitch_variation: 0.01, silence_ratio: 0.05,
      high_freq_ratio: 0.01, quality_score: 0.90
    }
  },
  REPLAY: {
    description: 'Controlled synthetic/preset feature profile for pipeline testing.',
    clone_probability: 0.72,
    features: {
      duration_s: 2.5, rms: 0.10, peak: 0.48, clipping_ratio: 0.01,
      zero_crossing_rate: 0.04, spectral_centroid: 900, spectral_bandwidth: 1000,
      spectral_flatness: 0.04, spectral_rolloff: 1800, dynamic_range: 0.30,
      pitch_proxy: 245, pitch_variation: 0.01, silence_ratio: 0.15,
      high_freq_ratio: 0.002, quality_score: 0.70
    }
  },
  LOW_QUALITY: {
    description: 'Controlled synthetic/preset feature profile for pipeline testing. Low quality is an uncertainty signal, not fraud evidence.',
    clone_probability: 0.10,
    features: {
      duration_s: 2.5, rms: 0.02, peak: 0.12, clipping_ratio: 0.12,
      zero_crossing_rate: 0.30, spectral_centroid: 2500, spectral_bandwidth: 2200,
      spectral_flatness: 0.40, spectral_rolloff: 4000, dynamic_range: 0.20,
      pitch_proxy: 200, pitch_variation: 0.10, silence_ratio: 0.40,
      high_freq_ratio: 0.30, quality_score: 0.20
    }
  },
  MIXED_RISK: {
    description: 'Controlled synthetic/preset feature profile for pipeline testing.',
    clone_probability: 0.95,
    features: {
      duration_s: 2.5, rms: 0.08, peak: 0.44, clipping_ratio: 0.03,
      zero_crossing_rate: 0.02, spectral_centroid: 820, spectral_bandwidth: 950,
      spectral_flatness: 0.02, spectral_rolloff: 1600, dynamic_range: 0.25,
      pitch_proxy: 300, pitch_variation: 0.00, silence_ratio: 0.10,
      high_freq_ratio: 0.001, quality_score: 0.15
    }
  }
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value, places = 3) {
  return Number(value.toFixed(places));
}

function newId(prefix) {
  const suffix = crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
    : crypto.randomBytes(6).toString('hex').toUpperCase();
  return `${prefix}-${suffix}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function appendLedger(event_type, payload) {
  const entry = {
    index: state.ledger.length,
    event_id: newId('EVT'),
    timestamp: new Date().toISOString(),
    event_type,
    payload,
    previous_hash: state.ledger.length ? state.ledger[state.ledger.length - 1].hash : ZERO_HASH
  };
  entry.hash = sha256(canonicalJson(entry));
  state.ledger.push(entry);
  return entry;
}

function verifyLedger() {
  let previousHash = ZERO_HASH;
  for (let index = 0; index < state.ledger.length; index += 1) {
    const entry = state.ledger[index];
    if (entry.index !== index || entry.previous_hash !== previousHash) return false;
    const expected = sha256(canonicalJson({
      index: entry.index,
      event_id: entry.event_id,
      timestamp: entry.timestamp,
      event_type: entry.event_type,
      payload: entry.payload,
      previous_hash: entry.previous_hash
    }));
    if (expected !== entry.hash) return false;
    previousHash = entry.hash;
  }
  return true;
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normaliseFeatures(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw validationError('features must be a JSON object.');
  }

  const unexpected = Object.keys(candidate).filter((key) => !Object.prototype.hasOwnProperty.call(FEATURE_BOUNDS, key));
  if (unexpected.length) throw validationError(`Unsupported feature field: ${unexpected[0]}.`);

  const features = {};
  for (const [name, bounds] of Object.entries(FEATURE_BOUNDS)) {
    if (!Object.prototype.hasOwnProperty.call(candidate, name)) {
      throw validationError(`Missing required feature: ${name}.`);
    }
    const value = Number(candidate[name]);
    if (!Number.isFinite(value)) throw validationError(`${name} must be a finite number.`);
    if (value < bounds[0] || value > bounds[1]) {
      throw validationError(`${name} is outside the supported range.`);
    }
    features[name] = rounded(value, 6);
  }
  return features;
}

function uploadSuspicionSignals(features) {
  const signals = [];
  // Each signal requires a pair of related measurements so a single unusual
  // acoustic characteristic cannot be interpreted as synthetic or replayed
  // speech. The groups are then fused independently for uploaded audio.
  if (features.spectral_flatness < 0.055 && features.zero_crossing_rate < 0.045) {
    signals.push('SPECTRAL_REGULARITY');
  }
  if (features.dynamic_range < 0.32 && features.pitch_variation < 0.018) {
    signals.push('LIMITED_TEMPORAL_VARIATION');
  }
  if (features.high_freq_ratio < 0.015 && features.spectral_rolloff <= 1800) {
    signals.push('REPLAY_ORIENTED_PATTERN');
  }
  return signals;
}

function deriveSignals(features, conservativeUpload = false) {
  const speaker_match = clamp(
    0.86
      - Math.abs(features.pitch_proxy - 175) / 170
      - Math.max(0, 0.055 - features.pitch_variation) * 1.8
  );
  const liveness = clamp(
    0.93
      - Math.max(0, 0.065 - features.pitch_variation) * 6.7
      - Math.max(0, 0.42 - features.dynamic_range) * 0.6
      - 0.25 * (1 - features.quality_score)
      - 0.15 * features.silence_ratio
  );
  const suspicious_signals = conservativeUpload ? uploadSuspicionSignals(features) : [];
  const replay_score = conservativeUpload
    ? clamp(0.05 + suspicious_signals.length * 0.25)
    : clamp(
      0.05
        + (features.spectral_flatness < 0.08 ? 0.32 : 0)
        + (features.dynamic_range < 0.38 ? 0.24 : 0)
        + (features.pitch_variation < 0.03 ? 0.20 : 0)
        + (features.high_freq_ratio < 0.015 ? 0.15 : 0)
        + (features.clipping_ratio > 0.08 ? 0.08 : 0)
    );
  return {
    speaker_match: rounded(speaker_match),
    liveness: rounded(liveness),
    replay_score: rounded(replay_score),
    quality_score: rounded(features.quality_score),
    suspicious_signals
  };
}

function predictCloneProbability(features, presetProbability) {
  if (typeof presetProbability === 'number') return rounded(clamp(presetProbability), 4);
  return 0.06;
}

function predictUploadCloneProbability(suspiciousSignals) {
  const hasClonePattern = suspiciousSignals.includes('SPECTRAL_REGULARITY');
  if (!hasClonePattern) return rounded(0.06 + suspiciousSignals.length * 0.07, 4);
  return rounded(0.35 + suspiciousSignals.length * 0.15, 4);
}

function calculateSimulationRisk(clone_probability, signals) {
  const risk_score = rounded(clamp(100 * (
    0.50 * clone_probability
    + 0.22 * (1 - signals.speaker_match)
    + 0.20 * (1 - signals.liveness)
    + 0.08 * signals.replay_score
  ), 0, 100), 1);

  const severity = risk_score >= 85 ? 'CRITICAL'
    : risk_score >= 65 ? 'HIGH'
      : risk_score >= 35 ? 'MEDIUM' : 'LOW';
  const confidence = rounded(100 * Math.max(
    clone_probability,
    1 - signals.speaker_match,
    1 - signals.liveness,
    signals.replay_score
  ), 1);
  return { risk_score, severity, confidence };
}

function calculateUploadRisk(signals) {
  // This is an explicit decision table, not a weighted accumulation. It does
  // not reference speaker_match, liveness, or a claimed speaker identity.
  const groups = signals.suspicious_signals.length;
  if (groups >= 3) return { risk_score: 88, severity: 'CRITICAL', confidence: 90 };
  if (groups === 2) return { risk_score: 70, severity: 'HIGH', confidence: 75 };
  if (groups === 1) return { risk_score: 32, severity: 'LOW', confidence: 45 };
  return { risk_score: 8, severity: 'LOW', confidence: 20 };
}

function classifyThreat(clone_probability, signals, risk_score, conservativeUpload = false) {
  if (conservativeUpload) {
    if (signals.quality_score < 0.45 && signals.suspicious_signals.length < 2) {
      return 'LOW AUDIO QUALITY / INCONCLUSIVE';
    }
    if (signals.suspicious_signals.length >= 2) return 'MULTIPLE SUSPICIOUS SIGNALS';
    if (signals.suspicious_signals.length) return 'CONTEXTUAL REVIEW REQUIRED';
    return 'LIMITED SUSPICIOUS EVIDENCE';
  }
  if (signals.quality_score < 0.45 && clone_probability < 0.50 && signals.replay_score < 0.60) {
    return 'LOW AUDIO QUALITY / INCONCLUSIVE';
  }
  if (clone_probability >= 0.65 && signals.replay_score >= 0.60) return 'MULTIPLE SUSPICIOUS SIGNALS';
  if (signals.replay_score >= 0.60) return 'POTENTIAL REPLAY / IMPERSONATION';
  if (clone_probability >= 0.65) return 'POTENTIAL SYNTHETIC / CLONED VOICE';
  return risk_score >= 35 ? 'CONTEXTUAL REVIEW REQUIRED' : 'LIMITED SUSPICIOUS EVIDENCE';
}

function recommendedAction(severity) {
  if (severity === 'HIGH' || severity === 'CRITICAL') return 'REQUIRE STEP-UP VERIFICATION';
  if (severity === 'MEDIUM') return 'CONTEXTUAL REVIEW';
  return 'CONTINUE MONITORED WORKFLOW';
}

function explain(features, clone_probability, signals, conservativeUpload = false) {
  if (conservativeUpload) {
    const evidence = [];
    const explanations = {
      SPECTRAL_REGULARITY: 'Low spectral flatness and low zero-crossing activity formed one spectral regularity pattern.',
      LIMITED_TEMPORAL_VARIATION: 'Low dynamic range and limited pitch variation formed one temporal variation pattern.',
      REPLAY_ORIENTED_PATTERN: 'Low high-frequency energy and spectral rolloff formed one replay-oriented bandwidth pattern.'
    };
    signals.suspicious_signals.forEach((signal) => evidence.push({
      signal: signal.replaceAll('_', ' '),
      value: 'combined acoustic pattern',
      interpretation: explanations[signal]
    }));
    if (signals.quality_score < 0.45) {
      evidence.push({
        signal: 'Audio quality', value: signals.quality_score,
        interpretation: 'The signal is unreliable for a confident decision. Low quality alone is not fraud evidence.'
      });
    }
    if (!evidence.length) {
      evidence.push({
        signal: 'Risk fusion', value: 'limited',
        interpretation: 'No independent acoustic pattern group met the conservative demonstration review threshold.'
      });
    }
    return evidence;
  }
  const evidence = [];
  if (clone_probability >= 0.65) {
    evidence.push({
      signal: 'Clone probability', value: clone_probability,
      interpretation: 'Strong synthetic-voice indicators in the Demonstration ML Baseline.'
    });
  }
  if (signals.speaker_match < 0.55) {
    evidence.push({
      signal: 'Speaker-match signal', value: signals.speaker_match,
      interpretation: 'The acoustic profile deviates from the demo reference. This is a risk signal, not biometric identity proof.'
    });
  }
  if (signals.liveness < 0.55) {
    evidence.push({
      signal: 'Passive liveness signal', value: signals.liveness,
      interpretation: 'Limited natural acoustic variation was observed; stronger verification is recommended.'
    });
  }
  if (signals.replay_score >= 0.60) {
    evidence.push({
      signal: 'Replay signal', value: signals.replay_score,
      interpretation: 'Replay-oriented timing, spectral, or bandwidth indicators exceeded this demo threshold.'
    });
  }
  if (signals.quality_score < 0.45) {
    evidence.push({
      signal: 'Audio quality', value: signals.quality_score,
      interpretation: 'The signal is unreliable for a confident decision. Low quality alone is not fraud evidence.'
    });
  }
  if (!evidence.length) {
    evidence.push({
      signal: 'Risk fusion', value: 'limited',
      interpretation: 'No configured demonstration indicator exceeded its review threshold.'
    });
  }
  return evidence;
}

function processFeatures(features, source, startedAt, presetProbability) {
  const conservativeUpload = source === 'WAV_UPLOAD';
  const signals = deriveSignals(features, conservativeUpload);
  const clone_probability = conservativeUpload
    ? predictUploadCloneProbability(signals.suspicious_signals)
    : predictCloneProbability(features, presetProbability);
  const scoring = conservativeUpload
    ? calculateUploadRisk(signals)
    : calculateSimulationRisk(clone_probability, signals);
  const analysis = {
    analysis_id: newId('ANL'),
    timestamp: new Date().toISOString(),
    source,
    features,
    model: {
      name: 'Deterministic Feature-Based Demonstration Classifier',
      version: '1.1.0-js-demo',
      disclaimer: 'This prototype is not a production-validated anti-spoofing model.'
    },
    clone_probability,
    speaker_match: signals.speaker_match,
    liveness: signals.liveness,
    replay_score: signals.replay_score,
    quality_score: signals.quality_score,
    ...scoring,
    threat_class: classifyThreat(clone_probability, signals, scoring.risk_score, conservativeUpload),
    evidence: explain(features, clone_probability, signals, conservativeUpload),
    recommended_action: recommendedAction(scoring.severity),
    verification_status: scoring.severity === 'HIGH' || scoring.severity === 'CRITICAL' ? 'NOT_REQUESTED' : 'NOT_REQUIRED',
    processing_latency_ms: rounded(Math.max(0, performance.now() - startedAt), 2),
    alert_created: false
  };

  state.analyses.push(analysis);
  appendLedger('ANALYSIS_COMPLETED', {
    analysis_id: analysis.analysis_id,
    source: analysis.source,
    risk_score: analysis.risk_score,
    severity: analysis.severity
  });

  if (analysis.severity === 'HIGH' || analysis.severity === 'CRITICAL') {
    const alert = {
      alert_id: newId('ALT'),
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
    state.alerts.push(alert);
    analysis.alert_created = true;
    analysis.alert_id = alert.alert_id;
    appendLedger('ALERT_CREATED', {
      alert_id: alert.alert_id,
      analysis_id: analysis.analysis_id,
      severity: alert.severity,
      risk_score: alert.risk_score
    });
  }
  return analysis;
}

function getStats() {
  const total = state.analyses.length;
  const highRisk = state.analyses.filter((item) => item.severity === 'HIGH' || item.severity === 'CRITICAL').length;
  const critical = state.analyses.filter((item) => item.severity === 'CRITICAL').length;
  const averageRisk = total
    ? rounded(state.analyses.reduce((sum, item) => sum + item.risk_score, 0) / total, 1)
    : null;
  const averageLatency = total
    ? rounded(state.analyses.reduce((sum, item) => sum + item.processing_latency_ms, 0) / total, 2)
    : null;
  const severity_distribution = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].reduce((distribution, severity) => {
    distribution[severity] = state.analyses.filter((item) => item.severity === severity).length;
    return distribution;
  }, {});
  const threat_distribution = state.analyses.reduce((distribution, item) => {
    distribution[item.threat_class] = (distribution[item.threat_class] || 0) + 1;
    return distribution;
  }, {});
  return {
    total_analyses: total,
    high_risk_events: highRisk,
    critical_events: critical,
    total_alerts: state.alerts.length,
    average_risk: averageRisk,
    average_processing_latency_ms: averageLatency,
    severity_distribution,
    risk_distribution: severity_distribution,
    threat_distribution,
    ledger_valid: verifyLedger(),
    persistence: 'ephemeral_function_memory',
    demo_data: true
  };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  };
}

function response(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

function routeFor(event) {
  let path = String(event.path || '/').split('?')[0];
  path = path.replace(/^\/.netlify\/functions\/api/, '');
  path = path.replace(/^\/api/, '');
  return path || '/';
}

function parseRequestBody(event) {
  if ((event.body || '').length > 50000) throw validationError('Request body is too large.');
  try {
    const body = JSON.parse(event.body || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return body;
  } catch (error) {
    throw validationError('Request body must be valid JSON.');
  }
}

exports.handler = async (event) => {
  const method = event.httpMethod || 'GET';
  const path = routeFor(event);
  if (method === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };

  try {
    if (method === 'GET' && path === '/health') {
      return response(200, {
        status: 'online',
        api: 'netlify-function',
        storage: 'ephemeral demo memory',
        raw_audio_retention: 'disabled by this client flow',
        outbound_actions: 'disabled'
      });
    }
    if (method === 'GET' && path === '/stats') return response(200, getStats());
    if (method === 'GET' && path === '/alerts') return response(200, state.alerts.slice(-MAX_RETURNED_ITEMS).reverse());
    if (method === 'GET' && path === '/analyses') return response(200, state.analyses.slice(-MAX_RETURNED_ITEMS).reverse());
    if (method === 'GET' && path === '/ledger') {
      return response(200, {
        valid: verifyLedger(),
        algorithm: 'SHA-256',
        serialization: 'canonical JSON with recursively sorted object keys',
        persistence: 'ephemeral function memory',
        items: state.ledger.slice(-MAX_RETURNED_ITEMS).reverse()
      });
    }
    if (method === 'POST' && path === '/simulate') {
      const body = parseRequestBody(event);
      const scenario = String(body.scenario || '').trim().toUpperCase();
      const preset = PRESETS[scenario];
      if (!preset) throw validationError('scenario must be NORMAL, CLONED_VOICE, REPLAY, LOW_QUALITY, or MIXED_RISK.');
      const startedAt = performance.now();
      const result = processFeatures({ ...preset.features }, `SIMULATION:${scenario}`, startedAt, preset.clone_probability);
      return response(200, { scenario, description: preset.description, result });
    }
    if (method === 'POST' && path === '/analyze') {
      const body = parseRequestBody(event);
      const features = normaliseFeatures(body.features);
      const result = processFeatures(features, 'WAV_UPLOAD', performance.now());
      return response(200, result);
    }
    if (method === 'POST' && /^\/analyses\/[^/]+\/verification$/.test(path)) {
      const analysisId = decodeURIComponent(path.split('/')[2]);
      const analysis = state.analyses.find((item) => item.analysis_id === analysisId);
      if (!analysis) return response(404, { detail: 'Analysis not found.' });
      if (!['HIGH', 'CRITICAL'].includes(analysis.severity)) {
        return response(409, { detail: 'Step-up verification is only required for HIGH or CRITICAL prototype risk.' });
      }
      if (analysis.verification_status !== 'REQUESTED') {
        analysis.verification_status = 'REQUESTED';
        analysis.verification_requested_at = new Date().toISOString();
        const alert = state.alerts.find((item) => item.analysis_id === analysisId);
        if (alert) alert.verification_status = 'REQUESTED';
        appendLedger('STEP_UP_VERIFICATION_REQUESTED', {
          analysis_id: analysisId,
          alert_id: alert?.alert_id || null,
          risk_score: analysis.risk_score,
          severity: analysis.severity
        });
      }
      return response(200, {
        analysis_id: analysisId,
        verification_status: analysis.verification_status,
        message: 'Verification requested. A separate approved verification channel is required; no sensitive action was performed.'
      });
    }
    if (method === 'POST' && /^\/alerts\/[^/]+\/status$/.test(path)) {
      const alertId = decodeURIComponent(path.split('/')[2]);
      const body = parseRequestBody(event);
      const status = String(body.status || '').trim().toUpperCase();
      if (!VALID_ALERT_STATUSES.has(status)) throw validationError('status must be NEW, INVESTIGATING, or RESOLVED.');
      const alert = state.alerts.find((item) => item.alert_id === alertId);
      if (!alert) return response(404, { detail: 'Alert not found.' });
      if (alert.status !== status) {
        alert.status = status;
        appendLedger('ALERT_STATUS_CHANGED', { alert_id: alertId, status });
      }
      return response(200, alert);
    }
    return response(404, { detail: 'Route not found.' });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error('VoiceShield API error:', error);
    return response(statusCode, { detail: statusCode === 500 ? 'Internal server error.' : error.message });
  }
};
