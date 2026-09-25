#!/usr/bin/env node
// subagentStatusLine: renders each running subagent as a party member with
// a class icon, an animated action and a "stamina" bar of its context use.
'use strict';

const L = require('./lib');
const { paint, bar } = L;

const CLASSES = {
  rpg: [
    [/explore|search|find/i, '🏹', 'Ranger', 'scouting'],
    [/plan|architect/i, '📜', 'Sage', 'plotting'],
    [/review|audit|security/i, '🛡', 'Paladin', 'inspecting'],
    [/test|debug|fix/i, '⚔', 'Warrior', 'fighting bugs'],
    [/guide|doc|research/i, '📚', 'Scholar', 'studying'],
    [/.*/, '🧙', 'Mage', 'casting'],
  ],
  space: [
    [/explore|search|find/i, '🔭', 'Scout', 'scanning'],
    [/plan|architect/i, '🧭', 'Navigator', 'plotting'],
    [/review|audit|security/i, '🛡', 'Security', 'inspecting'],
    [/.*/, '🛸', 'Drone', 'on mission'],
  ],
  retro: [
    [/explore|search|find/i, '[S]', 'SCOUT', 'SEARCHING'],
    [/plan|architect/i, '[P]', 'PLANNER', 'LOADING'],
    [/.*/, '[2P]', 'PLAYER', 'PLAYING'],
  ],
};
const SPARK = { rpg: ['✦', '✧', '⋆', '✧'], space: ['·', '•', '●', '•'], retro: ['.', 'o', 'O', 'o'] };

function main() {
  const input = L.readStdin();
  const cfg = L.loadConfig();
  const ascii = cfg.ascii || cfg.theme === 'retro';
  const classes = CLASSES[cfg.theme] || CLASSES.rpg;
  const spark = SPARK[cfg.theme] || SPARK.rpg;
  const tick = Math.floor(Date.now() / 1000);
  const out = [];

  for (const task of input.tasks || []) {
    const kind = `${task.type || ''} ${task.name || ''}`;
    const [, icon, cls, verb] = classes.find(([re]) => re.test(kind));
    const done = /complete|done|finished/i.test(task.status || '');
    const failed = /fail|error|kill|cancel/i.test(task.status || '');
    const secs = task.startTime ? Math.max(0, Math.floor((Date.now() - new Date(task.startTime).getTime()) / 1000)) : 0;
    const stam = task.contextWindowSize && task.tokenCount ? 1 - task.tokenCount / task.contextWindowSize : null;
    const anim = done ? (ascii ? 'OK' : '🏆') : failed ? (ascii ? 'KO' : '💀') : spark[(tick + out.length) % spark.length].repeat(1 + ((tick + out.length) % 3)).padEnd(3);
    const desc = String(task.description || task.label || task.name || '').replace(/\s+/g, ' ');
    const room = Math.max(10, (input.columns || 100) - 48);

    out.push(JSON.stringify({
      id: task.id,
      content: [
        `${icon} ${paint('bold', paint('cyan', cls))}`,
        paint(done ? 'green' : failed ? 'red' : 'yellow', `${done ? 'returned' : failed ? 'fell' : verb} ${anim}`),
        stam != null ? paint(stam > 0.3 ? 'green' : 'red', bar(stam, 5, ascii ? '=' : '▰', ascii ? '.' : '▱')) : '',
        paint('gray', secs ? `${secs}s` : ''),
        paint('white', desc.length > room ? desc.slice(0, room - 1) + '…' : desc),
      ].filter(Boolean).join('  '),
    }));
  }
  process.stdout.write(out.join('\n'));
}

try { main(); } catch { /* fall back to default rows */ }
