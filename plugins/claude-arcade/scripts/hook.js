#!/usr/bin/env node
// Single entry point for every hook event. Updates the game state that the
// status line and game pane animate, logs quest events, and prints toasts.
//
// Only SessionStart, SubagentStart and Stop run in the foreground (they are
// the ones allowed to print toasts). Every other event runs async so Claude
// Code shows no "running hook" lines; level-ups and achievements earned in
// the background are queued and shown at the next foreground event.
// Must never fail or block Claude: every error is swallowed.
'use strict';

const L = require('./lib');
const M = require('./messages');

function main() {
  const input = L.readStdin();
  const event = input.hook_event_name || process.argv[2] || '';
  const cfg = L.loadConfig();
  const t = L.theme(cfg);
  const th = cfg.theme;
  const sid = input.session_id || 'default';
  const toasts = [];

  L.withLock(() => {
    const state = L.loadState();
    const ses = L.session(state, sid);
    state.pending ||= [];
    const levelBefore = L.levelFor(state.xp);
    const now = Date.now();
    const turn = (ses.turn ||= { start: now, fails: 0, xp: 0 });

    // A late background tool event must not wipe the end-of-turn victory pose.
    const settled = ses.mode === 'victory' && now - ses.since < 3000;
    const set = (mode, detail = '') => { if (settled && event.includes('ToolUse')) return; ses.mode = mode; ses.detail = detail; ses.since = now; };
    const gain = (n) => { state.xp += n; ses.xp += n; turn.xp += n; };
    const log = (kind, text, extra = {}) => L.logEvent({ sid, kind, text, ...extra });

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
        const lvl = L.levelFor(state.xp);
        const msg = M.say(th, 'welcome', { lvl, title: L.titleFor(t, lvl), name: '', streak: state.streak.count }).replace(/\s+/g, ' ');
        log('welcome', msg);
        if (input.source === 'startup' || input.source === 'resume') toasts.push(`🎮 ${msg}`);
        break;
      }
      case 'UserPromptSubmit':
        ses.combo = 0;
        ses.turn = { start: now, fails: 0, xp: 0 };
        set('thinking');
        log('prompt', 'A new quest begins…');
        break;
      case 'PreToolUse': {
        const name = input.tool_name || '';
        const mode = L.modeForTool(name);
        const detail = L.describeTool(name, input.tool_input);
        set(mode, detail);
        log('action', `${t.modes[mode].verb}${detail ? ' ' + detail : ''}`, { mode });
        break;
      }
      case 'PostToolUse': {
        const mode = L.modeForTool(input.tool_name);
        state.tools[mode] = (state.tools[mode] || 0) + 1;
        turn[mode] = (turn[mode] || 0) + 1;
        ses.combo += 1;
        gain((L.TOOL_XP[mode] || 1) + Math.floor(ses.combo / 10)); // combo bonus
        if (ses.combo > 0 && ses.combo % 10 === 0) log('combo', `🔥 ${ses.combo}-hit combo!`);
        set('thinking');
        break;
      }
      case 'PostToolUseFailure':
        ses.hp = Math.max(0, ses.hp - 10);
        ses.combo = 0;
        turn.fails += 1;
        set('hurt', input.tool_name || '');
        log('hurt', `💥 ${input.tool_name || 'Something'} backfired! −10 HP`);
        if (ses.hp === 0) {
          ses.hp = 100;
          const msg = M.say(th, 'faint');
          state.pending.push(msg);
          log('faint', msg);
        }
        break;
      case 'SubagentStart': {
        const id = input.agent_id || String(now);
        const type = input.agent_type || 'agent';
        const cls = M.classFor(th, type);
        ses.party[id] = { type, cls: cls.name, icon: cls.icon, since: now };
        state.tools.summoning = (state.tools.summoning || 0) + 1;
        turn.summoning = (turn.summoning || 0) + 1;
        gain(L.TOOL_XP.summoning);
        set('summoning', type);
        const n = Object.keys(ses.party).length;
        const msg = M.say(th, 'summon', { desc: type }, cls.name) + (n > 1 ? ` · ${M.say(th, 'partyFull', { n })}` : '');
        log('summon', msg, { cls: cls.name });
        if (cfg.toasts) toasts.push(msg);
        break;
      }
      case 'SubagentStop': {
        const id = input.agent_id;
        const member = ses.party[id] || ses.party[Object.keys(ses.party)[0]];
        if (id && ses.party[id]) delete ses.party[id];
        else delete ses.party[Object.keys(ses.party)[0]];
        gain(5);
        if (member) log('return', `${member.icon} The ${member.cls} returns with news. +5 ${t.xpLabel}`);
        break;
      }
      case 'Notification':
        set('waiting', input.message ? String(input.message).slice(0, 40) : '');
        log('waiting', `🔔 ${input.message || 'Your hero awaits orders'}`);
        break;
      case 'PreCompact':
        set('planning', 'compacting memories');
        log('compact', '🌙 The hero rests and consolidates memories…');
        break;
      case 'Stop': {
        state.quests += 1;
        ses.hp = Math.min(100, ses.hp + 20);
        gain(10);
        const secs = Math.round((now - turn.start) / 1000);
        const tools = Object.keys(L.TOOL_XP).reduce((n, k) => n + (turn[k] || 0), 0);
        let msg;
        if (tools <= 1) msg = M.say(th, 'questQuick', { xp: turn.xp });
        else {
          const summary = `${M.turnSummary(th, turn)}. +${turn.xp} ${t.xpLabel} in ${fmtTime(secs)}.`;
          const bonus = turn.fails ? M.say(th, 'scarred', { hits: turn.fails === 1 ? '1 hit' : turn.fails + ' hits' }) : M.say(th, 'flawless');
          msg = `${M.say(th, 'quest', { summary })} ${bonus}`;
        }
        set('victory');
        log('quest', msg);
        if (cfg.toasts) toasts.push(`🏆 ${msg}`);
        break;
      }
      default:
        return;
    }

    const levelAfter = L.levelFor(state.xp);
    if (levelAfter > levelBefore) {
      const msg = M.say(th, 'levelUp', { lvl: levelAfter, title: L.titleFor(t, levelAfter) });
      state.pending.push(msg);
      log('level', msg);
    }
    for (const a of L.unlock(state, ses)) {
      const msg = M.say(th, 'achievement', { name: a.name, desc: a.desc });
      state.pending.push(msg);
      log('achievement', msg);
    }

    // Foreground events flush everything queued by background ones.
    if (['SessionStart', 'SubagentStart', 'Stop'].includes(event)) {
      if (cfg.toasts) toasts.push(...state.pending);
      state.pending = [];
    }
    L.saveState(state);
  });

  if (toasts.length) process.stdout.write(JSON.stringify({ systemMessage: toasts.join('\n') }));
}

function fmtTime(s) { return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; }

try { main(); } catch { /* never break the session */ }
process.exit(0);
