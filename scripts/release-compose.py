"""Produce a deployable Compose file pinned to built image digests."""
import json
from pathlib import Path
manifest = json.loads(Path('release/manifest.json').read_text())
text = Path('compose.yaml').read_text()
for component in ('server', 'web'):
    dockerfile = 'server/Dockerfile' if component == 'server' else 'apps/web/Dockerfile'
    build = f'    build:\n      context: .\n      dockerfile: {dockerfile}'
    if text.count(build) != 1:
        raise SystemExit(f'Expected one build definition for {component}')
    text = text.replace(build, '    image: ' + manifest['images'][component])
text = text.replace('./deploy/livekit.local.yaml', './livekit.local.yaml')
print(text, end='')
