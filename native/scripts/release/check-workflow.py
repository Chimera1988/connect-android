from pathlib import Path
import yaml,json
path=Path('../.github/workflows/connect-android-parity-release.yml')
size=path.stat().st_size
if not 0<size<450000:raise SystemExit('Workflow exceeds strict byte limit')
data=yaml.load(path.read_text(),Loader=yaml.BaseLoader)
assert set(data['on']['workflow_dispatch']['inputs']['mode']['options'])=={'check','ota','apk'}
assert data['concurrency']['cancel-in-progress']=='false'
assert all(name in data['jobs'] for name in ['verify','ota','apk'])
print(json.dumps({'workflowBytes':size,'yamlParser':'PyYAML','modes':['check','ota','apk']}))
