#!/usr/bin/env node
// Single entry point for every hook event. Updates game state that the
// status line animates, and prints toasts (systemMessage) for big moments.
// Must never fail or block Claude: every error is swallowed.
'use strict';

const L = require('./lib');

function main() {
  const input = L.readStdin();
  const event = input.hook_event_name || process.argv[2] || '';
  const cfg = L.loadConfig();
  const t = L.theme(cfg);
  const state = L.loadState();
  const ses = L.session(state, input.session_id);
  const levelBefore = L.levelFor(state.xp);
  const toasts = [];
  const now = Date.now();

  const set = (mode, detail = '') => { ses.mode = mode; ses.detail = detail; ses.since = now; };
  const gain = (n) => { state.xp += n; ses.xp += n; };

  switch (event) {
    case 'SessionStart': {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(now - 864e5).toISOString().slice(0, 10);
      if (state.streak.day !== today) {
        state.streak.count = state.streak.day === yesterday ? state.streak.count + 1 : 1;
        state.streak.day = today;
      }
      L.pruneSessions(state);
      set('idle');
      if (input.source === 'startup' || input.source === 'resume') {
        const lvl = L.levelFor(state.xp);
        toasts.push(`🎮 ${t.name} — Lv ${lvl} ${title(t, lvl)} · ${state.xp} ${t.xpLabel} · 🔥 ${state.streak.count}-day streak`);
      }
      break;
    }
    case 'UserPromptSubmit':
      ses.combo = 0;
      ses.turnXp = 0;
      set('thinking');
      break;
    case 'PreToolUse': {
      const name = input.tool_name || '';
      set(L.modeForTool(name), L.describeTool(name, input.tool_input));
      break;
    }
    case 'PostToolUse': {
      const mode = L.modeForTool(input.tool_name);
      state.tools[mode] = (state.tools[mode] || 0) + 1;
      ses.combo += 1;
      const xp = (L.TOOL_XP[mode] || 1) + Math.floor(ses.combo / 10); // combo bonus
      gain(xp);
      ses.turnXp = (ses.turnXp || 0) + xp;
      set('thinking');
      break;
    }
    case 'PostToolUseFailure':
      ses.hp = Math.max(0, ses.hp - 10);
      ses.combo = 0;
      set('hurt', input.tool_name || '');
      if (ses.hp === 0) {
        toasts.push(`💀 HP depleted! Respawning at full health…`);
        ses.hp = 100;
      }
      break;
    case 'SubagentStart': {
      const id = input.agent_id || input.subagent_id || String(now);
      ses.party[id] = { type: input.agent_type || input.subagent_type || 'agent', since: now };
      state.tools.summoning = (state.tools.summoning || 0) + 1;
      gain(L.TOOL_XP.summoning);
      set('summoning', input.agent_type || '');
      if (cfg.toasts) toasts.push(`🌀 ${partyJoin(cfg, ses.party[id].type)} (${Object.keys(ses.party).length} in ${t.party})`);
      break;
    }
    case 'SubagentStop': {
      const id = input.agent_id || input.subagent_id;
      if (id && ses.party[id]) delete ses.party[id];
      else delete ses.party[Object.keys(ses.party)[0]];
      gain(5);
      break;
    }
    case 'Notification':
      set('waiting', input.message ? String(input.message).slice(0, 40) : '');
      break;
    case 'PreCompact':
      set('planning', 'compacting memories');
      break;
    case 'Stop': {
      state.quests += 1;
      ses.hp = Math.min(100, ses.hp + 20);
      const bonus = 10;
      gain(bonus);
      const earned = (ses.turnXp || 0) + bonus;
      set('victory');
      if (cfg.toasts) toasts.push(`🏆 ${t.modes.victory.verb} +${earned} ${t.xpLabel}${ses.combo >= 10 ? ` · combo x${ses.combo}` : ''}`);
      ses.turnXp = 0;
      break;
    }
    default:
      return;
  }

  const levelAfter = L.levelFor(state.xp);
  if (levelAfter > levelBefore) toasts.push(`⬆️  LEVEL UP! Lv ${levelAfter} — you are now a ${title(t, levelAfter)}!`);
  for (const a of L.unlock(state, ses)) toasts.push(`🏅 Achievement unlocked: ${a.name} — ${a.desc}`);

  L.saveState(state);
  if (toasts.length) process.stdout.write(JSON.stringify({ systemMessage: toasts.join('\n') }));
}

const title = L.titleFor;

function partyJoin(cfg, type) {
  const lines = {
    rpg: `A wild ${type} joined your party!`,
    space: `${type} drone launched!`,
    retro: `${String(type).toUpperCase()} HAS ENTERED THE GAME`,
  };
  return lines[cfg.theme] || lines.rpg;
}

try { main(); } catch { /* never break the session */ }
process.exit(0);
