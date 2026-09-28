"""Update the product version before preparing (not publishing) a release."""
import json,re,sys
from pathlib import Path
version=sys.argv[1]
if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-z0-9.]+)?',version):raise SystemExit('Invalid version')
Path('VERSION').write_text(version+'\n')
for path in Path('apps').glob('*/package.json'):
 data=json.loads(path.read_text());data['version']=version;path.write_text(json.dumps(data,indent=2)+'\n')
p=Path('server/internal/app/server.go');p.write_text(re.sub(r'var Version = "[^"]+"',f'var Version = "{version}-dev"',p.read_text()))
p=Path('server/Dockerfile');p.write_text(re.sub(r'ARG VERSION=[^\n]+',f'ARG VERSION={version}-dev',p.read_text()))
