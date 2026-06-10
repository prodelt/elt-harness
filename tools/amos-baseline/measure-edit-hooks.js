// Замер per-edit и per-bash advisory-цены: PreToolUse/PostToolUse для Edit|Write и Bash
const fs = require('fs');
const { spawnSync } = require('child_process');
const settings = JSON.parse(fs.readFileSync('C:/Users/espad/.claude/settings.json', 'utf8'));
const cwd = process.argv[2] || process.cwd();
const cases = [
  { ev: 'PreToolUse', tool: 'Edit', input: { file_path: cwd + '/src/sample.js', old_string: 'a', new_string: 'b' } },
  { ev: 'PostToolUse', tool: 'Edit', input: { file_path: cwd + '/src/sample.js', old_string: 'a', new_string: 'b' } },
  { ev: 'PreToolUse', tool: 'Bash', input: { command: 'echo test' } },
  { ev: 'PostToolUse', tool: 'Bash', input: { command: 'echo test' } }
];
const matches = (matcher, tool) => {
  if (!matcher) return true;
  try { return new RegExp('^(' + matcher + ')$').test(tool); } catch (e) { return matcher.includes(tool); }
};
let grand = 0;
console.log('CWD:', cwd);
for (const c of cases) {
  const groups = (settings.hooks && settings.hooks[c.ev]) || [];
  let sub = 0, n = 0;
  console.log('== ' + c.ev + ' [' + c.tool + ']');
  for (const g of groups) {
    if (!matches(g.matcher, c.tool)) continue;
    for (const h of (g.hooks || [])) {
      if (!h.command) continue;
      const input = JSON.stringify({
        session_id: 'measure', cwd, hook_event_name: c.ev,
        tool_name: c.tool, tool_input: c.input,
        tool_response: { success: true, output: 'ok' }
      });
      const t = Date.now();
      const r = spawnSync(h.command, { shell: true, input, timeout: 8000, cwd, encoding: 'utf8' });
      const out = r.stdout || '';
      const ms = Date.now() - t;
      sub += out.length; n++;
      const name = (h.command.match(/([\w.-]+)\.js/) || [])[1] || h.command.slice(0, 40);
      console.log(String(out.length).padStart(7) + 'ch ' + String(ms).padStart(5) + 'ms  ' + name + (r.error ? ' ERR' : ''));
    }
  }
  console.log('   subtotal: ' + sub + ' chars over ' + n + ' hooks');
  grand += sub;
}
console.log('PER EDIT+BASH CYCLE: ' + grand + ' chars; за сессию с 30 эдитами и 20 баш ≈ ' + Math.round((grand) / 4) + ' tok/цикл');
