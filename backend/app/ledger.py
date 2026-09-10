import hashlib, json, time
class AuditLedger:
    def __init__(self): self.items=[]
    def append(self,event_type,payload):
        prev=self.items[-1]['hash'] if self.items else '0'*64
        body={'index':len(self.items),'timestamp':time.time(),'event_type':event_type,'payload':payload,'previous_hash':prev}
        h=hashlib.sha256(json.dumps(body,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        body['hash']=h; self.items.append(body); return body
    def verify(self):
        prev='0'*64
        for i,item in enumerate(self.items):
            raw={k:item[k] for k in ('index','timestamp','event_type','payload','previous_hash')}
            if item['index']!=i or item['previous_hash']!=prev: return False
            if hashlib.sha256(json.dumps(raw,sort_keys=True,separators=(',',':')).encode()).hexdigest()!=item['hash']: return False
            prev=item['hash']
        return True
