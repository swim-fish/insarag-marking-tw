#!/usr/bin/env python3
"""Check the controlled glossary, Chinese STE heuristics and local zhtw MCP.

Requires Python 3.10+; this checker uses only the standard library.
Exit 0: gates passed. Exit 1: findings or stale outputs. Exit 2: runtime failure.
"""
import argparse
import csv
import hashlib
import json
import queue
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUPPORTING_DOCS = ('README.md', 'ste-method.md', 'sources.md', 'verification.md', 'figma/README.md')
LATIN = re.compile(r'[A-Za-z]+')
PROTECTED = {'INSARAG', 'ASR', 'RCM', 'LEMA', 'UCC', 'STE', 'ASD', 'FEMA',
             'PDF', 'SVG', 'A', 'B', 'C', 'D', 'E', 'V', 'L', 'F', 'S', 'cm',
             'AAA', 'BBB', 'II', 'III', 'Volume', 'Manual', 'Operations', 'Annex',
             'Signalling', 'Issue', 'Figure', 'Figures', 'Table', 'TN', 'TV',
             # S1 marking dates are day + month abbreviation, e.g. "19 Oct".
             'Oct',
             # 2027 Guidelines: worksite IDs are allocated through the ICMS tool.
             'ICMS'}
# This is an explicit orthographic gate, not a complete Chinese conversion table.
SIMPLIFIED = set('标记图纸队员场处难层灾体遗续认号声线类区协时间数进复楼读检验术语词汇档网软务资设过录对龙风门车边东广')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_terms(path):
    with path.open(encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    ids, names, english = set(), set(), set()
    for row in rows:
        for key in ['id', 'english', 'zh_tw', 'kind', 'source', 'scope']:
            if not row.get(key):
                raise ValueError(f'Missing glossary field {key}: {row}')
        if row['id'] in ids or row['zh_tw'] in names or row['english'] in english:
            raise ValueError(f'Duplicate glossary entry: {row["id"]}')
        if row['kind'] not in ('TN', 'TV') or row['scope'] != 'project':
            raise ValueError(f'Invalid technical term classification: {row["id"]}')
        ids.add(row['id']); names.add(row['zh_tw']); english.add(row['english'])
        if any(a and a in row['zh_tw'] for a in row['aliases'].split('|')):
            raise ValueError(f'Alias overlaps canonical term: {row["id"]}')
    return rows


def strings(data, scenes):
    result = [('title', data['title']), ('edition', data['edition'])]
    for i, page in enumerate(data['pages'], 1):
        for key in ('title', 'kicker', 'source'):
            result.append((f'page:{i}:{key}', page[key]))
        for key in ('bullets', 'notes', 'cautions'):
            for n, value in enumerate(page.get(key, []), 1):
                result.append((f'page:{i}:{key}:{n}', value))
    for i, page in enumerate(scenes['pages'], 1):
        result.extend((f'svg:{i}:{n}', op['text']) for n, op in enumerate(page) if op['kind'] == 'text')
    return result


def lexical_checks(values, rows):
    findings = []
    allowed = PROTECTED | {w for row in rows for w in LATIN.findall(row['english'])}
    for location, value in values:
        # File paths and bibliographic section/page notation are protected literals.
        text = re.sub(r'(?:[A-Za-z0-9_-]+/)+[A-Za-z0-9_./-]*|[A-Za-z0-9_-]+\.(?:csv|json|md|svg|pdf)', '', value)
        text = re.sub(r'\b(?:pp?|S)\.?\s*\d+(?:[–-]\d+)?', '', text)
        for row in rows:
            for alias in filter(None, row['aliases'].split('|')):
                if alias in text:
                    findings.append(dict(level='error', rule='TERM_ALIAS', location=location,
                                         text=alias, preferred=row['zh_tw'], term_id=row['id']))
        for word in set(LATIN.findall(text)):
            if word not in allowed:
                findings.append(dict(level='error', rule='UNCONTROLLED_ENGLISH', location=location, text=word))
        for char in sorted(set(text) & SIMPLIFIED):
            findings.append(dict(level='error', rule='SIMPLIFIED_CHARACTER', location=location, text=char))
        if re.search(r'[\u4e00-\u9fff][A-Za-z]|[A-Za-z][\u4e00-\u9fff]', text):
            findings.append(dict(level='error', rule='MIXED_SPACING', location=location, text=text))
    return findings


def structure_checks(data, threshold=45):
    findings = []
    for i, page in enumerate(data['pages'], 1):
        for n, instruction in enumerate(page['bullets'], 1):
            loc = f'page:{i}:bullets:{n}'
            if not instruction.endswith('。') or instruction.count('。') != 1:
                findings.append(dict(level='error', rule='ONE_SENTENCE', location=loc, text=instruction))
            if any(c in instruction for c in ';；'):
                findings.append(dict(level='error', rule='NO_SEMICOLON', location=loc, text=instruction))
            if len(re.findall(r'[\u4e00-\u9fff]', instruction)) > threshold:
                findings.append(dict(level='warning', rule='ZH_SHORT_SENTENCE_HEURISTIC', location=loc, text=instruction))
            if re.search(r'，(?:若|如果|當|聽到|確認.+時)', instruction):
                findings.append(dict(level='warning', rule='CONDITION_ORDER_REVIEW', location=loc, text=instruction))
            if any(word in instruction for word in ['並', '以及', '然後']):
                findings.append(dict(level='warning', rule='SINGLE_ACTION_REVIEW', location=loc, text=instruction))
    return findings


def supporting_text(root):
    parts = []
    for name in SUPPORTING_DOCS:
        text = (root/name).read_text(encoding='utf-8')
        text = re.sub(r'```[\s\S]*?```', '\n', text)
        # Preserve literal filenames; removing them can create false punctuation findings.
        text = re.sub(r'`([^`]+)`', r'\1', text)
        text = re.sub(r'\]\([^)]*\)', ']', text)
        # Treat table cells independently, avoiding grammatical joins across columns.
        parts.append(text.replace('|', '\n'))
    return '\n\n'.join(parts)


def artifact_checks(root):
    manifest = json.loads((root/'build-manifest.json').read_text(encoding='utf-8'))
    findings = []
    for kind in ('inputs', 'outputs'):
        for name, expected in manifest[kind].items():
            path = (root/name).resolve()
            if not path.is_relative_to(root.resolve()):
                raise ValueError(f'Manifest path escapes handbook: {name}')
            if not path.is_file() or digest(path) != expected:
                findings.append(dict(level='error', rule='STALE_ARTIFACT', location=name, text=kind))
    if manifest['page_count'] != 12 or manifest['page_mm'] != [148, 210]:
        findings.append(dict(level='error', rule='A5_PAGE_COUNT', location='build-manifest.json'))
    return findings


class MCP:
    """Minimal newline-delimited JSON-RPC stdio client for the installed server."""
    def __init__(self, command):
        self.proc = subprocess.Popen([command], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, text=True, encoding='utf-8')
        self.inbox = queue.Queue()
        def read():
            for line in self.proc.stdout:
                self.inbox.put(line)
            self.inbox.put(None)
        threading.Thread(target=read, daemon=True).start()
        self.seq = 0

    def send(self, method, params, request=True):
        self.seq += 1
        obj = {'jsonrpc': '2.0', 'method': method, 'params': params}
        if request:
            obj['id'] = self.seq
        self.proc.stdin.write(json.dumps(obj, ensure_ascii=False)+'\n')
        self.proc.stdin.flush()
        if not request:
            return None
        while True:
            try:
                line = self.inbox.get(timeout=30)
            except queue.Empty as exc:
                raise RuntimeError('zhtw MCP response timed out') from exc
            if line is None:
                raise RuntimeError('zhtw MCP closed stdout')
            message = json.loads(line)
            if message.get('id') == obj['id']:
                if 'error' in message:
                    raise RuntimeError(str(message['error']))
                return message['result']

    def close(self):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill(); self.proc.wait(timeout=5)
        self.proc.stdin.close(); self.proc.stdout.close()


def zhtw_check(command, text, rows, policy):
    client = MCP(command)
    try:
        server = client.send('initialize', {'protocolVersion': '2024-11-05', 'capabilities': {},
                                            'clientInfo': {'name': 'insarag-handbook-check', 'version': '1.0'}})
        client.send('notifications/initialized', {}, request=False)
        tools = client.send('tools/list', {})['tools']
        if not any(tool['name'] == 'zhtw' for tool in tools):
            raise RuntimeError('The local MCP server does not expose zhtw')
        args = dict(text=text, content_type='plain', fix_mode='none', output='full', profile='base',
                    consistency=True, detect_ai=True, detect_translationese=True,
                    translationese_domain='technical', detect_style=True, verify=False,
                    max_errors=0, max_warnings=0,
                    ignore_terms=[entry['term'] for entry in policy['zhtw_exceptions']],
                    glossary=dict(preferred=[r['zh_tw'] for r in rows],
                                  proper_nouns=[r['zh_tw'] for r in rows]+['ASD-STE100'],
                                  banned=[a for r in rows for a in r['aliases'].split('|') if a]))
        raw = client.send('tools/call', {'name': 'zhtw', 'arguments': args})
        payload = json.loads(next(c['text'] for c in raw['content'] if c['type'] == 'text'))
        # zhtw flags gate rejections with isError while still returning a valid report.
        if 'accepted' not in payload:
            raise RuntimeError('zhtw returned no accepted field: '+str(payload))
        return {'server': server['serverInfo'], 'request': {k: v for k, v in args.items() if k != 'text'},
                'input_sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(), 'result': payload}
    finally:
        client.close()


def selftest():
    import tempfile
    rows = [dict(id='worksite', english='Worksite', zh_tw='工作場址', aliases='工作現場')]
    assert not lexical_checks([('valid', '在工作場址記錄 ASR 3。')], rows)
    assert any(x['rule'] == 'TERM_ALIAS' for x in lexical_checks([('bad', '工作現場')], rows))
    assert any(x['rule'] == 'UNCONTROLLED_ENGLISH' for x in lexical_checks([('bad', 'WorkSite')], rows))
    assert any(x['rule'] == 'SIMPLIFIED_CHARACTER' for x in lexical_checks([('bad', '标记')], rows))
    assert not lexical_checks([('literal', 'C-5 AAA-01 L-2 D-1 docs/insarag/sources/')], rows)
    assert any(x['rule'] == 'ONE_SENTENCE' for x in structure_checks({'pages': [{'bullets': ['記錄。確認。']}]}))
    assert any(x['rule'] == 'SINGLE_ACTION_REVIEW' for x in structure_checks({'pages': [{'bullets': ['記錄並確認。']}]}))
    with tempfile.TemporaryDirectory(prefix='.insarag-check-', dir=ROOT) as temp:
        root = Path(temp)
        source = root/'a.json'; source.write_text('original', encoding='utf-8', newline='\n')
        (root/'build-manifest.json').write_text(json.dumps({'inputs': {'a.json': digest(source)}, 'outputs': {},
                                                           'page_count': 12, 'page_mm': [148, 210]}))
        assert not artifact_checks(root)
        source.write_text('changed', encoding='utf-8', newline='\n')
        assert any(x['rule'] == 'STALE_ARTIFACT' for x in artifact_checks(root))
        table = root/'bad.csv'
        table.write_text('id,english,zh_tw,kind,aliases,source,scope\na,Worksite,工作場址,TN,,S1,project\na,Team,隊伍,TN,,S1,project\n', encoding='utf-8', newline='\n')
        try:
            load_terms(table)
        except ValueError:
            pass
        else:
            raise AssertionError('Duplicate glossary entry was accepted')
    print('Self-test: 10 fixtures passed')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--root', type=Path, default=ROOT)
    ap.add_argument('--offline', action='store_true', help='Skip MCP; glossary and artifact checks still run')
    ap.add_argument('--zhtw-command', help='Path to the local zhtw-mcp executable')
    ap.add_argument('--report', type=Path, help='Write a JSON report, including raw zhtw findings')
    ap.add_argument('--selftest', action='store_true')
    args = ap.parse_args()
    if args.selftest:
        selftest(); return 0
    root = args.root.resolve()
    rows = load_terms(root/'terminology.csv')
    data = json.loads((root/'manual.json').read_text(encoding='utf-8'))
    scenes = json.loads((root/'scenes.json').read_text(encoding='utf-8'))
    policy = json.loads((root/'language-policy.json').read_text(encoding='utf-8'))
    values = strings(data, scenes)
    findings = lexical_checks(values, rows) + structure_checks(data, policy['sentence_han_warning_threshold']) + artifact_checks(root)
    if len(data['pages']) != 12 or len(scenes['pages']) != 12:
        findings.append(dict(level='error', rule='PAGE_COUNT', location='manual.json'))
    # Deduplicate repeated PDF/SVG strings while retaining every source sentence.
    scan_text = '\n'.join(dict.fromkeys(v for _, v in values))
    report = dict(format=1, assurance='Chinese STE principles adaptation; not English STE certification',
                  inputs={name: digest(root/name) for name in ['manual.json', 'terminology.csv', 'scenes.json', 'build-manifest.json', 'language-policy.json', *SUPPORTING_DOCS]},
                  checker_sha256=digest(Path(__file__)), term_count=len(rows), findings=findings,
                  zhtw={'status': 'skipped', 'reason': 'explicit offline mode'},
                  supporting_docs_zhtw={'status': 'skipped', 'reason': 'explicit offline mode'})
    if not args.offline:
        command = args.zhtw_command or shutil.which('zhtw-mcp')
        if not command:
            raise RuntimeError('zhtw-mcp is unavailable; supply --zhtw-command or use explicit --offline')
        report['zhtw'] = {'status': 'completed', **zhtw_check(command, scan_text, rows, policy)}
        if report['zhtw']['result'].get('s2t_applied'):
            findings.append(dict(level='error', rule='MCP_S2T_CONVERSION', location='zhtw input',
                                 text='The source contains characters converted by MCP; fix the source and rebuild'))
        report['supporting_docs_zhtw'] = {'status': 'completed',
                                         'preprocessing': 'Exclude fenced code; retain inline literals; split table cells; remove link targets',
                                         **zhtw_check(command, supporting_text(root), rows, policy)}
        supporting_result = report['supporting_docs_zhtw']['result']
        if not supporting_result['accepted'] or supporting_result.get('s2t_applied'):
            findings.append(dict(level='error', rule='SUPPORTING_DOCS_LANGUAGE', location='supporting documentation',
                                 text='See supporting_docs_zhtw result'))
    errors = sum(f['level'] == 'error' for f in findings)
    warnings = sum(f['level'] == 'warning' for f in findings)
    accepted = report['zhtw'].get('result', {}).get('accepted')
    report['summary'] = dict(errors=errors, warnings=warnings, zhtw_accepted=accepted,
                             zhtw_status=report['zhtw']['status'],
                             passed=errors == 0 and warnings == 0 and (accepted is True or args.offline))
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(json.dumps(report['summary'], ensure_ascii=False))
    for item in findings[:20]:
        print(f'{item["level"]}: {item["rule"]}: {item["location"]}: {item.get("text", "")}')
    return 0 if report['summary']['passed'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, RuntimeError, StopIteration) as exc:
        print(f'Check failed: {exc}', file=sys.stderr)
        sys.exit(2)
