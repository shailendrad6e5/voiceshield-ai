from app.risk import score

def test_high_risk():
    r=score(.9,.2,.3,.7)
    assert r[0]>80 and r[1]=='CRITICAL'

def test_low_risk():
    r=score(.1,.9,.9,.1)
    assert r[0]<30 and r[1]=='LOW'
