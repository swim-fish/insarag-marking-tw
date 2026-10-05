#!/usr/bin/env python3
"""Build an A5 PDF, SVG pages and editable previews from the controlled source."""
import argparse
import csv
import hashlib
import html
import json
import re
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
W, H = 419.53, 595.28
INK, MUTED, ORANGE, LIGHT = '#183343', '#52636b', '#b94612', '#fff4e9'
S1 = 'https://insarag.org/wp-content/uploads/2021/06/INSARAG20Guidelines20Vol20II2C20Man20B.pdf'
S3 = 'https://insarag.org/wp-content/uploads/2021/06/INSARAG20Guidelines20Vol20III.pdf'
S4 = 'https://insarag.org/methodology/insarag-guidelines/'
STE = 'https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf'


class Page:
    """Store vector primitives once for identical PDF and SVG rendering."""
    def __init__(self):
        self.ops = []

    def text(self, x, y, text, size=12, color=INK, bold=False, align='left'):
        self.ops.append(dict(kind='text', x=x, y=y, text=text, size=size,
                             color=color, bold=bold, align=align))

    def line(self, x1, y1, x2, y2, color=INK, width=1.5):
        self.ops.append(dict(kind='line', x1=x1, y1=y1, x2=x2, y2=y2,
                             color=color, width=width))

    def rect(self, x, y, w, h, fill='none', stroke=INK, width=1):
        self.ops.append(dict(kind='rect', x=x, y=y, w=w, h=h,
                             fill=fill, stroke=stroke, width=width))

    def polygon(self, points, fill='none', stroke=INK, width=1):
        self.ops.append(dict(kind='polygon', points=points, fill=fill,
                             stroke=stroke, width=width))

    def paragraph(self, x, y, text, max_width=367, size=11, leading=17,
                  color=INK, bold=False):
        # Keep Latin tokens together, while permitting Chinese line breaking.
        tokens = re.findall(r'[A-Za-z0-9][A-Za-z0-9_./–-]*|.', text)
        current = ''
        for token in tokens:
            if pdfmetrics.stringWidth(current + token, 'JHB' if bold else 'JH', size) > max_width and current:
                self.text(x, y, current, size, color, bold)
                y += leading
                current = token.lstrip()
            else:
                current += token
        if current:
            self.text(x, y, current, size, color, bold)
            y += leading
        return y

    def arrow(self, x1, y1, x2, y2, color=ORANGE, width=2.5, head=8):
        dx, dy = x2-x1, y2-y1
        length = (dx*dx+dy*dy)**0.5
        ux, uy = dx/length, dy/length
        bx, by = x2-ux*head, y2-uy*head
        self.line(x1, y1, bx, by, color, width)
        self.polygon([(x2, y2), (bx-uy*head*0.55, by+ux*head*0.55), (bx+uy*head*0.55, by-ux*head*0.55)],
                     fill=color, stroke='none')

    def struck(self, x, y, text, size=12, color=ORANGE, bold=True):
        # Centred text with a strike line, as used when a victim count is crossed out.
        half = pdfmetrics.stringWidth(text, 'JHB' if bold else 'JH', size)/2
        self.text(x, y, text, size, color, bold, 'center')
        # Slant the line so the hyphen in "L-2" stays readable.
        self.line(x-half-3, y-size*0.55, x+half+3, y+size*0.08, color, 1.6)

    def diamond(self, x, y, letter, radius=32):
        self.polygon([(x, y-radius), (x+radius, y), (x, y+radius), (x-radius, y)],
                     fill=LIGHT, stroke=ORANGE, width=2.5)
        self.text(x, y+12, letter, 34, ORANGE, True, 'center')

    def tape(self, x1, y1, x2, y2):
        dx, dy = x2-x1, y2-y1
        length = (dx*dx+dy*dy)**0.5
        nx, ny = -dy/length*5, dx/length*5
        n = 14
        for i in range(n):
            a, b = i/n, (i+1)/n
            self.polygon([(x1+dx*a+nx, y1+dy*a+ny), (x1+dx*b+nx, y1+dy*b+ny),
                          (x1+dx*b-nx, y1+dy*b-ny), (x1+dx*a-nx, y1+dy*a-ny)],
                         fill='#c82b2b' if i % 2 == 0 else '#ffffff', stroke='none')


def diagrams(p, kind, terms):
    if kind == 'cover':
        for x, symbol, label in [(90, 'C-5', '工作場址'), (210, 'V', '受困者'), (330, 'C', 'RCM（選用）')]:
            if symbol == 'C':
                p.diamond(x, 194, symbol, 43)
            elif symbol == 'V':
                # Victim marking is never boxed; a box would read as a worksite marking.
                p.text(x+8, 222, symbol, 64, ORANGE, True, 'center')
                p.arrow(x-14, 182, x-44, 200)
            else:
                p.rect(x-45, 145, 90, 98, LIGHT, ORANGE, 2)
                p.text(x, 209, symbol, 34, ORANGE, True, 'center')
            p.text(x, 273, label, 12, INK, True, 'center')
        p.text(210, 313, '2020 版規則｜A5 隨身圖解', 15, INK, True, 'center')
    elif kind == 'worksite':
        p.text(210, 135, '危害：瓦斯洩漏', 15, ORANGE, True, 'center')
        p.rect(95, 150, 230, 139, LIGHT, ORANGE, 2.5)
        p.text(210, 206, 'C-5', 43, ORANGE, True, 'center')
        p.text(210, 258, 'AAA-01   ASR 3   05 Oct', 13, ORANGE, True, 'center')
        p.text(210, 314, '分流類別：B', 16, ORANGE, True, 'center')
        # Optional arrow outside the box, after S1 Figure 17.
        p.arrow(86, 282, 50, 306)
        p.text(52, 326, '入口方向', 9.5, ORANGE, False, 'center')
        # S1 p.45: the box is drawn around the painted text, so text comes first.
        p.text(333, 210, '先寫文字', 9.5, MUTED, True)
        p.line(331, 206, 300, 206, MUTED, 0.8)
        p.text(333, 292, '後畫方框', 9.5, MUTED, True)
        p.line(331, 288, 326, 288, MUTED, 0.8)
    elif kind == 'completion':
        for x, label in [(25, '追加紀錄'), (226, '必要工作全部完成')]:
            p.text(x+84, 125, label, 13, INK, True, 'center')
            p.text(x+84, 151, '危害：瓦斯洩漏', 11, ORANGE, False, 'center')
            p.rect(x, 162, 168, 133, LIGHT, ORANGE, 2)
            p.text(x+84, 201, 'C-5', 31, ORANGE, True, 'center')
            p.text(x+84, 240, 'AAA-01  ASR 3  05 Oct', 11, ORANGE, False, 'center')
            p.text(x+84, 272, 'BBB-01  ASR 4  06 Oct', 11, ORANGE, False, 'center')
            p.text(x+84, 315, 'B', 17, ORANGE, True, 'center')
        p.line(218, 215, 403, 215, ORANGE, 3)
    elif kind == 'triage':
        rows = [('A', '確認有生還者；預估作業少於 12 小時'), ('B', '確認有生還者；預估作業超過 12 小時'),
                ('C', '可能有生還者；作業時間未評估'), ('D', '僅有罹難者；作業時間未評估')]
        for i, (letter, body) in enumerate(rows):
            y = 116+i*42
            p.rect(25, y, 370, 37, LIGHT, 'none')
            p.text(46, y+26, letter, 22, ORANGE, True)
            p.text(83, y+24, body, 11.5)
        p.text(25, 310, 'ASR 等級', 14, INK, True)
        for i, key in enumerate(['asr1', 'asr2', 'asr3', 'asr4', 'asr5']):
            p.text(25, 339+i*26, f'ASR {i+1}', 12, ORANGE, True)
            p.text(101, 339+i*26, terms[key]['zh_tw'], 12)
    elif kind == 'victim':
        # L/D entries stack under the V, and the record keeps every crossed-out line (S1 Table 10).
        panels = [(26, 118, '1  可能有受困者', []),
                  (226, 118, '2  確認仍在原位置', [('L-2', False), ('D-1', False)]),
                  (26, 216, '3  移出後更新', [('L-2', True), ('D-1', False), ('L-1', False)]),
                  (226, 216, '4  已知受困者全移出', [('L-2', True), ('D-1', True), ('L-1', True)])]
        for x, y, title, entries in panels:
            cx = x+95
            p.text(x, y, title, 11, INK, True)
            p.text(cx, y+42, 'V', 36, ORANGE, True, 'center')
            p.arrow(cx-20, y+24, cx-52, y+40, width=2)
            for n, (value, crossed) in enumerate(entries):
                if crossed:
                    p.struck(cx, y+61+n*16, value, 12)
                else:
                    p.text(cx, y+61+n*16, value, 12, ORANGE, True, 'center')
        p.text(25, 336, 'L：生還者　D：罹難者　數字：剩餘人數　箭頭：選用', 11, INK, True)
    elif kind == 'rcm':
        for x, letter, label in [(116, 'C', '無生還者或罹難者留在原位置'), (305, 'D', '僅有罹難者留在原位置')]:
            # Team ID and date go immediately below the diamond (S1 §6.3.4).
            p.diamond(x, 150, letter, 31)
            p.text(x, 197, 'AAA-01', 10, ORANGE, False, 'center')
            p.text(x, 210, '05 Oct', 10, ORANGE, False, 'center')
            p.text(x, 230, label, 10.5, INK, True, 'center')
        p.text(26, 271, '罹難者全移出後', 12, INK, True)
        p.text(26, 291, '原 D 保留；新 C 放旁邊', 10, INK)
        p.diamond(236, 275, 'D', 26)
        p.diamond(320, 275, 'C', 26)
        for x, team, day in [(236, 'AAA-01', '05 Oct'), (320, 'BBB-01', '06 Oct')]:
            p.text(x, 316, team, 9, ORANGE, False, 'center')
            p.text(x, 328, day, 9, ORANGE, False, 'center')
    elif kind == 'orientation':
        p.rect(108, 139, 204, 160, LIGHT, ORANGE, 2)
        p.line(210, 139, 210, 299, ORANGE, 1)
        p.line(108, 219, 312, 219, ORANGE, 1)
        for x, y, label in [(160, 192, 'B'), (262, 192, 'C'), (160, 274, 'A'), (262, 274, 'D')]:
            p.text(x, y, label, 28, ORANGE, True, 'center')
        p.rect(185, 195, 50, 48, '#ffffff', ORANGE, 2)
        p.text(210, 232, 'E', 25, ORANGE, True, 'center')
        for x, y, label in [(210, 127, '第 3 面'), (58, 225, '第 2 面'), (363, 225, '第 4 面'), (210, 324, '第 1 面／街道正面')]:
            p.text(x, y, label, 12, INK, True, 'center')
    elif kind == 'floors':
        p.text(80, 124, 'INSARAG', 13, INK, True)
        p.text(272, 124, '臺灣常見標示', 13, INK, True)
        for i, (a, b) in enumerate([('Floor 2', '3F'), ('Floor 1', '2F'), ('Ground Floor', '1F'), ('Basement 1', 'B1')]):
            y = 140+i*47
            p.rect(26, y, 367, 41, LIGHT if i == 2 else '#f0f4f6', 'none')
            p.text(45, y+27, a, 15, ORANGE if i == 2 else INK, i == 2)
            p.text(234, y+27, '→', 16)
            p.text(323, y+27, b, 17, INK, True, 'center')
    elif kind == 'cordons':
        p.rect(26, 140, 167, 144, '#f0f4f6', 'none')
        p.rect(226, 140, 167, 144, '#f0f4f6', 'none')
        # Posts and ground line after S1 Figures 15-16: one horizontal tape, or two crossed tapes.
        for left in (26, 226):
            p.line(left+12, 268, left+155, 268, MUTED, 1.2)
            for post in (left+22, left+145):
                p.rect(post-2, 160, 4, 108, '#ffffff', MUTED, 0.8)
        p.tape(50, 172, 169, 172)
        p.tape(250, 166, 369, 260)
        p.tape(250, 260, 369, 166)
        p.text(110, 316, '作業工作區', 15, INK, True, 'center')
        p.text(310, 316, '禁止進入區', 15, INK, True, 'center')
    elif kind == 'signals':
        # Each detail line sits directly under its own title, with bars on the title row.
        rows = [(130, '撤離', '3 短音；每音約 1 秒；重複', [(180, 33), (235, 33), (290, 33)]),
                (200, '停止作業', '1 長音；約 3 秒；保持安靜', [(180, 144)]),
                (270, '恢復作業', '1 長音 + 1 短音', [(180, 105), (310, 33)])]
        for i, (y, title, detail, bars) in enumerate(rows):
            if i:
                p.line(26, y-32, 393, y-32, '#ccd6db', 0.7)
            p.text(26, y, title, 15, INK, True)
            p.text(26, y+21, detail, 11.5)
            for x, w in bars:
                p.rect(x, y-14, w, 17, ORANGE, 'none')
        p.text(393, 326, '橫條只表示長短，非時間比例。', 10, MUTED, False, 'right')
    elif kind == 'terminology':
        p.rect(25, 114, 370, 28, INK, 'none')
        p.text(35, 133, '英文／縮寫', 11, '#ffffff', True)
        p.text(224, 133, '本冊固定用詞', 11, '#ffffff', True)
        ids = ['worksite_id', 'team_id', 'triage_category', 'victim_marking', 'live', 'deceased', 'rcm', 'zone', 'exclusion', 'ground', 'evacuate', 'resume']
        for i, key in enumerate(ids):
            row = terms[key]
            y = 142+i*27
            p.rect(25, y, 370, 27, '#f0f4f6' if i % 2 == 0 else '#ffffff', 'none')
            label = {'rcm': 'RCM', 'zone': 'Operational Work Zone'}.get(key, row['english'])
            p.text(35, y+18, label, 10)
            p.text(224, y+18, row['zh_tw'], 11)
    elif kind == 'sources':
        for y, heading, detail in [(126, 'S1｜主要規則', '2020 Volume II, Manual B — Operations'),
                                   (186, 'S2／S3｜號音交叉核對', 'Annex B26／2020 Volume III'),
                                   (246, 'S4／STE｜版本與寫作原則', 'INSARAG 公告／ASD-STE100 Issue 9')]:
            p.text(25, y, heading, 14, INK, True)
            p.text(25, y+23, detail, 10.5, MUTED)
    else:
        raise ValueError(f'Unknown diagram: {kind}')


def compose(data, terms):
    pages = []
    for i, entry in enumerate(data['pages'], 1):
        p = Page()
        p.rect(0, 0, W, H, '#ffffff', 'none')
        p.rect(25, 26, 28, 5, ORANGE, 'none')
        p.text(395, 32, f'{i:02d} / 12', 10, MUTED, False, 'right')
        p.text(25, 64, entry['title'], 20, INK, True)
        p.paragraph(25, 91, entry['kicker'], size=10.5, leading=15)
        diagrams(p, entry['diagram'], terms)
        y = {'triage': 480, 'terminology': 486, 'sources': 318}.get(entry['diagram'], 356)
        for n, text in enumerate(entry['bullets'], 1):
            p.text(25, y, f'{n}.', 11, ORANGE, True)
            y = p.paragraph(44, y, text, max_width=350, size=11, leading=17) + 6
        if entry['notes']:
            y += 3
            p.line(25, y-10, 395, y-10, '#ccd6db', 0.7)
        for text in entry['notes']:
            y = p.paragraph(25, y, text, size=9.5, leading=14, color=MUTED) + 2
        # Sources stay in manual.md and sources.md; the printed page carries no footer.
        if y > 565:
            raise ValueError(f'Page {i} body overflow: {y}')
        pages.append(p)
    return pages


def svg_page(page, number):
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="148mm" height="210mm" viewBox="0 0 {W} {H}" role="img" aria-labelledby="title">',
           f'<title id="title">INSARAG A5 圖解手冊，第 {number} 頁</title>',
           '<desc>依 INSARAG 2020 原件重新繪製。中文採用 STE 原則；不是官方中文版。</desc>']
    metadata = {'version': 'INSARAG 2020', 'verified_on': '2026-10-05',
                'illustrative_examples': True, 'sources': {'S1': S1, 'S3': S3, 'S4': S4, 'STE': STE}}
    out.append('<metadata>'+escape(json.dumps(metadata, ensure_ascii=False))+'</metadata>')
    for op in page.ops:
        k = op['kind']
        if k == 'text':
            anchor = {'left': 'start', 'center': 'middle', 'right': 'end'}[op['align']]
            out.append(f'<text x="{op["x"]}" y="{op["y"]}" font-family="Microsoft JhengHei, Noto Sans CJK TC, sans-serif" font-size="{op["size"]}" font-weight="{700 if op["bold"] else 400}" fill="{op["color"]}" text-anchor="{anchor}">{escape(op["text"])}</text>')
        elif k == 'line':
            out.append(f'<line x1="{op["x1"]}" y1="{op["y1"]}" x2="{op["x2"]}" y2="{op["y2"]}" stroke="{op["color"]}" stroke-width="{op["width"]}"/>')
        elif k == 'rect':
            out.append(f'<rect x="{op["x"]}" y="{op["y"]}" width="{op["w"]}" height="{op["h"]}" fill="{op["fill"]}" stroke="{op["stroke"]}" stroke-width="{op["width"]}"/>')
        else:
            points = ' '.join(f'{x},{y}' for x, y in op['points'])
            out.append(f'<polygon points="{points}" fill="{op["fill"]}" stroke="{op["stroke"]}" stroke-width="{op["width"]}"/>')
    return '\n'.join(out+['</svg>'])+'\n'


def pdf_page(c, page):
    from reportlab.lib.colors import HexColor
    for op in page.ops:
        k = op['kind']
        if k == 'text':
            c.setFont('JHB' if op['bold'] else 'JH', op['size'])
            c.setFillColor(HexColor(op['color']))
            method = {'left': c.drawString, 'center': c.drawCentredString, 'right': c.drawRightString}[op['align']]
            method(op['x'], H-op['y'], op['text'])
        elif k == 'line':
            c.setStrokeColor(HexColor(op['color']))
            c.setLineWidth(op['width'])
            c.line(op['x1'], H-op['y1'], op['x2'], H-op['y2'])
        else:
            fill = op['fill'] != 'none'
            stroke = op['stroke'] != 'none'
            if fill:
                c.setFillColor(HexColor(op['fill']))
            if stroke:
                c.setStrokeColor(HexColor(op['stroke']))
                c.setLineWidth(op['width'])
            if k == 'rect':
                c.rect(op['x'], H-op['y']-op['h'], op['w'], op['h'], fill=int(fill), stroke=int(stroke))
            else:
                path = c.beginPath()
                x, y = op['points'][0]
                path.moveTo(x, H-y)
                for x, y in op['points'][1:]:
                    path.lineTo(x, H-y)
                path.close()
                c.drawPath(path, fill=int(fill), stroke=int(stroke))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--font-dir', type=Path, default=Path('C:/Windows/Fonts'))
    args = ap.parse_args()
    pdfmetrics.registerFont(TTFont('JH', str(args.font_dir/'msjh.ttc'), subfontIndex=0))
    pdfmetrics.registerFont(TTFont('JHB', str(args.font_dir/'msjhbd.ttc'), subfontIndex=0))
    data = json.loads((ROOT/'manual.json').read_text(encoding='utf-8'))
    with (ROOT/'terminology.csv').open(encoding='utf-8', newline='') as f:
        rows = list(csv.DictReader(f))
    terms = {row['id']: row for row in rows}
    pages = compose(data, terms)
    (ROOT/'pages').mkdir(exist_ok=True)
    pdf = ROOT/'insarag-marking-a5-zh-tw.pdf'
    c = canvas.Canvas(str(pdf), pagesize=(W, H), invariant=1, pageCompression=1)
    c.setTitle(data['title'])
    c.setAuthor('INSARAG reference documentation project')
    c.setSubject('Illustrated training handbook based on INSARAG 2020; Chinese STE principles adaptation')
    for i, page in enumerate(pages, 1):
        (ROOT/'pages'/f'{i:02d}.svg').write_text(svg_page(page, i), encoding='utf-8', newline='\n')
        pdf_page(c, page)
        c.bookmarkPage(f'p{i}')
        c.addOutlineEntry(data['pages'][i-1]['title'], f'p{i}', level=0)
        # Last-page source headings are clickable.
        if i == 12:
            c.linkURL(S1, (25, H-154, 395, H-110), relative=0)
            c.linkURL('https://insarag.org/wp-content/uploads/2022/05/INSARAG-Guidelines_Vol-III_Annex-B26_USAR-Team-Marking-System-and-Signalling_200403.docx', (25, H-214, 207, H-170), relative=0)
            c.linkURL(S3, (211, H-214, 395, H-170), relative=0)
            c.linkURL(S4, (25, H-274, 207, H-230), relative=0)
            c.linkURL(STE, (211, H-274, 395, H-230), relative=0)
        c.showPage()
    c.save()
    scene = {'width': W, 'height': H, 'pages': [p.ops for p in pages]}
    (ROOT/'scenes.json').write_text(json.dumps(scene, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    md = [f'# {data["title"]}', '', data['edition'], '',
          '中文採用 ASD-STE100 寫作原則；本冊不是官方中文版，也不宣稱英文 STE 合規或認證。', '']
    for i, entry in enumerate(data['pages'], 1):
        md.extend([f'## {i:02d}｜{entry["title"]}', '', entry['kicker'], '', f'![第 {i} 頁向量圖](pages/{i:02d}.svg)', ''])
        md.extend(f'{n}. {s}' for n, s in enumerate(entry['bullets'], 1))
        md.extend(['', *entry['notes'], '', f'來源：{entry["source"]}。', ''])
    (ROOT/'manual.md').write_text('\n'.join(md), encoding='utf-8', newline='\n')
    table = ['# 中英技術名詞對照表', '', 'TN：技術名詞；TV：技術動詞。均為本專案用詞，不表示 ASD 字典已核准中文譯詞。', '',
             '| ID | 英文 | 臺灣正體中文 | 類型 | 禁用變體 | 依據 | 備註 |', '| --- | --- | --- | --- | --- | --- | --- |']
    for row in rows:
        table.append('| '+' | '.join(row[k].replace('|', '、') for k in ['id', 'english', 'zh_tw', 'kind', 'aliases', 'source', 'note'])+' |')
    (ROOT/'terminology.md').write_text('\n'.join(table)+'\n', encoding='utf-8', newline='\n')
    gallery = '\n'.join(f'<section><h2>{i:02d} {html.escape(e["title"])}</h2><img src="pages/{i:02d}.svg" alt="{html.escape(e["title"])}"></section>' for i, e in enumerate(data['pages'], 1))
    page = '''<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>INSARAG A5 手冊</title><style>body{margin:0;background:#e8eef0;color:#183343;font-family:"Microsoft JhengHei",sans-serif}header{padding:24px;max-width:1000px;margin:auto}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;padding:24px;max-width:1200px;margin:auto}section{min-width:0}h2{font-size:15px}img{width:100%;box-shadow:0 3px 14px #18334326}a{color:#b94612}@media print{body{background:white}header,h2{display:none}main{display:block;padding:0}section{break-after:page}img{box-shadow:none;width:148mm;height:210mm}@page{size:A5;margin:0}}</style><header><h1>INSARAG 標記圖解速查手冊</h1><p>2020 版規則｜12 頁 A5｜臺灣正體中文</p><p><a href="insarag-marking-a5-zh-tw.pdf">下載 PDF</a> · <a href="manual.md">可編輯文字</a> · <a href="terminology.md">中英對照表</a> · <a href="../sources/README.md">原件與規則對照</a></p></header><main>'''+gallery+'</main></html>\n'
    (ROOT/'preview.html').write_text(page, encoding='utf-8', newline='\n')
    outputs = [pdf, ROOT/'scenes.json', ROOT/'manual.md', ROOT/'terminology.md', ROOT/'preview.html', *sorted((ROOT/'pages').glob('*.svg'))]
    manifest = {'format': 1, 'page_count': len(pages), 'page_mm': [148, 210],
                'inputs': {str(p.relative_to(ROOT)).replace('\\', '/'): sha(p) for p in [ROOT/'manual.json', ROOT/'terminology.csv', Path(__file__)]},
                'outputs': {str(p.relative_to(ROOT)).replace('\\', '/'): sha(p) for p in outputs}}
    (ROOT/'build-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Built {len(pages)} A5 pages: {pdf}')


if __name__ == '__main__':
    main()
