"""Run real-PostgreSQL tests using the local Compose development override."""
import os,subprocess
from pathlib import Path
from urllib.parse import quote
env=os.environ.copy()
settings=dict(line.split('=',1) for line in Path('.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
env['TEST_DATABASE_URL']='postgres://yapper:'+quote(settings['POSTGRES_PASSWORD'],safe='')+'@127.0.0.1:15433/yapper?sslmode=disable'
go=str(Path('.tools/go/bin/go').resolve()) if Path('.tools/go/bin/go').exists() else 'go'
subprocess.run([go,'test','-race','./...'],cwd='server',env=env,check=True)
