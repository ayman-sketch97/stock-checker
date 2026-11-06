// Release check (VALIDATION.md, section 18): which functions a release changes, compared with an earlier version.
// Every function in the page's script and in lib/*.js is parsed, named by where it sits (outer > inner), and its own
// code compared with nested functions left out, so a change is pinned to the one function that holds it. Code outside
// any function (constants, tables of text) is compared the same way. Needs the acorn parser, installed outside the
// project: npm install --prefix /tmp/acorn acorn@8.14.0 acorn-walk@8.3.4
// node test/validation/changed-code.mjs <old git ref, e.g. origin/main> [acorn folder = /tmp/acorn]
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(path.dirname(new URL(import.meta.url).pathname)));
const REF = process.argv[2] || 'origin/main';
const req = createRequire(path.join(process.argv[3] || '/tmp/acorn', 'node_modules', 'x.js'));
const acorn = req('acorn');
const walk = req('acorn-walk');

const old = (f) => { try { return execFileSync('git', ['-C', ROOT, 'show', `${REF}:${f}`], { encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { return null; } };
const now = (f) => { try { return readFileSync(path.join(ROOT, f), 'utf8'); } catch { return null; } };
const script = (html) => { const m = /<script>([\s\S]*?)<\/script>/.exec(html); return m ? m[1] : ''; };

// name -> own code (with each nested function replaced by its name), plus '(outside any function)'
function pieces(src, module) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: module ? 'module' : 'script', allowHashBang: true });
  const fns = [];
  const nameOf = (node, parent) => {
    if (node.id && node.id.name) return node.id.name;
    if (parent && parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
    if (parent && (parent.type === 'Property' || parent.type === 'MethodDefinition') && parent.key) return parent.key.name || parent.key.value;
    if (parent && parent.type === 'AssignmentExpression') return src.slice(parent.left.start, parent.left.end);
    return null;
  };
  walk.fullAncestor(ast, (node, _s, anc) => {
    if (!/Function/.test(node.type)) return;
    const parent = anc[anc.length - 2];
    fns.push({ node, name: nameOf(node, parent) });
  });
  // outer > inner names; unnamed callbacks are named by their enclosing function and their order within it
  fns.sort((a, b) => a.node.start - b.node.start || b.node.end - a.node.end);
  const seen = new Map();
  for (const f of fns) {
    const outer = fns.filter((g) => g !== f && g.node.start <= f.node.start && g.node.end >= f.node.end).sort((a, b) => b.node.start - a.node.start)[0];
    f.outer = outer;
    const base = f.name || 'anonymous';
    const q = (outer ? outer.q + ' > ' : '') + base;
    const k = seen.get(q) || 0;
    seen.set(q, k + 1);
    f.q = k ? `${q} #${k + 1}` : q;
  }
  const own = (start, end, inner) => {
    let out = '';
    let at = start;
    for (const g of inner) { out += src.slice(at, g.node.start) + `<fn ${g.q}>`; at = g.node.end; }
    return (out + src.slice(at, end)).replace(/\s+/g, ' ').trim();
  };
  const direct = (f) => fns.filter((g) => g.outer === f).sort((a, b) => a.node.start - b.node.start);
  const map = new Map();
  for (const f of fns) map.set(f.q, own(f.node.start, f.node.end, direct(f)));
  map.set('(outside any function)', own(0, src.length, fns.filter((g) => !g.outer).sort((a, b) => a.node.start - b.node.start)));
  return map;
}

function compare(file, a, b, module) {
  if (a === b) return { file, same: true };
  const A = pieces(a, module);
  const B = pieces(b, module);
  const changed = [...B.keys()].filter((k) => A.has(k) && A.get(k) !== B.get(k));
  const added = [...B.keys()].filter((k) => !A.has(k));
  const removed = [...A.keys()].filter((k) => !B.has(k));
  return { file, same: false, functions: B.size, changed, added, removed };
}

const files = ['index.html', ...readdirSync(path.join(ROOT, 'lib')).filter((f) => f.endsWith('.js')).map((f) => `lib/${f}`),
  ...readdirSync(path.join(ROOT, 'tools')).map((f) => `tools/${f}`), ...readdirSync(path.join(ROOT, '.github', 'workflows')).map((f) => `.github/workflows/${f}`)];
for (const f of files) {
  const a = old(f);
  const b = now(f);
  if (a === null) { console.log(`${f}: new file`); continue; }
  if (!/\.(m?js|html)$/.test(f)) { console.log(`${f}: ${a === b ? 'identical' : 'CHANGED (not code that is parsed here)'}`); continue; }
  const r = f === 'index.html' ? compare(f, script(a), script(b), false) : compare(f, a, b, true);
  if (f === 'index.html' && a.replace(script(a), '') !== b.replace(script(b), '')) console.log('index.html: the markup outside the script changed too');
  if (r.same) { console.log(`${f}: identical`); continue; }
  console.log(`${f}: ${r.changed.length} of ${r.functions} functions changed, ${r.added.length} added, ${r.removed.length} removed`);
  for (const [w, xs] of [['changed', r.changed], ['added', r.added], ['removed', r.removed]]) for (const x of xs) console.log(`  ${w}: ${x}`);
}
