from __future__ import annotations
from pathlib import Path
import numpy as np, joblib
from sklearn.ensemble import RandomForestClassifier
from .features import FEATURE_NAMES

ROOT=Path(__file__).resolve().parents[2]
MODEL=ROOT/'models'/'voice_clone_demo.joblib'

def train_demo_model():
    rng=np.random.default_rng(42); n=1600
    X=[]; y=[]
    for _ in range(n//2):
        X.append([rng.uniform(1,8),rng.uniform(.04,.25),rng.uniform(.02,.18),rng.normal(1900,450),rng.normal(1500,500),rng.uniform(.15,.55),rng.normal(4500,900),rng.uniform(.25,.8),rng.normal(170,35),rng.uniform(.08,.45),rng.uniform(.03,.3),rng.uniform(.02,.18)]); y.append(0)
    for _ in range(n//2):
        X.append([rng.uniform(1,8),rng.uniform(.04,.25),rng.uniform(.02,.16),rng.normal(1650,300),rng.normal(1150,350),rng.uniform(.02,.28),rng.normal(3600,650),rng.uniform(.12,.45),rng.normal(175,22),rng.uniform(.01,.14),rng.uniform(.04,.34),rng.uniform(.01,.12)]); y.append(1)
    m=RandomForestClassifier(n_estimators=160,random_state=42,class_weight='balanced').fit(X,y)
    MODEL.parent.mkdir(parents=True,exist_ok=True); joblib.dump(m,MODEL); return m

def get_model():
    return joblib.load(MODEL) if MODEL.exists() else train_demo_model()

def predict(f:dict):
    m=get_model(); x=np.array([[f[k] for k in FEATURE_NAMES]])
    p=float(m.predict_proba(x)[0,1])
    return {'clone_probability':round(p,4),'model':'VoiceClone-DemoRF','model_version':'0.1-demo-synthetic'}
