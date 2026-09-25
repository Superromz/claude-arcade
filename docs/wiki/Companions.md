# Companions

When Claude launches an agent (a subagent, such as Explore or Plan), it joins your party as a
companion. It fights next to your hero until the agent finishes, then heads home.

## Which class an agent becomes

The agent's type or name decides its class:

| Agent looks like… | Joins as |
|---|---|
| Explore, search, find, scout | Ranger |
| review, audit, security, test, verify, QA | Knight |
| Plan, architect, design, workflow | Warlock |
| guide, docs, research, writing, summaries | Bard |
| debug, fix, bash, shell, ops, deploy | Rogue |
| anything else (for example general-purpose) | One of all six classes, picked from the agent's id |

General-purpose agents are spread across the classes, so a batch of them becomes a mixed party.
That's the only way to get a Mage companion.

## Battle roles

![A mage fighting the Goblin Warlord with three companions](https://raw.githubusercontent.com/Superromz/claude-arcade/main/docs/images/boss.png)

Up to four companions fight on screen at once.

| Class | Role |
|---|---|
| Knight | Taunts monsters and shields your hero. Blocks boss slams |
| Ranger | Looses the first arrow of every wave, with a high crit chance |
| Warlock | Curses a monster for damage over time |
| Bard | Inspires the party: +20% damage for your hero and every companion |
| Rogue | Dashes in for a burst strike that usually crits |
| Mage | Area blasts that hit every nearby monster |

Companions only attack while Claude is working (or during a practice wave).

## Joining and leaving

- When an agent starts, a toast announces it ("A Ranger slips out of the shadows to scout: …") and it
  appears in your party with **+10 XP**.
- The status line shows the party count and icons, and each running agent gets its own row styled as
  a party member, with an action ("scouting", "guarding"…), a stamina bar for how much of its
  context it has used, and a timer.
- When the agent finishes, it "returns with news" and you get **+5 XP**. Tokens the agent used also
  count toward your token XP.

## Where to see them

- **Adventure tab:** companions stand behind your hero and fight. Each one is a smaller version of
  its hero class with its own attack poses. Between tasks they sit with your hero at the camp.
- **Party tab:** a class portrait for each companion, what agent it is and how long it has been out, plus
  "Recent adventures" (who joined and returned).
- **Achievements:** *Party Up* (first agent), *Full Party* (3 agents at once) and *Guild Master*
  (25 agents).

Companions are temporary for now. Recruiting agents as permanent companions who level up and camp
with your hero is on the [Roadmap](Roadmap).

## Keeping companions

Companions leave when their agent finishes, but they can ask to join your **[Guild](Guild)**. Recruits stay with you, fight in every battle, and level up.
