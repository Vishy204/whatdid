"""Render the README GIFs: a terminal where Claude narrates, then `wd` shows the map.

The whatdid output in the GIFs is real: it comes from demo-text.mjs, which runs the actual renderer
on the demo session. Only the "Claude working" lines above it are scripted.

    python assets/src/make_gifs.py        # writes assets/hero.gif and assets/replay.gif
"""
import json
import os
import re
import subprocess
import sys

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'assets')

FONT_DIR = 'C:/Windows/Fonts' if os.name == 'nt' else '/usr/share/fonts'
MONO, MONO_BOLD, SYMBOLS = f'{FONT_DIR}/consola.ttf', f'{FONT_DIR}/consolab.ttf', f'{FONT_DIR}/seguisym.ttf'
SIZE = 15
LINE_H = 20
PAD_X, PAD_Y, TITLE_H = 20, 16, 36

# Palette: GitHub-dark-like terminal with the whatdid accent colours.
BG, TITLE_BG, BORDER = (13, 17, 23), (22, 27, 34), (48, 54, 61)
FG, DIM, FAINT = (230, 237, 243), (125, 133, 144), (72, 79, 88)
CYAN, VIOLET, GREEN, RED = (53, 224, 197), (157, 140, 255), (90, 208, 122), (255, 107, 107)
AMBER, PINK, BLUE, PROMPT = (240, 180, 41), (244, 114, 182), (121, 192, 255), (217, 166, 87)

GLYPH_COLOR = {'◆': CYAN, '◇': VIOLET, '✔': GREEN, '✘': RED, '▲': AMBER, '◌': PINK, '▸': VIOLET, '✎': BLUE, '○': DIM}
LABEL_COLOR = {'why': CYAN, 'found': VIOLET, 'done': GREEN, 'failed': RED, 'risk': AMBER, 'need': PINK, 'plan': VIOLET,
               'changed': BLUE, 'verified': GREEN, 'left': DIM}
HEADINGS = ("What Claude did", "Files", "Claude's notes", "Recap", "recap", "How it connects", "In Claude's words")

mono = ImageFont.truetype(MONO, SIZE)
mono_b = ImageFont.truetype(MONO_BOLD, SIZE)
sym = ImageFont.truetype(SYMBOLS, SIZE - 1)
MONO_CMAP = TTFont(MONO).getBestCmap()
CELL = mono.getlength('M')


def spans(line):
    """Colour a line of terminal text: returns a list of (color, bold) per character."""
    n = len(line)
    col = [FG] * n
    bold = [False] * n

    def paint(a, b, c, bo=False):
        for i in range(max(0, a), min(n, b)):
            col[i] = c
            bold[i] = bo or bold[i]

    for m in re.finditer(r'[│┌└├─]', line):
        paint(m.start(), m.end(), FAINT)
    if line.startswith('>'):
        paint(0, 1, PROMPT, True)
    m = re.match(r'^┌─ (what did(?: replay)?)(.*)$', line)
    if m:
        paint(3, 3 + len(m.group(1)), CYAN, True)
        paint(3 + len(m.group(1)), n, DIM)
    body = re.sub(r'^[│ ]+', '', line)
    off = n - len(body)
    for h in HEADINGS:
        if body.startswith(h):
            paint(off, off + len(h), FG, True)
            paint(off + len(h), n, DIM)
    if body.startswith('Heads up'):
        paint(off, n, AMBER, True)
    if body.startswith('You asked:'):
        paint(off, off + 10, DIM)
    for m in re.finditer(r'([◆◇✔✘▲◌▸✎○])( ?\*{0,2})(why|found|done|failed|risk|need|plan|changed|verified|left)?', line):
        c = GLYPH_COLOR[m.group(1)]
        paint(m.start(1), m.end(1), c, True)
        if m.group(3):
            paint(m.start(3), m.end(3), LABEL_COLOR[m.group(3)], True)
    for m in re.finditer(r'(?<![\w/])\+\d+\b', line):
        paint(m.start(), m.end(), GREEN)
    for m in re.finditer(r'−\d+\b', line):
        paint(m.start(), m.end(), RED)
    for m in re.finditer(r'\+\d{2}:\d{2}', line):  # replay offsets: after the +N rule so they stay dim
        paint(m.start(), m.end(), DIM)
    m = re.search(r'\s(R|R E|E|N)(\s{2,}|$)', line)
    if m and ('.ts' in line or '.js' in line):
        for i in range(m.start(1), m.end(1)):
            paint(i, i + 1, {'R': DIM, 'E': AMBER, 'N': GREEN}.get(line[i], FG), True)
    for m in re.finditer(r'"[^"]*"', line):
        if not body.startswith('You asked'):
            paint(m.start(), m.end(), BLUE)
    if line.lstrip().startswith('└─ ') is False and re.match(r'^\s{2}└─', line):
        paint(0, n, DIM)
    return col, bold


def _center(x):
    return x + CELL / 2, LINE_H / 2 + 1


def _diamond(d, x, c, filled=True):
    cx, cy = _center(x)
    r = 5.2
    pts = [(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)]
    if filled:
        d.polygon(pts, fill=c)
    else:
        d.line(pts + [pts[0], pts[1]], fill=c, width=2, joint='curve')


def _check(d, x, c):
    cx, cy = _center(x)
    d.line([(cx - 4, cy), (cx - 1.2, cy + 3), (cx + 4.2, cy - 4)], fill=c, width=2, joint='curve')


def _cross(d, x, c):
    cx, cy = _center(x)
    d.line([(cx - 3.5, cy - 3.5), (cx + 3.5, cy + 3.5)], fill=c, width=2)
    d.line([(cx - 3.5, cy + 3.5), (cx + 3.5, cy - 3.5)], fill=c, width=2)


def _pencil(d, x, c):
    cx, cy = _center(x)
    d.line([(cx - 3.5, cy + 3.5), (cx + 3.5, cy - 3.5)], fill=c, width=3)
    d.polygon([(cx - 5, cy + 5), (cx - 4.2, cy + 2.2), (cx - 2.2, cy + 4.2)], fill=c)


# Brand glyphs drawn as shapes, matching the logo, instead of borrowing a fallback font.
VECTOR = {'◆': _diamond, '◇': lambda d, x, c: _diamond(d, x, c, False), '✔': _check, '✘': _cross, '✎': _pencil}


class Term:
    def __init__(self, w, h, title):
        self.w, self.h, self.title = w, h, title
        self.rows = (h - TITLE_H - 2 * PAD_Y) // LINE_H
        self.lines = []          # list of (text, style) where style is None or a dict
        self.cache = {}

    def chrome(self):
        img = Image.new('RGB', (self.w, self.h), (0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([0, 0, self.w - 1, self.h - 1], 12, fill=BG, outline=BORDER)
        d.rounded_rectangle([0, 0, self.w - 1, TITLE_H + 10], 12, fill=TITLE_BG)
        d.rectangle([1, TITLE_H - 2, self.w - 2, TITLE_H + 10], fill=BG)
        d.line([1, TITLE_H - 1, self.w - 2, TITLE_H - 1], fill=BORDER)
        for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
            d.ellipse([18 + i * 22, 12, 30 + i * 22, 24], fill=c)
        tw = mono.getlength(self.title)
        d.text(((self.w - tw) / 2, 10), self.title, font=mono, fill=DIM)
        return img

    def draw_line(self, text, style):
        key = (text, json.dumps(style, sort_keys=True))
        if key in self.cache:
            return self.cache[key]
        img = Image.new('RGBA', (self.w - 2 * PAD_X, LINE_H), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        if style and style.get('bg'):
            d.rounded_rectangle([0, 0, img.width - 1, LINE_H - 1], 4, fill=style['bg'])
        colors, bolds = spans(text)
        if style and style.get('dim'):
            colors = [DIM if c == FG else c for c in colors]
        for i, ch in enumerate(text):
            if ch == ' ':
                continue
            x = i * CELL + (style or {}).get('indent', 0)
            if ch in VECTOR:
                VECTOR[ch](d, x, colors[i])
            elif ord(ch) in MONO_CMAP:
                d.text((x, 2), ch, font=mono_b if bolds[i] else mono, fill=colors[i])
            else:
                gw = sym.getlength(ch)
                d.text((x + (CELL - gw) / 2, 2), ch, font=sym, fill=colors[i])
        self.cache[key] = img
        return img

    def frame(self, cursor=False):
        img = self.chrome()
        visible = self.lines[-self.rows:]
        for r, (text, style) in enumerate(visible):
            y = TITLE_H + PAD_Y + r * LINE_H
            img.paste(self.draw_line(text, style), (PAD_X, y), self.draw_line(text, style))
        if cursor and visible:
            r = len(visible) - 1
            x = PAD_X + len(visible[-1][0]) * CELL + 1
            y = TITLE_H + PAD_Y + r * LINE_H + 3
            ImageDraw.Draw(img).rectangle([x, y, x + CELL - 2, y + LINE_H - 6], fill=CYAN)
        return img


class Movie:
    def __init__(self, term):
        self.term, self.frames = term, []

    def snap(self, ms, cursor=False):
        self.frames.append((self.term.frame(cursor), ms))

    def type(self, prefix, text, cps=38, style=None):
        self.term.lines.append((prefix, style))
        step = max(1, round(cps / 25))
        for i in range(0, len(text) + 1, step):
            self.term.lines[-1] = (prefix + text[:i], style)
            self.snap(int(1000 * step / cps), cursor=True)
        self.term.lines[-1] = (prefix + text, style)

    def add(self, text, ms, style=None):
        # Wrap long lines at a " · " like a real terminal would, continuing with a small indent.
        cols = int((self.term.w - 2 * PAD_X) / CELL) - 1
        while len(text) > cols:
            cut = text.rfind(' · ', 0, cols)
            cut = cut if cut > 0 else cols
            self.term.lines.append((text[:cut], style))
            text = '  ' + text[cut:].lstrip(' ·')
        self.term.lines.append((text, style))
        self.snap(ms)

    def hold(self, ms, cursor=False):
        self.snap(ms, cursor)

    def save(self, path):
        # One shared palette keeps colours stable across frames and the file small.
        # Build it from a strip of sampled frames plus swatches of every accent, so no colour gets washed out.
        sample = [f for f, _ in self.frames][::max(1, len(self.frames) // 8)] + [self.frames[-1][0]]
        strip = Image.new('RGB', (self.term.w, self.term.h * len(sample) + 40))
        for i, f in enumerate(sample):
            strip.paste(f, (0, i * self.term.h))
        swatch = ImageDraw.Draw(strip)
        for i, c in enumerate([CYAN, VIOLET, GREEN, RED, AMBER, PINK, BLUE, PROMPT, FG, DIM, FAINT]):
            swatch.rectangle([i * 40, strip.height - 40, i * 40 + 39, strip.height], fill=c)
        pal = strip.quantize(colors=128, method=Image.Quantize.MEDIANCUT)
        out, durs = [], []
        for im, ms in self.frames:
            q = im.quantize(palette=pal, dither=Image.Dither.NONE)
            if out and list(q.getdata()) == list(out[-1].getdata()):
                durs[-1] += ms
                continue
            out.append(q)
            durs.append(ms)
        out[0].save(path, save_all=True, append_images=out[1:], duration=durs, loop=0, optimize=True, disposal=1)
        print(f'{os.path.relpath(path, ROOT)}: {len(out)} frames, {sum(durs) / 1000:.1f}s, {os.path.getsize(path) // 1024} KB')


def demo_text(width):
    node = subprocess.run(['node', os.path.join(HERE, 'demo-text.mjs'), str(width)], capture_output=True, text=True,
                          encoding='utf-8', cwd=ROOT, check=True)
    return json.loads(node.stdout)


CARD_STYLE = {'bg': (22, 38, 44)}
TOOL = {'dim': True}


def claude_working(mv, prompt):
    """The part the user sees today, made readable by the whatdid output style."""
    mv.type('> ', prompt)
    mv.hold(500)
    mv.term.lines.append(('', None))
    script = [
        ('◆ why · find where /login redirects come from', None, 650),
        ('  └─ Search("redirect.*login") · Read routes.ts · Read auth/guard.ts', TOOL, 550),
        ('◆ why · guard trusts isExpired(); check how expiry is computed', None, 650),
        ('  └─ Read auth/session.ts · Read config/auth.ts', TOOL, 550),
        ('◇ found · expiresAt is in seconds but compared to Date.now() in ms', None, 900),
        ('  └─ Update auth/session.ts +3 −2 · Bash npm test -- auth  ✘ 1 failed', TOOL, 700),
        ('◆ why · one test still builds sessions in ms; update the fixture helper', None, 650),
        ('  └─ Update test/helpers/session.ts +1 −1 · Bash npm test -- auth  ✔ 14 passed', TOOL, 700),
        ('✔ done · all 14 auth tests pass', None, 800),
        ('', None, 150),
        ('recap', None, 200),
        ('  ✎ changed  · isExpired() converts expiresAt to ms; fixed the test helper', None, 250),
        ('  ✔ verified · npm test -- auth passes, 14/14', None, 250),
        ('  ○ left     · nothing', None, 700),
    ]
    for text, style, ms in script:
        mv.add(text, ms, style)


def hero():
    data = demo_text(100)
    mv = Movie(Term(960, 720, '~/acme-app — claude'))
    claude_working(mv, 'users get bounced to /login even with a valid session. fix it')
    mv.term.lines.append(('', None))
    for i, line in enumerate(data['card'].split('\n')):
        mv.add(line, 500 if i == 0 else 2200, CARD_STYLE)
    # Cut to a clean screen so the whole map fits in the frame.
    mv.term.lines.clear()
    mv.type('> ', 'wd', cps=6)
    mv.hold(350)
    mv.term.lines.append(('', None))
    for line in data['map'].split('\n'):
        mv.add(line, 55)
    mv.hold(5500)
    mv.save(os.path.join(OUT, 'hero.gif'))


def replay():
    data = demo_text(94)
    mv = Movie(Term(900, 640, '~/acme-app — claude'))
    mv.term.lines.append(('> wd replay', None))
    mv.hold(700)
    mv.term.lines.append(('', None))
    for line in data['replay'].split('\n'):
        mv.add(line, 170 if re.search(r'\+\d\d:\d\d', line) else 50)
    mv.hold(5000)
    mv.save(os.path.join(OUT, 'replay.gif'))


if __name__ == '__main__':
    which = sys.argv[1:] or ['hero', 'replay']
    for name in which:
        globals()[name]()
