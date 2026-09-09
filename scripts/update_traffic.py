#!/usr/bin/env python3
import json, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone

URL = 'https://www.td.gov.hk/tc/special_news/trafficnews.xml'
OUT = 'traffic.json'

req = urllib.request.Request(URL, headers={'User-Agent':'DauZan/4.0 traffic refresher','Accept':'application/xml,text/xml,*/*'})
with urllib.request.urlopen(req, timeout=20) as r:
    raw = r.read()
root = ET.fromstring(raw)

def txt(node, name):
    el = node.find(name)
    return (el.text or '').strip() if el is not None and el.text else ''

items = []
for n in root.findall('.//message'):
    content = txt(n,'CONTENT_CN')
    status = txt(n,'INCIDENT_STATUS_CN')
    item = {
        'id': txt(n,'INCIDENT_NUMBER') or txt(n,'ID'),
        'heading': txt(n,'INCIDENT_HEADING_CN'),
        'detail': txt(n,'INCIDENT_DETAIL_CN'),
        'location': txt(n,'LOCATION_CN'),
        'direction': txt(n,'DIRECTION_CN'),
        'updated': txt(n,'ANNOUNCEMENT_DATE'),
        'status': status,
        'content': content,
    }
    # Keep current messages; suppress messages that clearly say the incident has ended.
    ended = ('已解封','取消','恢復正常','重開','回復正常','已恢復正常')
    if not any(x in (status + content) for x in ended):
        items.append(item)

payload = {
    'source': URL,
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'warnings': items,
}
with open(OUT,'w',encoding='utf-8') as f:
    json.dump(payload,f,ensure_ascii=False,separators=(',',':'))
    f.write('\n')
print(f'wrote {len(items)} warnings')
