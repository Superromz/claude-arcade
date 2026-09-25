'use strict';
// Projects tab: account-wide stats per project (git root), most XP first.

const L = require('./lib');
const { ui } = require('./state');
const { panelLine, sectionHeader, barPart, fmtNum } = require('./panels');

function ago(ms) {
  const s = Math.max(0, (Date.now() - (ms || 0)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function projectsTab(d, pal, W, h) {
  const rows = Object.values(d.state.projects || {}).sort((a, b) => b.xp - a.xp);
  const current = d.ses.project;
  const out = [sectionHeader(W, pal, 'PROJECTS', [[`${rows.length} tracked · all heroes`, pal.dim]])];
  if (!rows.length) {
    out.push(panelLine(W, pal.panel, [['  Stats start with your next Claude session in any project.', pal.dim]]));
    return out;
  }
  const maxXp = Math.max(1, ...rows.map((p) => p.xp));
  const nameW = Math.min(22, Math.max(8, ...rows.map((p) => p.name.length)) + 2);
  const barW = Math.max(8, Math.min(30, W - nameW - 62));
  out.push(panelLine(W, pal.panel2, [[`  ${'Project'.padEnd(nameW)}${' '.repeat(barW)} ${'XP'.padStart(7)}  ${'Quests'.padStart(6)}  ${'Edits'.padStart(5)}  ${'Cmds'.padStart(4)}  ${'Agents'.padStart(6)}  ${'Tokens'.padStart(6)}   Active`, pal.dim]]));
  for (const p of rows.slice(0, Math.max(1, h - 3))) {
    const t = p.tools || {};
    const here = current && p.path === current;
    const panel = here ? pal.panel2 : pal.panel;
    const lead = `${here ? '▸ ' : '  '}${p.name.slice(0, nameW - 1).padEnd(nameW)}`;
    const nums = ` ${String(p.xp).padStart(7)}  ${String(p.quests).padStart(6)}  ${String(t.editing || 0).padStart(5)}  ${String(t.running || 0).padStart(4)}  ${String(t.summoning || 0).padStart(6)}  ${fmtNum((p.tokens || {}).output || 0).padStart(6)}   ${ago(p.lastSeen)}`;
    const line = `${panelLine(nameW + 2, panel, [[lead, here ? pal.accent : pal.text, here]]).replace(/\x1b\[0m$/, '')}${barPart(p.xp / maxXp, barW, pal.magic, pal.accent, pal, panel)}`;
    out.push(line + panelLine(W - nameW - 2 - barW, panel, [[nums, pal.text]]));
  }
  out.push(panelLine(W, pal.panel, [[`  ▸ marks the project of the session you're following. Hero XP is separate; this is your usage.`, pal.dim]]));
  return out;
}

module.exports = { projectsTab };
