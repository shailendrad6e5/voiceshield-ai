from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    """Every test gets its own JSON state; the committed demo model is read-only."""
    app = create_app(tmp_path / "demo-state.json")
    with TestClient(app) as test_client:
        yield test_client
