// Замер реальной стоимости хуков: stdout-байты + время по событиям SessionStart/UserPromptSubmit
const fs = require('fs');
const { spawnSync } = require('child_process');
const settings = JSON.parse(fs.readFileSync('C:/Users/user/.claude/settings.json', 'utf8'));
const cwd = process.argv[2];
const events = ['SessionStart', 'UserPromptSubmit'];
let grand = 0;
console.log('CWD:', cwd);
for (const ev of events) {
  const groups = (settings.hooks && settings.hooks[ev]) || [];
  let sub = 0, n = 0;
  console.log('== ' + ev);
  for (const g of groups) {
    for (const h of (g.hooks || [])) {
      if (!h.command) continue;
      const input = JSON.stringify({
        session_id: 'measure', cwd, hook_event_name: ev,
        source: 'startup', prompt: 'measure probe'
      });
      const t = Date.now();
      const r = spawnSync(h.command, { shell: true, input, timeout: 8000, cwd, encoding: 'utf8' });
      const out = r.stdout || '';
      const ms = Date.now() - t;
      sub += out.length; n++;
      const name = (h.command.match(/([\w.-]+)\.js/) || [])[1] || h.command.slice(0, 40);
      const flag = r.error ? (' ERR:' + String(r.error.message).slice(0, 30)) : '';
      console.log(String(out.length).padStart(7) + 'ch ' + String(ms).padStart(5) + 'ms  ' + name + flag);
    }
  }
  console.log('   subtotal ' + ev + ': ' + sub + ' chars over ' + n + ' hooks');
  grand += sub;
}
console.log('TOTAL: ' + grand + ' chars ≈ ' + Math.round(grand / 4) + ' tokens (за старт сессии + 1 промпт)');
