"""Restore into a uniquely named disposable database and compare the backup inventory."""
import json
import secrets
import subprocess
import sys
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
    actual = json.loads(subprocess.check_output([*base, 'psql', '-U', 'yapper', '-d', name, '-At', '-c', query], text=True))
    if actual != json.loads((bundle / 'counts.json').read_text()):
        raise SystemExit('Restored inventory differs')
    print('PASS: checksums, fresh-database restore and users/channels/messages inventory')
finally:
    subprocess.run([*base, 'dropdb', '-U', 'yapper', name], check=True)
