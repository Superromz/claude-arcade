#!/usr/bin/env node
// Which image protocols does this terminal show? Prints the same test square
// four ways; tell us which ones you can see.
//   node tools/image-test.js
'use strict';

const zlib = require('zlib');
const H = require('../plugins/claude-arcade/scripts/hd.js');

const S = 72;
const { rgba } = H.testImage(S);
const out = process.stdout;
const say = (s) => out.write(`${s}\r\n`);

// 1. Kitty graphics protocol (APC), raw RGBA + zlib, as the game uses.
say('\r\n1) Kitty (APC, RGBA):');
out.write(H.kittyTransmit(rgba, S, S, { id: 7101, cols: 12, rows: 6 }));
say('\r\n'.repeat(6));

// 2. Kitty graphics protocol with a PNG payload (f=100), no compression flag.
say('2) Kitty (APC, PNG):');
{
  const b64 = H.png(rgba, S, S).toString('base64');
  const parts = b64.match(/.{1,4096}/g);
  parts.forEach((p, i) => out.write(`\x1b_G${i === 0 ? `a=T,f=100,i=7102,c=12,r=6,q=2,` : ''}m=${i < parts.length - 1 ? 1 : 0};${p}\x1b\\`));
}
say('\r\n'.repeat(6));

// 3. iTerm2 inline image (OSC 1337). Warp and WezTerm also read this one.
say('3) iTerm2 (OSC 1337):');
{
  const b64 = H.png(rgba, S, S).toString('base64');
  out.write(`\x1b]1337;File=inline=1;width=12;height=6;preserveAspectRatio=0:${b64}\x07`);
}
say('\r\n');

// 4. Sixel (DCS), 216-color palette.
say('4) Sixel (DCS):');
{
  const q = (v) => Math.round(v / 51); // 0..5
  const idx = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) idx[i] = q(rgba[i * 4]) * 36 + q(rgba[i * 4 + 1]) * 6 + q(rgba[i * 4 + 2]);
  let s = `\x1bP0;1;0q"1;1;${S};${S}`;
  for (let c = 0; c < 216; c++) s += `#${c};2;${Math.round((Math.floor(c / 36) * 51) / 2.55)};${Math.round(((Math.floor(c / 6) % 6) * 51) / 2.55)};${Math.round(((c % 6) * 51) / 2.55)}`;
  for (let band = 0; band < S; band += 6) {
    const used = new Set();
    for (let y = band; y < Math.min(S, band + 6); y++) for (let x = 0; x < S; x++) used.add(idx[y * S + x]);
    for (const c of used) {
      s += `#${c}`;
      for (let x = 0; x < S; x++) {
        let bits = 0;
        for (let k = 0; k < 6 && band + k < S; k++) if (idx[(band + k) * S + x] === c) bits |= 1 << k;
        s += String.fromCharCode(63 + bits);
      }
      s += '$';
    }
    s += '-';
  }
  out.write(s + '\x1b\\');
}
say('\r\n');
say(`Terminal: TERM_PROGRAM=${process.env.TERM_PROGRAM || '-'} TERM=${process.env.TERM || '-'} platform=${process.platform}`);
say('Which numbers show a colored square? (e.g. "3 and 4")');
void zlib;
