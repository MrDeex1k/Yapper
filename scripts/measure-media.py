"""Sample an explicitly selected local SFU container; no credentials are collected."""
import argparse
import datetime
import json
import subprocess
import time
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('scenario',choices=['voice','camera','screen'])
parser.add_argument('output',type=Path)
parser.add_argument('--seconds',type=int,default=20)
parser.add_argument('--container',default='yapper-media-1')
args=parser.parse_args()
if not 5<=args.seconds<=60: raise SystemExit('Use a duration between 5 and 60 seconds')
if args.output.exists(): raise SystemExit('Refusing to overwrite measurement')
samples=[];started=time.monotonic()
while time.monotonic()-started<args.seconds:
 raw=subprocess.check_output(['docker','stats','--no-stream','--format','{{json .}}',args.container],text=True)
 row=json.loads(raw);samples.append({'elapsed_seconds':round(time.monotonic()-started,2),'cpu_percent':row['CPUPerc'],'memory':row['MemUsage'],'network_io':row['NetIO']})
 time.sleep(2)
result={'scenario':args.scenario,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsed_seconds':round(time.monotonic()-started,2),'container':args.container,'samples':samples,'note':'Container network counters are cumulative. Compare first/last samples; this is a local synthetic baseline, not a capacity benchmark.'}
args.output.write_text(json.dumps(result,indent=2)+'\n')
print(f'Saved {len(samples)} {args.scenario} samples to {args.output}')
