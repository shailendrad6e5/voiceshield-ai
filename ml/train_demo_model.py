import sys
sys.path.insert(0,'../backend')
from app.ml_engine import train_demo_model
m=train_demo_model(); print('Saved demonstration model:',m)
