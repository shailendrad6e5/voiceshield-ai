def score(clone_probability, speaker_match, liveness, replay_score=0.0):
    # Transparent weighted fusion. Inputs are normalized 0..1.
    risk=100*(0.50*clone_probability + 0.22*(1-speaker_match) + 0.20*(1-liveness) + 0.08*replay_score)
    risk=round(max(0,min(100,risk)),1)
    severity='LOW' if risk<=30 else 'MEDIUM' if risk<=60 else 'HIGH' if risk<=80 else 'CRITICAL'
    confidence=round(max(clone_probability,1-speaker_match,1-liveness)*100,1)
    return risk,severity,confidence

def evidence(f, clone_p, speaker_match, liveness, replay_score):
    e=[]
    if clone_p>=.65: e.append({'feature':'clone_probability','observed':round(clone_p,3),'baseline':'< 0.50','reason':'Demo anti-spoof classifier scored the audio as synthetic-like.'})
    if f['spectral_flatness']<.10: e.append({'feature':'spectral_flatness','observed':round(f['spectral_flatness'],4),'baseline':'typically higher for varied natural audio','reason':'Unusually smooth spectral distribution in the extracted segment.'})
    if f['pitch_variation']<.05: e.append({'feature':'pitch_variation','observed':round(f['pitch_variation'],4),'baseline':'>= 0.05 in demo baseline','reason':'Very low pitch variability.'})
    if speaker_match<.55: e.append({'feature':'speaker_match','observed':round(speaker_match,3),'baseline':'>= 0.55','reason':'Audio differs from enrolled reference representation.'})
    if liveness<.55: e.append({'feature':'liveness','observed':round(liveness,3),'baseline':'>= 0.55','reason':'Passive liveness indicators are weak; additional challenge is recommended.'})
    if replay_score>.60: e.append({'feature':'replay_score','observed':round(replay_score,3),'baseline':'< 0.60','reason':'Demo replay detector observed replay-like spectral/timing characteristics.'})
    return e or [{'feature':'risk_fusion','observed':'low evidence','baseline':'normal','reason':'No configured detector exceeded its evidence threshold.'}]
