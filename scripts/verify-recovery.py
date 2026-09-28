"""Restore into a uniquely named disposable database and compare the backup inventory."""
import json
import secrets
import subprocess
import sys
import tarfile
import tempfile
import shutil
import re
from pathlib import Path
bundle = Path(sys.argv[1]).resolve()
if not (bundle / 'COMPLETE').is_file():
    raise SystemExit('Incomplete backup bundle')
subprocess.run(['shasum', '-a', '256', '-c', 'SHA256SUMS'], cwd=bundle, check=True, stdout=subprocess.DEVNULL)
name = 'yapper_verify_' + secrets.token_hex(8)
base = ['docker', 'compose', 'exec', '-T', 'database']
subprocess.run([*base, 'createdb', '-U', 'yapper', name], check=True)
try:
    with (bundle / 'database.dump').open('rb') as stream:
        subprocess.run([*base, 'pg_restore', '-U', 'yapper', '-d', name, '--no-owner', '--exit-on-error', '--single-transaction'], stdin=stream, check=True)
    query = "SELECT json_build_object('users',(SELECT count(*) FROM users),'channels',(SELECT count(*) FROM channels),'messages',(SELECT count(*) FROM messages))"
    if (bundle / 'files.tar').exists():
        query = query.replace("'messages',(SELECT count(*) FROM messages)", "'messages',(SELECT count(*) FROM messages),'attachments',(SELECT count(*) FROM attachments)")
    actual = json.loads(subprocess.check_output([*base, 'psql', '-U', 'yapper', '-d', name, '-At', '-c', query], text=True))
    if actual != json.loads((bundle / 'counts.json').read_text()):
        raise SystemExit('Restored inventory differs')
    if (bundle / 'files.tar').exists():
        with tempfile.TemporaryDirectory(prefix='yapper-restore-files-') as directory, tarfile.open(bundle / 'files.tar') as archive:
            restored = {}
            for member in archive:
                filename = member.name.removeprefix('./')
                if member.isdir() and filename in ('', '.'):
                    continue
                if not member.isfile() or not re.fullmatch(r'[A-Z2-7]{26}', filename):
                    raise SystemExit('Unsafe archive entry')
                with archive.extractfile(member) as source, (Path(directory) / filename).open('xb') as target:
                    shutil.copyfileobj(source, target)
                restored[filename] = (Path(directory) / filename).stat().st_size
            records = json.loads(subprocess.check_output([*base,'psql','-U','yapper','-d',name,'-At','-c',"SELECT COALESCE(json_object_agg(id,bytes),'{}'::json) FROM attachments"],text=True))
            if any(restored.get(key) != size for key,size in records.items()):
                raise SystemExit('Missing or truncated restored attachment')
    print('PASS: checksums, isolated database inventory and attachment restore')
finally:
    subprocess.run([*base, 'dropdb', '-U', 'yapper', name], check=True)
