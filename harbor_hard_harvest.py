#!/usr/bin/env python3
import json
import subprocess
import sys
import time
from pathlib import Path

WORKDIR = Path('/root/workspace/bimaru')
ATTEMPT_SCRIPT = WORKDIR / 'harbor_generate_one_hard.js'
STATE_PATH = WORKDIR / 'harbor_hard_harvest_state.json'
CANDIDATES_JSONL = WORKDIR / 'harbor_hard_candidates.jsonl'
TOP_PATH = WORKDIR / 'harbor_hard_top.json'
LOG_PATH = WORKDIR / 'harbor_hard_harvest.log'

TARGET = int(sys.argv[1]) if len(sys.argv) > 1 else 5
ATTEMPTS = int(sys.argv[2]) if len(sys.argv) > 2 else 16
ATTEMPT_TIMEOUT = int(sys.argv[3]) if len(sys.argv) > 3 else 240


def now():
    return time.strftime('%Y-%m-%dT%H:%M:%S')


def log(obj):
    with LOG_PATH.open('a', encoding='utf-8') as f:
        f.write(json.dumps(obj, ensure_ascii=False) + '\n')


def load_state():
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {
        'started_at': now(),
        'updated_at': now(),
        'target': TARGET,
        'attempts_planned': ATTEMPTS,
        'attempt_timeout_sec': ATTEMPT_TIMEOUT,
        'completed_attempts': 0,
        'accepted': [],
        'seen_signatures': [],
        'near_misses': [],
    }


def save_state(state):
    state['updated_at'] = now()
    STATE_PATH.write_text(json.dumps(state, indent=2, ensure_ascii=False))


def signature(puzzle):
    cl = sorted(puzzle['cl'].items(), key=lambda kv: int(kv[0]))
    return json.dumps({'rc': puzzle['rc'], 'cc': puzzle['cc'], 'cl': cl}, separators=(',', ':'))


def acceptance(summary):
    strong_islands = sum(1 for v in summary['islandVals'] if v >= 3)
    return (
        summary['essential'] and
        summary['noIslandExact'] and
        summary['noIslandSolutions'] >= 2 and
        summary['clues'] <= 5 and
        summary['shipClues'] <= 3 and
        summary['singles'] == 0 and
        strong_islands >= 1 and
        (summary['islandClues'] >= 2 or 4 in summary['islandVals']) and
        (summary.get('bridge') or 0) >= 4
    )


def near_miss_score(summary):
    return (
        summary['clues'],
        summary['shipClues'],
        -summary['noIslandSolutions'],
        -(summary.get('bridge') or 0),
        -(summary.get('solverCalls') or 0),
    )


def sort_entries(entries):
    entries.sort(key=lambda e: near_miss_score(e['summary']))


def write_top(state):
    accepted = state['accepted'][:]
    sort_entries(accepted)
    accepted = accepted[:TARGET]
    payload = {
        'generated_at': now(),
        'target': TARGET,
        'completed_attempts': state['completed_attempts'],
        'accepted_count': len(accepted),
        'accepted': accepted,
        'near_misses': state['near_misses'][:10],
    }
    TOP_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False))


state = load_state()
seen = set(state.get('seen_signatures', []))
LOG_PATH.touch()
save_state(state)
write_top(state)
log({'ts': now(), 'kind': 'startup', 'target': TARGET, 'attempts': ATTEMPTS, 'timeout_sec': ATTEMPT_TIMEOUT})

for attempt in range(state['completed_attempts'] + 1, ATTEMPTS + 1):
    t0 = time.time()
    cmd = ['node', str(ATTEMPT_SCRIPT)]
    try:
        res = subprocess.run(cmd, cwd=WORKDIR, capture_output=True, text=True, timeout=ATTEMPT_TIMEOUT)
        ms = int((time.time() - t0) * 1000)
        stdout = (res.stdout or '').strip()
        stderr = (res.stderr or '').strip()
        if res.returncode != 0:
            event = {'ts': now(), 'attempt': attempt, 'ok': False, 'kind': 'nonzero_exit', 'returncode': res.returncode, 'ms': ms, 'stderr': stderr[:1000]}
            log(event)
        elif not stdout:
            event = {'ts': now(), 'attempt': attempt, 'ok': False, 'kind': 'empty_stdout', 'ms': ms}
            log(event)
        else:
            data = json.loads(stdout)
            event = {'ts': now(), 'attempt': attempt, 'ok': bool(data.get('ok')), 'ms': ms}
            if data.get('summary'):
                event['summary'] = data['summary']
            if data.get('reason'):
                event['reason'] = data['reason']
            log(event)
            if data.get('ok') and data.get('puzzle') and data.get('summary'):
                sig = signature(data['puzzle'])
                entry = {
                    'attempt': attempt,
                    'ms': data.get('ms', ms),
                    'summary': data['summary'],
                    'puzzle': data['puzzle'],
                    'signature': sig,
                }
                with CANDIDATES_JSONL.open('a', encoding='utf-8') as f:
                    f.write(json.dumps(entry, ensure_ascii=False) + '\n')
                if sig not in seen:
                    seen.add(sig)
                    if acceptance(data['summary']):
                        state['accepted'].append(entry)
                        sort_entries(state['accepted'])
                        state['accepted'] = state['accepted'][:TARGET]
                    else:
                        state['near_misses'].append({
                            'attempt': attempt,
                            'ms': data.get('ms', ms),
                            'summary': data['summary'],
                        })
                        sort_entries(state['near_misses'])
                        state['near_misses'] = state['near_misses'][:20]
        state['completed_attempts'] = attempt
        state['seen_signatures'] = sorted(seen)
        save_state(state)
        write_top(state)
    except subprocess.TimeoutExpired:
        ms = int((time.time() - t0) * 1000)
        log({'ts': now(), 'attempt': attempt, 'ok': False, 'kind': 'timeout', 'ms': ms, 'timeout_sec': ATTEMPT_TIMEOUT})
        state['completed_attempts'] = attempt
        state['seen_signatures'] = sorted(seen)
        save_state(state)
        write_top(state)

summary = {
    'done_at': now(),
    'attempts_completed': state['completed_attempts'],
    'accepted_count': len(state['accepted']),
    'top_path': str(TOP_PATH),
    'state_path': str(STATE_PATH),
    'jsonl_path': str(CANDIDATES_JSONL),
    'log_path': str(LOG_PATH),
}
print(json.dumps(summary, indent=2, ensure_ascii=False))
