"""Build the deterministic synthetic-only demonstration model artifact."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.ml_engine import train_demo_model  # noqa: E402


if __name__ == "__main__":
    model = train_demo_model()
    print(f"Saved {type(model).__name__} demonstration model to {ROOT / 'models' / 'voice_clone_demo.joblib'}")
