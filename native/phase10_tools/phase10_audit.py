#!/usr/bin/env python3
"""Connect 199-item PWA parity evidence audit.

This program deliberately does NOT award runtime acceptance from code fragments.
It makes a reproducible source-evidence map for human/device acceptance.
No build, server writes, APK creation, or device actions.
"""
import csv
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR=Path(__file__).resolve().parent
sys.path.insert(0,str(SCRIPT_DIR))
from probes import PROBES

SOURCE_SHA_PWA='98e33db66cd105818a0bfaded268f921b634d97b'
CRITICAL={
 '01.01','01.05','02.01','02.02','02.03','02.06','02.08','03.04',
 '04.04','05.02','05.05','05.07','05.10','05.11','05.15','05.16',
 '06.01','06.04','06.05','06.06','07.01','07.03','07.06','08.01',
 '09.06','09.07','09.08','09.11','10.01','10.02','10.03','10.04',
 '10.08','10.11','10.12','11.07','12.03','12.04','12.05',
 '13.01','13.02','14.06','14.09','15.01','15.02','15.08',
 '16.01','16.02','16.04','16.05','16.08','16.10','17.06','17.07',
 '18.01','18.07','20.01','20.03','20.08','20.09','20.11',
}
HARDWARE_GROUPS={7,8,10,16}
DESIGN_GROUPS={1,12,13,14,15,17,19}


def git_sha(root):
    try:
        return subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True,stderr=subprocess.DEVNULL).strip()
    except Exception:
        return 'unknown (local snapshot)'


def audit(root:Path, out:Path):
    cases=json.loads((SCRIPT_DIR/'baseline_199.json').read_text(encoding='utf-8'))
    assert len(cases)==199 and len({r['id'] for r in cases})==199
    assert len({r['group'] for r in cases})==20
    assert set(PROBES)=={r['id'] for r in cases}, 'Every checklist point must have an evidence probe'
    sources=[]
    native=root/'native'
    for folder in (native/'src',native/'plugins'):
        if folder.is_dir():
            sources.extend(p for p in folder.rglob('*') if p.suffix in ('.ts','.tsx','.js','.json') and p.is_file())
    sources.extend(p for p in (native/'app.json',native/'package.json') if p.is_file())
    index={str(p.relative_to(root)):p.read_text(encoding='utf-8',errors='replace').casefold() for p in sources}
    rows=[]
    by_group=defaultdict(lambda:Counter())
    for r in cases:
        terms=PROBES[r['id']]
        found=[]
        missing=[]
        for term in terms:
            matches=[name for name,src in index.items() if term.casefold() in src]
            if matches: found.append((term,matches[0]))
            else: missing.append(term)
        candidate=len(missing)==0
        group_number=int(r['id'][:2])
        evidence='; '.join(f'{name} («{term[:55]}»)' for term,name in found)
        row={
            **r,
            'priority':'P0' if r['id'] in CRITICAL else ('P2' if group_number==19 else 'P1'),
            'source_probe':'Есть текстовый признак' if candidate else 'Требует проверки исходников',
            'signals':len(found), 'signal_total':len(terms),
            'missing_signals':missing,
            'example_evidence':evidence,
            'acceptance':'НЕ ПОДТВЕРЖДЕНО',
            'device_test':'Да' if group_number in HARDWARE_GROUPS else 'По необходимости',
            'visual_review':'Да' if group_number in DESIGN_GROUPS else 'По необходимости',
            'test_instruction':'Проверить в PWA и Android: '+re.sub(r'\*','',r['description'])
        }
        rows.append(row)
        by_group[r['group']]['source_candidates' if candidate else 'review_needed']+=1

    assert len(rows)==199
    candidates=sum(x['source_probe']=='Есть текстовый признак' for x in rows)
    needs_review=199-candidates
    count_baseline=Counter(x['baseline'] for x in rows)
    assert count_baseline=={'Код есть':77,'Частично':62,'Не найдено':56,'Платформенный аналог':4}

    gates={}
    try:
        cfg=json.loads((native/'app.json').read_text(encoding='utf-8'))
        gates['Android user-facing app name is Connect']=cfg['expo']['name']=='Connect'
        gates['App package remains com.connect.messenger']=cfg['expo']['android']['package']=='com.connect.messenger'
    except Exception:
        gates['Android configuration is valid JSON']=False
    voice=index.get('native/src/ConnectNativeVoice.tsx','')
    gates['Calls remain audio-only (no video:true)']='video:false' in voice and 'video:true' not in voice
    gates['Native UI does not mount a WebView']=not any('react-native-webview' in value or 'from \'react-native-webview\'' in value for name,value in index.items() if name.startswith('native/src/'))
    gates['Phase 9 mini-game source is present']='native/src/ConnectNativeSonicRunner.tsx' in index
    gates['Phase 9 cross-device read sync source is present']='native/src/ConnectNativeReadSync.ts' in index
    gates['Native call bridge is present']='native/src/ConnectNativeTelecom.ts' in index
    gates['Native FCM push integration is present']='native/src/ConnectNativePush.ts' in index
    legacy=root/'.github/workflows/android-apk.yml'
    if legacy.is_file():
        s=legacy.read_text(encoding='utf-8')
        gates['Legacy APK auto-build disabled']=(not re.search(r'^\s{2}push\s*:',s,re.M)) and not re.search(r'\b(?:assemble(?:Release|Debug)|eas build|gradlew)\b',s,re.I)
    else:gates['Legacy APK auto-build disabled']=False
    gate_ok=all(gates.values())

    report={
       'title':'Connect Native: 199-point PWA parity source-evidence report',
       'run_timestamp_utc':datetime.now(timezone.utc).isoformat(),
       'baseline_audit_date':'2026-11-08',
       'pwa_reference_repo':'Chimera1988/connect-messenger',
       'pwa_reference_commit':SOURCE_SHA_PWA,
       'native_commit_before_workflow_commit':git_sha(root),
       'source_evidence_candidates':candidates,
       'source_review_needed':needs_review,
       'runtime_acceptance_confirmed':0,
       'baseline_counts':dict(count_baseline),
       'critical_source_review_needed':[r['id'] for r in rows if r['priority']=='P0' and r['missing_signals']],
       'gates':gates,
       'release_status':'NOT READY: no installed Android/device/visual end-to-end validation',
       'cases':rows,
    }
    out.mkdir(parents=True,exist_ok=True)
    (out/'phase10_parity_199.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    with (out/'phase10_parity_199.csv').open('w',newline='',encoding='utf-8-sig') as h:
        writer=csv.DictWriter(h,lineterminator='\n',fieldnames=['id','group','priority','description','baseline','source_probe','example_evidence','missing_signals','acceptance','device_test','visual_review','test_instruction'])
        writer.writeheader()
        for r in rows:
            entry={k:r[k] for k in writer.fieldnames}
            entry['missing_signals']=' | '.join(r['missing_signals'])
            writer.writerow(entry)

    parts=[
        '# Connect Native — этап 10: аудит 199 пунктов PWA',
        '',
        f'**Эталон PWA:** `Chimera1988/connect-messenger` @ `{SOURCE_SHA_PWA}`.',
        f'**Android:** `Chimera1988/connect-android`, проверенный рабочий каталог `native/`. Коммит: `{git_sha(root)}`.',
        '',
        '**Решение о релизе: НЕ ГОТОВО.** Текстовые совпадения в исходниках — не работающие сценарии, и не подтверждение идентичной внешности. Ни один пункт нельзя автоматически принять без ручного теста.',
        '',
        f'**Исходные признаки:** {candidates}/199; требуют дополнительной сверки кода: {needs_review}/199; подтверждены тестом на устройстве: **0/199**.',
        '',
        '**Исходная статистика старой карты (до этапов 1–9; НЕ текущая оценка готовности):** ' + ', '.join(f'{k}: {v}' for k,v in count_baseline.items())+'.',
        '',
        '## Обязательные технические ограничения',
        '',
    ]
    for name,ok in gates.items():parts.append(f'- [{"x" if ok else " "}] {name}')
    parts.extend(['','## Сводка по группам','', '| Группа | Признаки | Требует проверки исходников |','|---|---:|---:|'])
    for group,c in by_group.items():parts.append(f'| {group.replace("|","/")} | {c["source_candidates"]} | {c["review_needed"]} |')
    parts.extend(['','## Все 199 пунктов','', '| ID | Группа | Приоритет | Состояние кода | Ручная приёмка | Текст требования |','|---|---|---|---|---|---|'])
    for row in rows:
        desc=row['description'].replace('|','/').replace('\n',' ').strip()
        parts.append(f"| {row['id']} | {row['group']} | {row['priority']} | {row['source_probe']} | {row['acceptance']} | {desc} |")
    parts.extend(['','## Критичные пункты без явного статического признака','',' '.join(report['critical_source_review_needed']) or 'Нет — но это не подтверждает работоспособность.','',
       '## Ручная приёмка (не заменять TypeScript-проверкой)','',
       '1. Сравнить каждый из 199 пунктов на Android и в текущем PWA, включая ошибки, жесты, ориентацию, текст, клавиатуру и фон. Зафиксировать результат, устройство и дату.',
       '2. Сравнить скриншоты Liquid Glass, светлой/тёмной тем, чатов, профиля, уведомлений, мини-плеера и звонков.',
       '3. Провести реальные сквозные тесты PWA↔Android: вход по приглашению, сообщение/доставка/прочтение/удаление, фото/видео/документы/голосовые/видеокружки, избранные стикеры.',
       '4. Проверить реальный FCM на заблокированном устройстве, переход из push, очистку прочитанных сообщений в шторке, разные устройства, пользовательские звуки звонка и сообщений.',
       '5. Проверить аудиозвонки на открытом/фоновом/заблокированном Android, микрофон, Bluetooth/динамик, отклонение/занято/пропущено; видеозвонки НЕ внедрять.',
       '6. Проверить API ограничения, RLS, доступ к файлам и приватность, правила аккаунта и удаления.',
       '7. APK нельзя считать разрешённым ни по одному из автоматических статусов. Только отдельное подтверждение полного переноса и план финального выпуска.',
       '',
       'В CSV/JSON указаны исходные признаки по каждому пункту. Отсутствующий признак — повод проверить исходники, а не доказательство отсутствия функции; найденный признак — не доказательство её исправной работы.',
    ])
    (out/'phase10_parity_199.md').write_text('\n'.join(parts)+'\n',encoding='utf-8')

    summary=[
        '### Connect Native — этап 10: 199-пунктовая проверка (NO APK)',
        f'- 199 пунктов / 20 групп. Текстовые признаки в исходниках: **{candidates}**; требуют разбора: **{needs_review}**.',
        '- Подтверждений реальным устройством: **0/199** (их нельзя получить при TypeScript-проверке).',
        f'- Релиз: **НЕ ГОТОВ**. Автоматическая проверка НЕ открывает выпуск APK.',
        '- Технические защитные проверки: '+('все прошли' if gate_ok else 'есть нарушения — см. таблицу ниже'),
        '- Подробности: Actions → artifacts → `connect-native-phase10-parity-report`.',
        '',
        '| Проверка | Результат |','|---|---|',
    ]
    summary += [f'| {name} | {"OK" if ok else "BLOCKED"} |' for name,ok in gates.items()]
    (out/'summary.md').write_text('\n'.join(summary)+'\n',encoding='utf-8')
    print(f'199 points; source candidates={candidates}, code review needed={needs_review}; device confirmed=0; hard gates={"OK" if gate_ok else "FAIL"}')
    if not gate_ok:raise SystemExit('STOP: essential source / disabled-APK gates failed; no commit will be made.')
    return report


def self_test():
    import tempfile
    with tempfile.TemporaryDirectory() as base:
        root=Path(base)
        (root/'native/src').mkdir(parents=True)
        (root/'native/app.json').write_text(json.dumps({'expo':{'name':'Connect','android':{'package':'com.connect.messenger'}}}),encoding='utf-8')
        (root/'.github/workflows').mkdir(parents=True)
        (root/'.github/workflows/android-apk.yml').write_text('on:\n  workflow_dispatch:\n',encoding='utf-8')
        try:audit(root,root/'check')
        except SystemExit as err:
            assert 'gates failed' in str(err).lower(),err
        result=json.loads((root/'check/phase10_parity_199.json').read_text(encoding='utf8'))
        assert len(result['cases'])==199
        assert result['runtime_acceptance_confirmed']==0
        assert result['release_status'].startswith('NOT READY')
        print('SELF TEST OK — 199 distinct cases, reports generated, cannot bypass missing native source.')

if __name__=='__main__':
    if '--self-test' in sys.argv:self_test()
    else:
        root=Path(os.environ.get('CONNECT_REPO_ROOT','.')).resolve()
        out=Path(os.environ.get('CONNECT_AUDIT_OUTPUT','native/phase10-audit')).resolve()
        audit(root,out)
