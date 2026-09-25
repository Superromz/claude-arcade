# Dev-only: render a game.js --snapshot (ANSI truecolor text) to a PNG so you can look at it.
# Usage: python tools/ansi2png.py snapshot.txt out.png   (needs Pillow)
import re, sys
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
text = open(src, encoding='utf-8').read()
lines = text.rstrip('\n').split('\n')
CW, CH = 8, 16
cols = 0
parsed = []
tok = re.compile(r'\x1b\[([0-9;?]*)([A-Za-z])|(.)', re.S)
for line in lines:
    fg, bg, cells = (220, 220, 220), (0, 0, 0), []
    for m in tok.finditer(line):
        if m.group(3) is not None:
            cells.append((m.group(3), fg, bg))
            continue
        if m.group(2) != 'm':
            continue
        p = [int(x) if x else 0 for x in m.group(1).split(';')]
        i = 0
        while i < len(p):
            if p[i] == 0: fg, bg = (220, 220, 220), (0, 0, 0)
            elif p[i] == 38 and p[i+1] == 2: fg = tuple(p[i+2:i+5]); i += 4
            elif p[i] == 48 and p[i+1] == 2: bg = tuple(p[i+2:i+5]); i += 4
            i += 1
    parsed.append(cells)
    cols = max(cols, len(cells))
img = Image.new('RGB', (cols * CW, len(parsed) * CH))
d = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype('consola.ttf', 14)
except Exception:
    font = ImageFont.load_default()
eighths = ' ▏▎▍▌▋▊▉'
for r, cells in enumerate(parsed):
    for c, (ch, fg, bg) in enumerate(cells):
        x, y = c * CW, r * CH
        d.rectangle([x, y, x + CW - 1, y + CH - 1], fill=bg)
        if ch == '▀': d.rectangle([x, y, x + CW - 1, y + CH // 2 - 1], fill=fg)
        elif ch == '█': d.rectangle([x, y, x + CW - 1, y + CH - 1], fill=fg)
        elif ch in eighths and ch != ' ': d.rectangle([x, y, x + eighths.index(ch) - 1, y + CH - 1], fill=fg)
        elif ch != ' ': d.text((x, y), ch, fill=fg, font=font)
img.save(out)
print(img.size)
