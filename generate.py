import hashlib
import json
import os
import gzip
import shutil
import datetime

db_src = '../MobileInv/data/mobile_snapshot.db'
db_dst = 'mobile_snapshot.db.gz'

with open(db_src, 'rb') as f_in, gzip.open(db_dst, 'wb') as f_out:
    shutil.copyfileobj(f_in, f_out)

h = hashlib.sha256()
with open(db_dst, 'rb') as f:
    h.update(f.read())

d = {
  'snapshot_version': 12,
  'exported_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'snapshot': {
    'filename': 'mobile_snapshot.db.gz',
    'url': 'https://raw.githubusercontent.com/Somethinglikeu-hub/MobileInv-feed/gh-pages/mobile_snapshot.db.gz',
    'sha256': h.hexdigest(),
    'size_bytes': os.path.getsize(db_dst),
    'compression': 'gzip'
  }
}

with open('manifest.json', 'w') as f:
    f.write(json.dumps(d, indent=2))

print('Created manifest.json')
