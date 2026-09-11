from __future__ import annotations

import io

import numpy as np
import pytest
from scipy.io import wavfile

from app.ledger import AuditLedger
from app.main import PersistenceError, RuntimeState
from app.scenarios import generate_scenario_wav


def _silent_wav() -> bytes:
    buffer = io.BytesIO()
    wavfile.write(buffer, 16_000, np.zeros(16_000, dtype=np.int16))
    return buffer.getvalue()


def test_api_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "online"


def test_real_wav_upload_has_structured_result(client):
    response = client.post(
        "/api/analyze",
        files={"file": ("synthetic_normal_demo.wav", generate_scenario_wav("NORMAL"), "audio/wav")},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["source"] == "UPLOAD"
    assert 0 <= result["risk_score"] <= 100
    assert result["processing_latency_ms"] >= 0
    assert set(result["model"]["feature_order"]) == set(result["features"]).intersection(result["model"]["feature_order"])


@pytest.mark.parametrize(
    "body, expected_status, message",
    [(b"not a wav file", 400, "Expected a RIFF/WAVE file"), (_silent_wav(), 400, "silent or too quiet")],
    ids=["malformed", "silent"],
)
def test_invalid_wav_is_rejected(client, body, expected_status, message):
    response = client.post("/api/analyze", files={"file": ("bad.wav", body, "audio/wav")})
    assert response.status_code == expected_status
    assert message in response.json()["detail"]


def test_upload_limits_and_declared_type_are_checked(client):
    oversized = b"RIFF" + b"\x00" * (5 * 1024 * 1024)
    response = client.post("/api/analyze", files={"file": ("oversized.wav", oversized, "audio/wav")})
    assert response.status_code == 413
    response = client.post("/api/analyze", files={"file": ("wrong.txt", generate_scenario_wav("NORMAL"), "text/plain")})
    assert response.status_code == 415


def test_all_scenarios_are_deterministic_and_distinguishable(client):
    observed = {}
    for scenario in ("NORMAL", "CLONED_VOICE", "REPLAY", "LOW_QUALITY", "MIXED_RISK"):
        response = client.post("/api/simulate", json={"scenario": scenario, "chunks": 1})
        assert response.status_code == 200
        observed[scenario] = response.json()["results"][0]
    repeat = client.post("/api/simulate", json={"scenario": "REPLAY", "chunks": 1}).json()["results"][0]
    assert observed["NORMAL"]["risk_score"] < 35
    assert observed["CLONED_VOICE"]["risk_score"] >= 65
    assert observed["REPLAY"]["risk_score"] >= 65
    assert observed["LOW_QUALITY"]["risk_score"] < 65
    assert observed["MIXED_RISK"]["risk_score"] >= 65
    assert observed["LOW_QUALITY"]["threat_class"] == "LOW AUDIO QUALITY / INCONCLUSIVE"
    assert observed["REPLAY"]["replay_score"] >= 0.60
    assert observed["REPLAY"]["risk_score"] == repeat["risk_score"]
    assert observed["REPLAY"]["features"] == repeat["features"]


def test_alert_creation_status_update_and_duplicate_suppression(client):
    first = client.post("/api/simulate", json={"scenario": "CLONED_VOICE", "chunks": 1}).json()["results"][0]
    assert first["alert_created"] is True
    update = client.post(f"/api/alerts/{first['alert_id']}/status", json={"status": "INVESTIGATING"})
    assert update.status_code == 200
    assert update.json()["status"] == "INVESTIGATING"
    duplicate = client.post("/api/simulate", json={"scenario": "CLONED_VOICE", "chunks": 1}).json()["results"][0]
    assert duplicate["alert_created"] is False
    assert duplicate["related_alert_id"] == first["alert_id"]
    assert len(client.get("/api/alerts").json()) == 1


def test_ledger_integrity_and_tampering():
    ledger = AuditLedger()
    ledger.append("TEST_EVENT", {"data": "test"})
    assert ledger.verify() is True
    ledger.items[0]["payload"] = "tampered"
    assert ledger.verify() is False


def test_state_persistence_is_atomic_and_test_isolated(tmp_path):
    path = tmp_path / "state.json"
    state = RuntimeState(path)
    state.ledger.append("TEST_EVENT", {"data": "test"})
    state.persist()
    restored = RuntimeState(path)
    assert restored.ledger.verify() is True
    assert len(restored.ledger.items) == 1
    assert not (tmp_path / "state.json.tmp").exists()


def test_corrupt_state_blocks_overwrite(tmp_path):
    path = tmp_path / "state.json"
    path.write_text("{invalid json", encoding="utf-8")
    state = RuntimeState(path)
    assert state.persistence_warning
    with pytest.raises(PersistenceError):
        state.persist()
    assert path.read_text(encoding="utf-8") == "{invalid json"
