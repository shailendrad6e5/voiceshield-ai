const test = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/api');

function request(method, path, body) {
  return handler({
    httpMethod: method,
    path,
    body: body === undefined ? null : JSON.stringify(body)
  });
}

async function json(method, path, body) {
  const response = await request(method, path, body);
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}

const validUploadFeatures = {
  duration_s: 2.5,
  rms: 0.15,
  peak: 0.61,
  clipping_ratio: 0.001,
  zero_crossing_rate: 0.1,
  spectral_centroid: 1200,
  spectral_bandwidth: 1500,
  spectral_flatness: 0.15,
  spectral_rolloff: 2500,
  dynamic_range: 0.7,
  pitch_proxy: 150,
  pitch_variation: 0.05,
  silence_ratio: 0.1,
  high_freq_ratio: 0.05,
  quality_score: 0.95
};

test('VoiceShield API provides a deterministic, explainable demo pipeline', async () => {
  const health = await json('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'online');

  const expected = {
    NORMAL: 'LOW',
    CLONED_VOICE: 'HIGH',
    REPLAY: 'HIGH',
    LOW_QUALITY: 'LOW',
    MIXED_RISK: 'CRITICAL'
  };

  const scenarioResults = {};
  for (const [scenario, severity] of Object.entries(expected)) {
    const response = await json('POST', '/api/simulate', { scenario });
    assert.equal(response.status, 200, scenario);
    assert.equal(response.body.scenario, scenario);
    assert.equal(response.body.result.severity, severity, scenario);
    assert.ok(Number.isFinite(response.body.result.risk_score), scenario);
    assert.ok(response.body.result.risk_score >= 0 && response.body.result.risk_score <= 100, scenario);
    assert.ok(response.body.result.evidence.length > 0, scenario);
    scenarioResults[scenario] = response.body.result;
  }

  assert.equal(scenarioResults.NORMAL.alert_created, false);
  assert.equal(scenarioResults.LOW_QUALITY.threat_class, 'LOW AUDIO QUALITY / INCONCLUSIVE');
  assert.equal(scenarioResults.MIXED_RISK.recommended_action, 'REQUIRE STEP-UP VERIFICATION');
  assert.equal(scenarioResults.MIXED_RISK.verification_status, 'NOT_REQUESTED');

  const analyses = await json('GET', '/api/analyses');
  assert.equal(analyses.status, 200);
  assert.equal(analyses.body.length, 5);

  const alerts = await json('GET', '/api/alerts');
  assert.equal(alerts.status, 200);
  assert.equal(alerts.body.length, 3);
  assert.ok(alerts.body.every((alert) => ['HIGH', 'CRITICAL'].includes(alert.severity)));

  const statusUpdate = await json('POST', `/api/alerts/${alerts.body[0].alert_id}/status`, { status: 'INVESTIGATING' });
  assert.equal(statusUpdate.status, 200);
  assert.equal(statusUpdate.body.status, 'INVESTIGATING');

  const verification = await json('POST', `/api/analyses/${scenarioResults.MIXED_RISK.analysis_id}/verification`, {});
  assert.equal(verification.status, 200);
  assert.equal(verification.body.verification_status, 'REQUESTED');

  const lowVerification = await json('POST', `/api/analyses/${scenarioResults.NORMAL.analysis_id}/verification`, {});
  assert.equal(lowVerification.status, 409);

  const upload = await json('POST', '/api/analyze', { features: validUploadFeatures });
  assert.equal(upload.status, 200);
  assert.equal(upload.body.source, 'WAV_UPLOAD');
  assert.equal(upload.body.model.name, 'Deterministic Feature-Based Demonstration Classifier');
  assert.equal(upload.body.severity, 'LOW');
  assert.equal(upload.body.threat_class, 'LIMITED SUSPICIOUS EVIDENCE');

  const singlePatternUpload = await json('POST', '/api/analyze', {
    features: { ...validUploadFeatures, spectral_flatness: 0.04, zero_crossing_rate: 0.03 }
  });
  assert.equal(singlePatternUpload.status, 200);
  assert.equal(singlePatternUpload.body.severity, 'LOW');
  assert.equal(singlePatternUpload.body.threat_class, 'CONTEXTUAL REVIEW REQUIRED');

  const multiPatternUpload = await json('POST', '/api/analyze', {
    features: {
      ...validUploadFeatures,
      spectral_flatness: 0.03,
      zero_crossing_rate: 0.03,
      dynamic_range: 0.25,
      pitch_variation: 0.01,
      high_freq_ratio: 0.005,
      spectral_rolloff: 1400
    }
  });
  assert.equal(multiPatternUpload.status, 200);
  assert.equal(multiPatternUpload.body.severity, 'HIGH');
  assert.equal(multiPatternUpload.body.threat_class, 'MULTIPLE SUSPICIOUS SIGNALS');
  assert.equal(multiPatternUpload.body.evidence.length, 3);

  const lowQualityUpload = await json('POST', '/api/analyze', {
    features: { ...validUploadFeatures, clipping_ratio: 0.12, silence_ratio: 0.4, quality_score: 0.2 }
  });
  assert.equal(lowQualityUpload.status, 200);
  assert.equal(lowQualityUpload.body.severity, 'LOW');
  assert.equal(lowQualityUpload.body.threat_class, 'LOW AUDIO QUALITY / INCONCLUSIVE');

  const malformed = await json('POST', '/api/analyze', { features: { rms: 'not-a-number' } });
  assert.equal(malformed.status, 400);
  assert.match(malformed.body.detail, /Missing required feature/);

  const invalidStatus = await json('POST', `/api/alerts/${alerts.body[0].alert_id}/status`, { status: 'BLOCKED' });
  assert.equal(invalidStatus.status, 400);

  const stats = await json('GET', '/api/stats');
  assert.equal(stats.status, 200);
  assert.equal(stats.body.total_analyses, 9);
  assert.equal(stats.body.high_risk_events, 4);
  assert.equal(stats.body.critical_events, 1);
  assert.equal(stats.body.threat_distribution['LOW AUDIO QUALITY / INCONCLUSIVE'], 2);

  const ledger = await json('GET', '/api/ledger');
  assert.equal(ledger.status, 200);
  assert.equal(ledger.body.valid, true);
  assert.ok(ledger.body.items.some((item) => item.event_type === 'STEP_UP_VERIFICATION_REQUESTED'));
  assert.ok(ledger.body.items.length >= 11);
});
