"""Read-only parity check between qualified archives and a profile's installed runtime files."""
import argparse
import hashlib
import json
import tarfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--home', required=True)
parser.add_argument('--profile', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
installed = Path(args.home).resolve() / 'profiles' / args.profile / 'node_modules'
registry = json.loads((root / 'integrations/registry.json').read_text())
for row in registry['plugins']:
    if not row['enabled']:
        continue
    package = json.loads((root / row['directory'] / 'package.json').read_text())
    archive = root / row['artifact']
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == row['sha256'], f"Unqualified archive: {row['id']}"
    count = 0
    with tarfile.open(archive) as source:
        for member in source:
            if not member.isfile() or not member.name.endswith(('.js', '.mjs', 'cordis.patch.yml')):
                continue
            relative = Path(member.name.removeprefix('package/'))
            assert not relative.is_absolute() and '..' not in relative.parts
            target = installed / package['name'] / relative
            assert target.is_file(), f"Missing {row['id']}: {relative}"
            assert target.read_bytes() == source.extractfile(member).read(), f"Stale {row['id']}: {relative}"
            count += 1
    print(f"PASS {row['id']}: {count} installed JavaScript/bundle files match qualified archive")
