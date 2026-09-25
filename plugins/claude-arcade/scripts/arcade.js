#!/usr/bin/env node
// CLI behind the /claude-arcade:* commands.
//   arcade.js setup [theme]   install HUD status line + themed spinner into ~/.claude/settings.json
//   arcade.js uninstall       restore the settings that setup replaced
//   arcade.js theme <name>    switch theme (rpg | space | retro)
//   arcade.js play            open the game pane (split pane where the terminal allows it)
//   arcade.js stats           print the hero sheet
//   arcade.js toggle <toasts|ascii>
//   arcade.js reset           wipe XP and achievements
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const BIN = path.join(L.HOME, 'bin');
const BACKUP = path.join(L.HOME, 'settings-backup.json');
const node = (file) => `node "${path.join(BIN, file).replace(/\\/g, '/')}"`;

function applySpinner(settings, t) {
  settings.spinnerVerbs = { mode: 'replace', verbs: t.spinnerVerbs };
  settings.spinnerTipsOverride = { tips: t.tips, excludeDefault: false };
}

// Copy scripts to a stable path: the plugin dir changes on every update.
function installScripts() {
  fs.mkdirSync(BIN, { recursive: true });
  // Everything except the hook and this CLI, which always run from the plugin dir.
  for (const f of fs.readdirSync(__dirname)) if (f.endsWith('.js') && !['hook.js', 'arcade.js'].includes(f)) fs.copyFileSync(path.join(__dirname, f), path.join(BIN, f));
}

function setup(themeName) {
  const cfg = L.loadConfig();
  if (themeName) setTheme(cfg, themeName);

  installScripts();

  const settings = L.readJSON(SETTINGS, {});
  if (!fs.existsSync(BACKUP)) {
    const keys = ['statusLine', 'subagentStatusLine', 'spinnerVerbs', 'spinnerTipsOverride'];
    L.writeJSON(BACKUP, Object.fromEntries(keys.map((k) => [k, settings[k] ?? null])));
  }
  settings.statusLine = { type: 'command', command: node('statusline.js'), refreshInterval: 1, padding: 0 };
  settings.subagentStatusLine = { type: 'command', command: node('subagents.js') };
  applySpinner(settings, L.theme(cfg));
  L.writeJSON(SETTINGS, settings);
  L.saveConfig(cfg);
  console.log(`Claude Arcade installed with the "${L.theme(cfg).name}" theme.`);
  console.log(`Updated ${SETTINGS} (previous values saved to ${BACKUP}).`);
  console.log(`Game pane: run /claude-arcade:play, or in any terminal pane: ${node('game.js')}`);
}

// Open the game next to Claude. Windows Terminal can split itself; other
// terminals (Warp, iTerm, VS Code…) get the command on the clipboard.
function play() {
  const { spawn, execSync } = require('child_process');
  const cmd = node('game.js');
  installScripts();
  if (process.env.WT_SESSION) {
    spawn('wt.exe', ['-w', '0', 'sp', '-V', '-s', '0.45', 'node', path.join(BIN, 'game.js')], { detached: true, stdio: 'ignore' }).unref();
    console.log('Opened the game in a Windows Terminal split pane.');
    return;
  }
  let copied = false;
  try {
    const clip = process.platform === 'win32' ? 'clip' : process.platform === 'darwin' ? 'pbcopy' : 'xclip -selection clipboard';
    execSync(clip, { input: cmd, stdio: ['pipe', 'ignore', 'ignore'] });
    copied = true;
  } catch {}
  const split = process.env.TERM_PROGRAM === 'WarpTerminal'
    ? (process.platform === 'darwin' ? 'Cmd+D' : 'Ctrl+Shift+D') + ' in Warp'
    : 'your terminal\'s split-pane shortcut';
  console.log(`Split the window with ${split}, then paste and run${copied ? ' (already copied to your clipboard)' : ''}:`);
  console.log(`  ${cmd}`);
}
function uninstall() {
  const settings = L.readJSON(SETTINGS, {});
  const backup = L.readJSON(BACKUP, {});
  for (const k of ['statusLine', 'subagentStatusLine', 'spinnerVerbs', 'spinnerTipsOverride']) {
    if (backup[k] != null) settings[k] = backup[k]; else delete settings[k];
  }
  L.writeJSON(SETTINGS, settings);
  try { fs.unlinkSync(BACKUP); } catch {}
  console.log('Restored your previous status line and spinner settings. XP is kept in ' + L.HOME);
}

function setTheme(cfg, name) {
  if (!L.THEMES[name]) {
    console.log(`Unknown theme "${name}". Choose one of: ${Object.keys(L.THEMES).join(', ')}`);
    process.exit(1);
  }
  cfg.theme = name;
}

function theme(name) {
  const cfg = L.loadConfig();
  setTheme(cfg, name);
  L.saveConfig(cfg);
  const settings = L.readJSON(SETTINGS, {});
  if (settings.statusLine && String(settings.statusLine.command || '').includes('statusline.js')) {
    applySpinner(settings, L.theme(cfg));
    L.writeJSON(SETTINGS, settings);
  }
  console.log(`Theme switched to ${L.theme(cfg).name}.`);
}

function stats() {
  const cfg = L.loadConfig();
  const t = L.theme(cfg);
  const s = L.loadState();
  const lvl = L.levelFor(s.xp);
  const lo = L.xpForLevel(lvl), hi = L.xpForLevel(lvl + 1);
  const got = new Set(s.achievements);
  const lines = [
    `HERO SHEET â€” ${t.name}`,
    `Level ${lvl} ${L.titleFor(t, lvl)}   ${L.bar((s.xp - lo) / (hi - lo), 20, '#', '-')} ${s.xp}/${hi} ${t.xpLabel}`,
    `Quests completed: ${s.quests}   Day streak: ${s.streak.count}`,
    `Edits forged: ${s.tools.editing || 0}   Commands cast: ${s.tools.running || 0}   Scouting: ${(s.tools.reading || 0) + (s.tools.searching || 0)}`,
    `Web scrying: ${s.tools.web || 0}   Party summons: ${s.tools.summoning || 0}   Plans drawn: ${s.tools.planning || 0}`,
    '',
    `ACHIEVEMENTS (${got.size}/${L.ACHIEVEMENTS.length})`,
    ...L.ACHIEVEMENTS.map((a) => `${got.has(a.id) ? '[x]' : '[ ]'} ${a.name} â€” ${a.desc}`),
  ];
  console.log(lines.join('\n'));
}

function toggle(key) {
  const cfg = L.loadConfig();
  if (!['toasts', 'ascii'].includes(key)) { console.log('Toggle one of: toasts, ascii'); process.exit(1); }
  cfg[key] = !cfg[key];
  L.saveConfig(cfg);
  console.log(`${key} is now ${cfg[key] ? 'on' : 'off'}.`);
}

function reset() {
  L.saveState({ ...L.loadState(), xp: 0, quests: 0, tools: {}, achievements: [] });
  console.log('Progress reset. A new adventure begins.');
}

const [cmd, arg] = process.argv.slice(2);
const commands = { setup: () => setup(arg), play, uninstall, theme: () => theme(arg), stats, toggle: () => toggle(arg), reset };
(commands[cmd] || (() => console.log('Usage: arcade.js setup|play|uninstall|theme <name>|stats|toggle <toasts|ascii>|reset')))();
