# Contract test for .github/workflows/update-site.yml: the deployment rules must still be wired in.
# Run: python3 test/workflow.test.py   (needs PyYAML; reads the workflow only, no network)
# It fails if someone later weakens the gate: a deploy that does not wait for every check, a skipped check, a page
# published from an unchecked folder, a record written from a test branch, or a missing live verification.
import os, re, sys
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WF = os.environ.get('WORKFLOW_FILE') or os.path.join(ROOT, '.github', 'workflows', 'update-site.yml')
failures = []


def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond:
        failures.append(msg)


raw = open(WF, encoding='utf-8').read()
wf = yaml.safe_load(raw)
jobs = wf['jobs']
REQUIRED = ['formulas', 'page-tests', 'security', 'build', 'verify-site']


def needs(j):
    n = jobs[j].get('needs', [])
    return [n] if isinstance(n, str) else list(n)


def steps(j):
    return jobs[j].get('steps', [])


def uses(j):
    return [s.get('uses', '') for s in steps(j)]


def cond(j):
    return str(jobs[j].get('if', ''))


for j in REQUIRED + ['gate', 'deploy', 'verify-live', 'rollback']:
    check(j in jobs, f'job exists: {j}')

# 1-3. the required checks exist and none of them is conditional (a skipped check must not be possible by design)
for j in ['formulas', 'page-tests', 'security', 'build', 'verify-site']:
    check('if' not in jobs[j], f'{j} has no condition that could skip it')
check(any('formulas.test.mjs' in str(s.get('run', '')) for s in steps('formulas')), 'formulas job runs the formula tests')
check(any('deploy-safety.test.mjs' in str(s.get('run', '')) for s in steps('formulas')), 'formulas job runs the deployment safety tests')
check(any('page.test.py' in str(s.get('run', '')) for s in steps('page-tests')), 'page-tests job runs the page tests')
check(any('scan-repo.mjs' in str(s.get('run', '')) for s in steps('security')), 'security job scans for credentials')
check(any('workflow.test.py' in str(s.get('run', '')) for s in steps('security')), 'security job runs this contract test')
check(any('check-site.mjs' in str(s.get('run', '')) and '--commit' in str(s.get('run', '')) for s in steps('verify-site')), 'verify-site checks the built folder against this commit')

# the expensive build waits for the cheap checks
check({'formulas', 'page-tests', 'security'} <= set(needs('build')), 'build waits for formulas, page-tests and security')
check('build' in needs('verify-site'), 'verify-site waits for build')

# 4. the gate: always runs, needs every required job, lists the same jobs, is the only way to deploy
check(cond('gate').replace(' ', '') in ('${{always()}}', 'always()'), 'gate runs even when a check failed or was skipped (always())')
check(set(needs('gate')) == set(REQUIRED), f'gate needs exactly the required jobs: {sorted(needs("gate"))}')
gate_env = {}
for s in steps('gate'):
    if 'deploy-gate.mjs' in str(s.get('run', '')):
        gate_env = s.get('env', {})
check(set(str(gate_env.get('REQUIRED', '')).split(',')) == set(REQUIRED), 'the gate step lists the same required jobs')
check('toJSON(needs)' in str(gate_env.get('NEEDS_JSON', '')), 'the gate reads the real results of its needs')
check(needs('deploy') == ['gate'], 'deploy needs the gate')
check("needs.gate.result == 'success'" in cond('deploy'), 'deploy requires the gate to have succeeded')
others = [j for j in jobs if j != 'deploy' and any(u.startswith('actions/deploy-pages') for u in uses(j))]
check(others == ['rollback'], f'only deploy and rollback can publish: {others}')

# 5. the exact commit
bad_checkout = []
for j in jobs:
    for s in steps(j):
        if str(s.get('uses', '')).startswith('actions/checkout') and j != 'keepalive':
            if str((s.get('with') or {}).get('ref', '')).replace(' ', '') != '${{github.sha}}':
                bad_checkout.append(j)
check(not bad_checkout, f'every checkout is pinned to the triggering commit: {bad_checkout}')
check('refs/heads/main' in cond('deploy'), 'deploy runs from main only (a branch run is a dry run)')
pages_uploads = [j for j in jobs if any(u.startswith('actions/upload-pages-artifact') for u in uses(j))]
check(sorted(pages_uploads) == ['rollback', 'verify-site'], f'the Pages artifact is made only by verify-site (and rollback): {pages_uploads}')
vs = steps('verify-site')
i_check = next((i for i, s in enumerate(vs) if 'check-site.mjs' in str(s.get('run', ''))), -1)
i_up = next((i for i, s in enumerate(vs) if str(s.get('uses', '')).startswith('actions/upload-pages-artifact')), -1)
check(0 <= i_check < i_up, 'in verify-site the check comes before the Pages artifact is made')
check(not any('continue-on-error' in s for s in vs), 'no step of verify-site may continue on error')
for j in REQUIRED:
    check(not any(s.get('continue-on-error') is True and 'record' not in str(s.get('id', '')) for s in steps(j)), f'{j}: no step except the record save may continue on error')

# 6. a failed deployment cannot replace the live site: the only publisher is deploy-pages after the gate; nothing else
check(not any('git push' in str(s.get('run', '')) and 'gh-pages' in str(s.get('run', '')) for j in jobs for s in steps(j)), 'no job pushes the site to a branch by hand')

# 7. verification after the deploy, with a way back
check(any('verify-live.mjs' in str(s.get('run', '')) for s in steps('verify-live')), 'verify-live checks the live commit')
check('deploy' in needs('verify-live'), 'verify-live runs after deploy')
check(any(str(s.get('with', {}).get('name', '')) == 'last-good-site' and str(s.get('uses', '')).startswith('actions/upload-artifact') for s in steps('verify-live')), 'a verified version is kept as last-good-site')
check("needs.verify-live.result == 'failure'" in cond('rollback'), 'rollback runs when the live check failed')
check(any('verify-live.mjs' in str(s.get('run', '')) for s in steps('rollback')), 'rollback verifies what it restored')

# 8. the permanent record and permissions
rec = [s for s in steps('build') if s.get('id') == 'record']
check(len(rec) == 1 and 'refs/heads/main' in str(rec[0].get('if', '')), 'the record is saved only by runs on main')
check(wf.get('permissions') == {'contents': 'read'}, 'default permissions are read-only')
writers = {j: jobs[j].get('permissions', {}) for j in jobs}
check([j for j, p in writers.items() if p.get('pages') == 'write'] == ['deploy', 'rollback'] or sorted(j for j, p in writers.items() if p.get('pages') == 'write') == ['deploy', 'rollback'], 'only deploy and rollback can write to Pages')
check(sorted(j for j, p in writers.items() if p.get('contents') == 'write') == ['build', 'keepalive'], 'only build (record) and keepalive can write to the repository')
check(all('permissions' in jobs[j] for j in jobs), 'every job states its own permissions')

# actions are pinned to a major version at least
check(all(re.search(r'@v\d', u) for j in jobs for u in uses(j) if u), 'every action is pinned to a version')

print()
if failures:
    print(f'{len(failures)} workflow rule(s) broken:')
    for f in failures:
        print('  - ' + f)
    sys.exit(1)
print('all workflow rules hold')
