import copy
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('retention',Path(__file__).resolve().parents[1]/'scripts/backup/retention.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
NOW=dt.datetime(2026,9,18,tzinfo=dt.timezone.utc)
REF='a'*20
PREFIX='lino-backup/v1/'+REF+'/'
H='1'*64
stamp=lambda t:t.isoformat().replace('+00:00','Z')
class Fixture:
    def __init__(self):
        self.inventory={'format':1,'project_ref':REF,'prefix':PREFIX,'complete':True,'quiescent':True,'captured_at':stamp(NOW),'objects':[]}
        self.manifests=[]
    def obj(self,key,when,plain=H):
        self.inventory['objects'].append({'key':key,'size':100,'last_modified':stamp(when),'cipher_sha256':H,'plain_sha256':plain})
        return {'key':key,'cipher_sha256':H,'plain_sha256':plain}
    def photo(self,number,age=90):
        return self.obj(PREFIX+'photos/'+f'{number:064x}'+'.age',NOW-dt.timedelta(days=age))
    def snapshot(self,age,photos=(),serial=0):
        when=NOW-dt.timedelta(days=age)
        run=when.strftime('%Y%m%dT%H%M%SZ')+'-'+f'{serial:032x}'
        db=self.obj(PREFIX+'runs/'+run+'/database.age',when)
        manifest={'format':1,'run_id':run,'project_ref':REF,'atomic_snapshot':False,'database':db,'photos':[{'source':{'path':'PRIVATE_CUSTOMER_DATA'},'object':p} for p in photos],'plaintext_bytes_downloaded':100}
        raw=json.dumps(manifest).encode();self.manifests.append(raw)
        marker=PREFIX+'runs/'+run+'/complete.manifest.age'
        self.obj(marker,when,hashlib.sha256(raw).hexdigest())
        return marker
    def plan(self):return r.plan(self.inventory,self.manifests,REF,NOW)

class RetentionTests(unittest.TestCase):
    def test_old_shared_photo_and_private_data(self):
        f=Fixture();photo=f.photo(1,120);f.snapshot(0,[photo])
        result=f.plan()
        self.assertIn(photo['key'],[x['key'] for x in result['kept']])
        self.assertNotIn('PRIVATE_CUSTOMER_DATA',json.dumps(result))
        self.assertFalse(result['deletion_enabled'])
        self.assertEqual(result['restore_verification'],'not_established')
    def test_30_day_history_and_old_unreferenced_candidates(self):
        f=Fixture();historic=f.photo(1,100);orphan=f.photo(2,100)
        for age in range(45):f.snapshot(age,[historic] if age==30 else [])
        result=f.plan();kept={x['key'] for x in result['kept']};candidates={x['key'] for x in result['candidates']}
        self.assertIn(historic['key'],kept)
        self.assertIn(orphan['key'],candidates)
        self.assertEqual(result['counts']['retained_snapshots'],31)
        self.assertTrue(any('/runs/' in k for k in candidates))
    def test_daily_weekly_sparse_history(self):
        f=Fixture()
        for age in range(0,101,10):f.snapshot(age)
        result=f.plan()
        self.assertEqual(result['counts']['retained_snapshots'],7)
    def test_48_hour_boundary_and_incomplete_run(self):
        f=Fixture();f.snapshot(0);old=f.photo(1,90)
        when=NOW-dt.timedelta(hours=48)
        run=when.strftime('%Y%m%dT%H%M%SZ')+'-'+'9'*32
        key=PREFIX+'runs/'+run+'/database.age';f.obj(key,when)
        self.assertEqual(f.plan()['candidates'],[])
        f.inventory['objects'][-1]['last_modified']=stamp(when-dt.timedelta(seconds=1))
        # Move run start too: object cannot predate its run.
        f.inventory['objects'][-1]['key']=PREFIX+'runs/'+(when-dt.timedelta(seconds=1)).strftime('%Y%m%dT%H%M%SZ')+'-'+'9'*32+'/database.age'
        self.assertIn(old['key'],[x['key'] for x in f.plan()['candidates']])
    def test_missing_manifest_reference_or_conflicting_hash_refused(self):
        for scenario in ['manifest','object','hash','duplicate','foreign']:
            f=Fixture();photo=f.photo(1);f.snapshot(0,[photo])
            if scenario=='manifest':f.manifests=[]
            elif scenario=='object':f.inventory['objects'].pop(0)
            elif scenario=='hash':f.inventory['objects'][0]['cipher_sha256']='2'*64
            elif scenario=='duplicate':f.manifests.append(f.manifests[0])
            else:f.inventory['objects'][0]['key']='lino-backup/v1/'+'b'*20+'/photos/'+H+'.age'
            with self.subTest(scenario=scenario),self.assertRaises(r.Refused):f.plan()
    def test_future_stale_incomplete_inventory_refused(self):
        for scenario in ['future','stale','incomplete','running','nonutc','unknown_key']:
            f=Fixture();f.snapshot(0)
            if scenario=='future':f.inventory['objects'][0]['last_modified']=stamp(NOW+dt.timedelta(seconds=1))
            elif scenario=='stale':f.inventory['captured_at']=stamp(NOW-dt.timedelta(hours=2))
            elif scenario=='incomplete':f.inventory['complete']=False
            elif scenario=='running':f.inventory['quiescent']=False
            elif scenario=='nonutc':f.inventory['objects'][0]['last_modified']='2026-09-18T00:00:00+00:00'
            else:f.inventory['objects'][0]['key']=PREFIX+'unrecognized.age'
            with self.subTest(scenario=scenario),self.assertRaises(r.Refused):f.plan()
    def test_tampered_plain_manifest_refused(self):
        f=Fixture();f.snapshot(0);f.manifests[0]+=b' '
        with self.assertRaises(r.Refused):f.plan()
    def test_no_snapshot_and_duplicate_json_refused(self):
        with self.assertRaises(r.Refused):Fixture().plan()
        with self.assertRaises(r.Refused):r.unique_json(b'{"a":1,"a":2}')
if __name__=='__main__':unittest.main()
