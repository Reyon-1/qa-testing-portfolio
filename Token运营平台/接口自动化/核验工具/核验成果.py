"""Offline consistency and publication scan. Uses Python standard library only."""
from pathlib import Path
import json,csv,xml.etree.ElementTree as ET,re

ROOT=Path(__file__).resolve().parents[1]
def read(p):return json.loads((ROOT/p).read_text(encoding='utf-8-sig'))
summary=read('执行证据/执行汇总.json');scenes=read('执行证据/场景步骤.json')
with (ROOT/'执行证据/接口覆盖明细.csv').open(encoding='utf-8-sig') as f:coverage=list(csv.DictReader(f))
with (ROOT/'执行证据/场景执行明细.csv').open(encoding='utf-8-sig') as f:catalog=list(csv.DictReader(f))
junit=ET.parse(ROOT/'执行证据/断言执行记录.xml').getroot()
assert len(coverage)==summary['documentEntries']==781
assert sum(x['executed']=='True' for x in coverage)==summary['executedEntries']==530
assert sum(x['passed']=='True' for x in coverage)==summary['passedEntries']==523
assert round(summary['executedEntries']/len(coverage)*100,2)==summary['coveragePercent']==67.86
assert len(scenes)==len(catalog)==summary['scenarios']==81
assert len(junit.findall('testsuite'))==summary['businessSteps']==1278
assert len(junit.findall('.//testcase'))==summary['assertions']==3810
assert len(junit.findall('.//failure'))==summary['failedAssertions']==11
assert len(read('执行证据/失败检查明细.json'))==summary['failedSteps']==9
assert sum(x['failedSteps'] for x in scenes)==9
for m in summary['ends']:
 subset=[x for x in scenes if x['end']==m['end']];eps=[x for x in coverage if x['end']==m['end']]
 assert len(subset)==m['scenarios'] and len(eps)==m['documentEntries']
 assert sum(x['businessSteps'] for x in subset)==m['businessSteps']
 assert sum(x['passedSteps'] for x in subset)==m['passedSteps']
 assert sum(x['failedSteps'] for x in subset)==m['failedSteps']
 assert sum(x['executed']=='True' for x in eps)==m['executedEntries']
 for scene in subset:
  assert scene['businessSteps']==len(scene['steps'])
  assert sum(x['assertions'] for x in scene['steps'])>0
  assert [x['number'] for x in scene['steps']]==list(range(1,len(scene['steps'])+1))

# Scan publication contents. Report only filenames/categories, never matched secrets.
patterns={
 'key':r'(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}',
 'bearer':r'Bearer\s+[A-Za-z0-9._-]{20,}',
 'private_ipv4':r'\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b',
 'personal_local_path':r'[A-Za-z]:[\\/](?:Users|用户)[\\/][^\\/\s]+',
 'email':r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
 'long_resource_id':r'(?<![A-Fa-f0-9])\d{16,}(?![A-Fa-f0-9])',
}
suspects=[]
for f in ROOT.rglob('*'):
 if not f.is_file() or f.suffix not in {'.md','.json','.csv','.html','.xml','.js','.py'}:continue
 t=f.read_text(encoding='utf-8-sig')
 for category,p in patterns.items():
  if re.search(p,t):suspects.append({'file':f.relative_to(ROOT).as_posix(),'category':category})
assert not suspects,suspects
text_file_count=sum(f.is_file() and f.suffix in {'.md','.json','.csv','.html','.xml','.js','.py'} for f in ROOT.rglob('*'))
print(json.dumps({'consistency':'passed','scenarios':81,'steps':1278,'documentEntries':781,'executedEntries':530,'coveragePercent':67.86,'publicationScan':'passed','textFilesChecked':text_file_count},ensure_ascii=False,indent=2))
