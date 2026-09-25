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
const C = require('./character');
const G = require('./guild');

// Show the request in the game pane and wait for Y/N there. With no game
// running, approvals turned off, or no answer in time, print nothing so
// Claude Code shows its normal permission dialog.
function approvalInGame(input, cfg) {
  if (cfg.approveInGame === false || !L.gameAlive()) return;
  const fs = require('fs'), path = require('path');
  const id = `${Date.now().toString(36)}-${process.pid}`;
  const req = path.join(L.APPROVALS_DIR, `${id}.req.json`);
  const ans = path.join(L.APPROVALS_DIR, `${id}.answer.json`);
  L.writeJSON(req, { id, pid: process.pid, sid: input.session_id, t: Date.now(), tool: input.tool_name, input: input.tool_input || {}, cwd: input.cwd || '' });
  const deadline = Date.now() + 90 * 1000;
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  let answer = null;
  while (Date.now() < deadline && !answer) {
    answer = L.readJSON(ans, null);
    if (!answer) { if (!L.gameAlive()) break; sleep(150); }
  }
  for (const f of [req, ans]) try { fs.unlinkSync(f); } catch {}
  if (!answer || !['allow', 'deny'].includes(answer.behavior)) return;
  L.logEvent({ sid: input.session_id, kind: answer.behavior === 'allow' ? 'combo' : 'hurt', text: `${answer.behavior === 'allow' ? '⚔ Allowed' : '✖ Denied'} in game: ${input.tool_name}` });
  const decision = { behavior: answer.behavior };
  if (answer.behavior === 'deny') decision.message = 'The user denied this from the Claude Arcade game pane.';
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }));
}

function main() {
  const input = L.readStdin();
  const event = input.hook_event_name || process.argv[2] || '';
  const cfg = L.loadConfig();
  if (event === 'PermissionRequest') return approvalInGame(input, cfg);
  const t = L.theme(cfg);
  const th = cfg.theme;
  const sid = input.session_id || 'default';
  const hero = C.getCharacter(cfg);
  const toasts = [];

  L.withLock(() => {
    const state = L.loadState();
    const ses = L.session(state, sid);
    const proj = L.project(state, input.cwd);
    if (proj) ses.project = proj.path;
    state.pending ||= [];
    const levelBefore = L.levelFor(state.xp);
    const now = Date.now();
    const turn = (ses.turn ||= { start: now, fails: 0, xp: 0 });

    // A late background tool event must not wipe the end-of-turn victory pose.
    const settled = ses.mode === 'victory' && now - ses.since < 3000;
    const set = (mode, detail = '') => { if (settled && event.includes('ToolUse')) return; ses.mode = mode; ses.detail = detail; ses.since = now; };
    const gain = (n) => { state.xp += n; ses.xp += n; turn.xp += n; if (proj) proj.xp += n; };
    const log = (kind, text, extra = {}) => L.logEvent({ sid, kind, text, ...extra });

    // XP from real token usage, read incrementally from the transcripts.
    const addTokens = (file, key) => {
      state.offsets ||= {};
      state.tokens ||= { input: 0, output: 0 };
      const u = C.readTokens(file, state.offsets, key);
      if (!u.input && !u.output) return 0;
      state.tokens.input += u.input;
      state.tokens.output += u.output;
      if (proj) { proj.tokens.input += u.input; proj.tokens.output += u.output; }
      const earned = C.tokenXp(state.tokens) - (state.tokenXp || 0);
      state.tokenXp = (state.tokenXp || 0) + earned;
      gain(earned);
      return earned;
    };
    switch (event) {
      case 'SessionStart': {
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(now - 864e5).toISOString().slice(0, 10);
        if (state.streak.day !== today) {
          state.streak.count = state.streak.day === yesterday ? state.streak.count + 1 : 1;
          state.streak.day = today;
        }
        L.pruneSessions(state);
        if (proj && (input.source === 'startup' || input.source === 'resume')) proj.sessions += 1;
        set('idle');
        const lvl = L.levelFor(state.xp);
        const msg = M.say(th, 'welcome', { lvl, title: L.titleFor(t, lvl), name: '', streak: state.streak.count }).replace(/\s+/g, ' ');
        log('welcome', msg);
        if (cfg.toasts && (input.source === 'startup' || input.source === 'resume')) toasts.push(`🎮 ${msg}`);
        break;
      }
      case 'UserPromptSubmit': {
        // Background agent/task notifications arrive as synthetic prompts; they
        // continue the current quest instead of starting a new one.
        const synthetic = /^\s*</.test(String(input.prompt || ''));
        set('thinking');
        if (synthetic) break;
        ses.combo = 0;
        ses.turn = { start: now, fails: 0, xp: 0 };
        log('prompt', `New quest: ${String(input.prompt || '').replace(/\s+/g, ' ').slice(0, 60)}`);
        break;
      }
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
        // Summons are counted once, when the agent actually joins (SubagentStart).
        if (/^(Agent|Task)$/.test(input.tool_name || '')) { set('thinking'); break; }
        state.tools[mode] = (state.tools[mode] || 0) + 1;
        if (proj) proj.tools[mode] = (proj.tools[mode] || 0) + 1;
        turn[mode] = (turn[mode] || 0) + 1;
        ses.combo += 1;
        gain(C.xpFor(hero, mode, L.TOOL_XP[mode] || 1, ses.combo)); // class + combo bonus
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
        const cls = M.classFor(th, type, id);
        ses.party[id] = { type, cls: cls.id, name: cls.name, icon: cls.icon, since: now };
        state.tools.summoning = (state.tools.summoning || 0) + 1;
        if (proj) proj.tools.summoning = (proj.tools.summoning || 0) + 1;
        turn.summoning = (turn.summoning || 0) + 1;
        gain(C.xpFor(hero, 'summoning', L.TOOL_XP.summoning, ses.combo || 0)); // Warlocks get +50%
        set('summoning', type);
        const n = Object.keys(ses.party).length;
        const msg = M.say(th, 'summon', { desc: type }, cls.name) + (n > 1 ? ` · ${M.say(th, 'partyFull', { n })}` : '');
        log('summon', msg, { cls: cls.name });
        if (cfg.toasts) toasts.push(msg);
        break;
      }
      case 'SubagentStop': {
        const id = input.agent_id;
        const member = id ? ses.party[id] : null;
        if (!member) break; // unknown agent: nothing to remove, no XP
        delete ses.party[id];
        gain(5);
        if (input.agent_transcript_path) addTokens(input.agent_transcript_path, `agent:${input.agent_id}`);
        if (member) log('return', `${member.icon} The ${member.name || member.cls} returns with news. +5 ${t.xpLabel}`);
        // The Guild: the departing agent may ask to join, and active recruits
        // of the same class earn companion XP (never hero XP).
        if (member) {
          const { offer, levelUps } = G.onSubagentStop(state, member, id, now);
          for (const g of levelUps) {
            const msg = `⭐ ${g.name} the ${C.CLASSES[g.cls].name} reached guild level ${g.level}!`;
            log('summon', msg);
            if (cfg.toasts) state.pending.push(msg);
          }
          if (offer) {
            const msg = `🤝 ${offer.name} the ${C.CLASSES[offer.cls].name} wants to join your guild! Accept in the game's Guild tab.`;
            log('summon', msg, { cls: C.CLASSES[offer.cls].name });
            // SubagentStop runs in the background: queue the toast for the next foreground event.
            if (cfg.toasts) state.pending.push(msg);
          }
        }
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
        if (proj) proj.quests += 1;
        ses.hp = Math.min(100, ses.hp + 20);
        gain(10);
        const tokXp = addTokens(input.transcript_path, sid);
        if (tokXp) turn.tokens = tokXp;
        const secs = Math.round((now - turn.start) / 1000);
        const tools = Object.keys(L.TOOL_XP).reduce((n, k) => n + (turn[k] || 0), 0);
        let msg;
        if (tools <= 1) msg = M.say(th, 'questQuick', { xp: turn.xp }) + (turn.tokens ? ` (${turn.tokens} from tokens)` : '');
        else {
          const summary = `${M.turnSummary(th, turn)}. +${turn.xp} ${t.xpLabel}${turn.tokens ? ` (${turn.tokens} from tokens)` : ''} in ${fmtTime(secs)}.`;
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
      // Hooks run in their own process, so point C.SPELLS at the hero's class kit.
      C.setClass((hero || {}).cls);
      const pts = levelAfter - levelBefore;
      state.pending.push(`✦ +${pts} skill point${pts > 1 ? 's' : ''}. Spend them on the Skills tab.`);
      for (const sp of C.SPELLS.filter((x) => x.lvl > levelBefore && x.lvl <= levelAfter && x.lvl > 1)) {
        const learn = `📖 New skill learned: ${sp.name}!`;
        state.pending.push(learn);
        log('level', learn);
      }
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
