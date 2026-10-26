import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
inventory = json.loads((root / 'selection.json').read_text())
for item in inventory['selection']:
    path = root / item['name']
    data = path.read_bytes()
    assert len(data) == item['bytes'], f"Size mismatch: {item['name']}"
    assert hashlib.sha256(data).hexdigest() == item['sha256'], f"Hash mismatch: {item['name']}"
print(f"Verified {len(inventory['selection'])} selected producer files.")
