"""FastAPI application for the current local VoiceShield AI prototype."""

from __future__ import annotations

import copy
import hashlib
import json
import logging
import os
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .features import AudioValidationError, extract_features
from .ledger import AuditLedger
from .ml_engine import predict
from .risk import classify_threat, derive_heuristics, evidence, prevention_action, score
from .scenarios import generate_scenario_wav


LOGGER = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "data" / "db.json"
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_RETURNED_ITEMS = 100
DUPLICATE_ALERT_WINDOW_S = 30.0
ALLOWED_WAV_CONTENT_TYPES = {"audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"}


class ScenarioRequest(BaseModel):
    scenario: Literal["NORMAL", "CLONED_VOICE", "REPLAY", "LOW_QUALITY", "MIXED_RISK"] = "NORMAL"
    chunks: int = Field(default=1, ge=1, le=100)


class StatusUpdate(BaseModel):
    status: Literal["NEW", "INVESTIGATING", "RESOLVED"]


class PersistenceError(RuntimeError):
    """Raised when a mutation cannot be made durable safely."""


class RuntimeState:
    """Small, locked JSON state store for the prototype's alerts and hash chain."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.lock = threading.RLock()
        self.alerts: list[dict] = []
        self.analyses: list[dict] = []
        self.ledger = AuditLedger()
        self.persistence_warning: str | None = None
        self.write_blocked = False
        self._load()

    def _load(self) -> None:
        if not self.db_path.exists():
            return
        try:
            with self.db_path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            if not isinstance(payload, dict):
                raise ValueError("database root must be an object")
            alerts = payload.get("alerts", [])
            analyses = payload.get("analyses", [])
            ledger_items = payload.get("ledger_items", [])
            if not all(isinstance(value, list) for value in (alerts, analyses, ledger_items)):
                raise ValueError("database collections must be arrays")
            self.alerts = alerts
            self.analyses = analyses
            self.ledger.items = ledger_items
            if not self.ledger.verify():
                self.persistence_warning = "Stored audit ledger failed integrity verification. No records were discarded."
                self.write_blocked = True
        except (OSError, json.JSONDecodeError, ValueError, KeyError, TypeError) as exc:
            self.persistence_warning = "Stored demo state could not be read; the service started with empty in-memory state."
            self.write_blocked = True
            LOGGER.warning("Unable to load demo state from %s: %s", self.db_path, exc)

    def _payload(self) -> dict:
        return {
            "schema_version": 1,
            "alerts": self.alerts,
            "analyses": self.analyses,
            "ledger_items": self.ledger.items,
        }

    def persist(self) -> None:
        """Atomically replace the state file after serializing an entire snapshot."""
        if self.write_blocked:
            raise PersistenceError("Stored state needs operator review before it can be overwritten")
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        temp_name: str | None = None
        try:
            descriptor, temp_name = tempfile.mkstemp(prefix=f".{self.db_path.name}.", suffix=".tmp", dir=self.db_path.parent)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(self._payload(), handle, ensure_ascii=False, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, self.db_path)
            self.persistence_warning = None
        except (OSError, TypeError, ValueError) as exc:
            raise PersistenceError("Could not persist the prototype audit state") from exc
        finally:
            if temp_name:
                try:
                    Path(temp_name).unlink(missing_ok=True)
                except OSError:
                    pass


def configured_db_path() -> Path:
    override = os.getenv("VOICESHIELD_DB_PATH")
    return Path(override) if override else DEFAULT_DB_PATH


def _fingerprint(features: dict[str, float], source: str) -> str:
    body = json.dumps({"source": source, "features": features}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _is_recent_duplicate(state: RuntimeState, fingerprint: str, now: float) -> str | None:
    for alert in reversed(state.alerts):
        if alert.get("fingerprint") == fingerprint and now - float(alert.get("timestamp", 0)) <= DUPLICATE_ALERT_WINDOW_S:
            return str(alert["alert_id"])
    return None


def process_features(state: RuntimeState, features: dict[str, float], source: str, latency_ms: float) -> dict:
    """Run the detector and atomically record one completed analysis."""
    model = predict(features)
    clone_probability = float(model["clone_probability"])
    heuristics = derive_heuristics(features)
    risk_score, severity, confidence = score(
        clone_probability,
        heuristics["speaker_match"],
        heuristics["liveness"],
        heuristics["replay_score"],
    )
    now = time.time()
    result = {
        "analysis_id": str(uuid.uuid4()),
        "timestamp": now,
        "source": source,
        "features": features,
        "model": model,
        "speaker_match": round(heuristics["speaker_match"], 3),
        "liveness": round(heuristics["liveness"], 3),
        "replay_score": round(heuristics["replay_score"], 3),
        "quality_score": round(heuristics["quality_score"], 3),
        "risk_score": risk_score,
        "severity": severity,
        "confidence": confidence,
        "threat_class": classify_threat(clone_probability, heuristics["replay_score"], heuristics["quality_score"], risk_score),
        "evidence": evidence(features, clone_probability, heuristics),
        "prevention_action": prevention_action(severity),
        "processing_latency_ms": round(latency_ms, 2),
        "alert_created": False,
    }

    with state.lock:
        counts = (len(state.alerts), len(state.analyses), len(state.ledger.items))
        try:
            state.analyses.append(result)
            if severity in {"HIGH", "CRITICAL"}:
                fingerprint = _fingerprint(features, source)
                duplicate_id = _is_recent_duplicate(state, fingerprint, now)
                if duplicate_id:
                    result["related_alert_id"] = duplicate_id
                    state.ledger.append("ALERT_SUPPRESSED_DUPLICATE", {"analysis_id": result["analysis_id"], "alert_id": duplicate_id})
                else:
                    alert_id = f"ALT-{uuid.uuid4().hex[:10].upper()}"
                    result["alert_id"] = alert_id
                    result["alert_created"] = True
                    alert = {"alert_id": alert_id, "status": "NEW", "fingerprint": fingerprint, **result}
                    state.alerts.append(alert)
                    state.ledger.append("ALERT_CREATED", {"alert_id": alert["alert_id"], "risk_score": risk_score, "severity": severity})
            state.ledger.append("ANALYSIS_COMPLETED", {"analysis_id": result["analysis_id"], "risk_score": risk_score, "source": source})
            state.persist()
        except (PersistenceError, OSError, TypeError, ValueError) as exc:
            del state.alerts[counts[0] :]
            del state.analyses[counts[1] :]
            del state.ledger.items[counts[2] :]
            LOGGER.error("Analysis persistence failed: %s", exc)
            raise HTTPException(status_code=503, detail="Analysis could not be recorded safely. Please retry.") from exc
    return result


def _state(request: Request) -> RuntimeState:
    return request.app.state.runtime


def create_app(db_path: Path | None = None) -> FastAPI:
    app = FastAPI(title="VoiceShield AI API", version="0.2.0-demo")
    app.state.runtime = RuntimeState(db_path or configured_db_path())
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://localhost:4173"],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.get("/api/health")
    def health(request: Request) -> dict:
        state = _state(request)
        return {"status": "degraded" if state.persistence_warning else "online", "ingest": "READ-ONLY AUDIO INGEST", "outbound_actions": "DISABLED", "persistence_warning": state.persistence_warning}

    @app.get("/api/alerts")
    def get_alerts(request: Request) -> list[dict]:
        state = _state(request)
        with state.lock:
            return copy.deepcopy(list(reversed(state.alerts[-MAX_RETURNED_ITEMS:])))

    @app.get("/api/analyses")
    def get_analyses(request: Request) -> list[dict]:
        state = _state(request)
        with state.lock:
            return copy.deepcopy(list(reversed(state.analyses[-MAX_RETURNED_ITEMS:])))

    @app.get("/api/ledger")
    def get_ledger(request: Request) -> dict:
        state = _state(request)
        with state.lock:
            return {"valid": state.ledger.verify(), "items": copy.deepcopy(list(reversed(state.ledger.items[-MAX_RETURNED_ITEMS:]))) }

    @app.post("/api/alerts/{alert_id}/status")
    def update_status(alert_id: str, body: StatusUpdate, request: Request) -> dict:
        state = _state(request)
        with state.lock:
            for alert in state.alerts:
                if alert["alert_id"] == alert_id:
                    if alert["status"] != body.status:
                        original_status = alert["status"]
                        ledger_count = len(state.ledger.items)
                        try:
                            alert["status"] = body.status
                            state.ledger.append("ALERT_STATUS_CHANGED", {"alert_id": alert_id, "status": body.status})
                            state.persist()
                        except (PersistenceError, OSError, TypeError, ValueError) as exc:
                            alert["status"] = original_status
                            del state.ledger.items[ledger_count:]
                            LOGGER.error("Alert-status persistence failed: %s", exc)
                            raise HTTPException(status_code=503, detail="Alert status could not be recorded safely. Please retry.") from exc
                    return copy.deepcopy(alert)
        raise HTTPException(status_code=404, detail="Alert not found")

    @app.post("/api/analyze")
    async def analyze(request: Request, file: UploadFile = File(...)) -> dict:
        if file.content_type and file.content_type.lower() not in ALLOWED_WAV_CONTENT_TYPES:
            raise HTTPException(status_code=415, detail="Content-Type must identify a WAV file")
        started = time.perf_counter()
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File too large. Limit is 5 MiB.")
        try:
            features = extract_features(data)
        except AudioValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            LOGGER.warning("Unexpected WAV-processing failure: %s", exc)
            raise HTTPException(status_code=400, detail="WAV analysis failed") from exc
        return process_features(_state(request), features, "UPLOAD", (time.perf_counter() - started) * 1000)

    @app.post("/api/simulate")
    def simulate(body: ScenarioRequest, request: Request) -> dict:
        results = []
        for _ in range(body.chunks):
            started = time.perf_counter()
            features = extract_features(generate_scenario_wav(body.scenario))
            results.append(process_features(_state(request), features, body.scenario, (time.perf_counter() - started) * 1000))
        return {"scenario": body.scenario, "processed": len(results), "results": results}

    @app.get("/api/stats")
    def stats(request: Request) -> dict:
        state = _state(request)
        with state.lock:
            durations = [analysis.get("processing_latency_ms", 0.0) for analysis in state.analyses]
            return {
                "total_analyses": len(state.analyses),
                "suspicious": sum(1 for analysis in state.analyses if analysis["severity"] in {"HIGH", "CRITICAL"}),
                "alerts": len(state.alerts),
                "critical": sum(1 for analysis in state.analyses if analysis["severity"] == "CRITICAL"),
                "avg_processing_latency_ms": round(sum(durations) / len(durations), 2) if durations else None,
                "ledger_valid": state.ledger.verify(),
                "demo_data": True,
            }

    @app.get("/api/report")
    def report(request: Request) -> dict:
        state = _state(request)
        with state.lock:
            return {
                "report_title": "VoiceShield AI Passive Voice Threat Report",
                "generated_at": time.time(),
                "time_range": "Prototype session",
                "analyses": len(state.analyses),
                "alerts": len(state.alerts),
                "severity_distribution": {severity: sum(1 for alert in state.alerts if alert["severity"] == severity) for severity in ("LOW", "MEDIUM", "HIGH", "CRITICAL")},
                "model": "VoiceClone-DemoRF v0.2-demo-synthetic",
                "statement": "This prototype processes authorized audio locally in the FastAPI service. Results are demonstration evidence, not real-world accuracy claims.",
            }

    return app


app = create_app()
