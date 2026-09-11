"""Canonical SHA-256 tamper-evident hash chain for the local prototype."""

import hashlib
import json
import time


class AuditLedger:
    def __init__(self):
        self.items = []

    @staticmethod
    def _digest(body):
        encoded = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def append(self, event_type, payload):
        previous_hash = self.items[-1]["hash"] if self.items else "0" * 64
        body = {
            "index": len(self.items),
            "timestamp": time.time(),
            "event_type": event_type,
            "payload": payload,
            "previous_hash": previous_hash,
        }
        body["hash"] = self._digest(body)
        self.items.append(body)
        return body

    def verify(self):
        previous_hash = "0" * 64
        required = {"index", "timestamp", "event_type", "payload", "previous_hash", "hash"}
        if not isinstance(self.items, list):
            return False
        for index, item in enumerate(self.items):
            if not isinstance(item, dict) or not required.issubset(item):
                return False
            try:
                raw = {key: item[key] for key in ("index", "timestamp", "event_type", "payload", "previous_hash")}
                digest = self._digest(raw)
            except (TypeError, ValueError):
                return False
            if item["index"] != index or item["previous_hash"] != previous_hash or item["hash"] != digest:
                return False
            previous_hash = item["hash"]
        return True
