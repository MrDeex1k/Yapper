import os,subprocess
from pathlib import Path
env=os.environ.copy()
for line in Path('.env').read_text().splitlines():
 if line.startswith(('LIVEKIT_API_KEY=','LIVEKIT_API_SECRET=')):
  key,value=line.split('=',1);env[key]=value
env['LIVEKIT_URL']=env.get('LIVEKIT_URL','http://127.0.0.1:17880')
go=str(Path('.tools/go/bin/go').resolve()) if Path('.tools/go/bin/go').exists() else 'go'
subprocess.run([go,'run','./cmd/media-smoke'],cwd='server',env=env,check=True,timeout=120)
