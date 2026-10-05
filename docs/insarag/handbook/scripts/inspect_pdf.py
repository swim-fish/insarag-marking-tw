#!/usr/bin/env python3
"""Inspect PDF/SVG layout, vector content and fonts; render review images.

Requires PyMuPDF (fitz) and Pillow. This is separate from the dependency-free
language checker. Visual review of the rendered pages is still necessary.
"""
import argparse
import hashlib
import json
import xml.etree.ElementTree as ET
from pathlib import Path

import fitz
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--render-dir', type=Path, default=ROOT.parents[2]/'work'/'handbook-review')
    ap.add_argument('--report', type=Path, default=ROOT/'layout-report.json')
    args = ap.parse_args()
    args.render_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = ROOT/'insarag-marking-a5-zh-tw.pdf'
    doc = fitz.open(pdf_path)
    findings, records = [], []
    sheet = Image.new('RGB', (1680, 1860), '#dbe3e7')
    embedded = {}
    for i, page in enumerate(doc, 1):
        svg = ROOT/'pages'/f'{i:02d}.svg'
        xml = ET.parse(svg)
        raster = len(page.get_images())
        if raster or any(e.tag.rsplit('}', 1)[-1] == 'image' for e in xml.iter()):
            findings.append(f'Page {i} contains a raster image')
        mm = [page.rect.width*25.4/72, page.rect.height*25.4/72]
        if abs(mm[0]-148) > .02 or abs(mm[1]-210) > .02:
            findings.append(f'Page {i} is not A5: {mm}')
        spans = [s for b in page.get_text('dict')['blocks'] if 'lines' in b for ln in b['lines'] for s in ln['spans']]
        for span in spans:
            x0, y0, x1, y1 = span['bbox']
            if x0 < 15 or x1 > page.rect.width-10 or y0 < 10 or y1 > page.rect.height-3:
                findings.append(f'Page {i} text outside safe bounds: {span["text"]}')
            if '\ufffd' in span['text']:
                findings.append(f'Page {i} contains a replacement character')
        for xref, _, _, name, *_ in page.get_fonts():
            if 'JhengHei' in name:
                _, _, _, font_bytes = doc.extract_font(xref)
                embedded[name] = len(font_bytes)
                if not font_bytes:
                    findings.append(f'Chinese font is not embedded: {name}')
        pix = page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6), alpha=False)
        path = args.render_dir/f'{i:02d}.png'
        pix.save(str(path))
        with Image.open(path) as picture:
            picture.thumbnail((400, 565))
            sheet.paste(picture, (((i-1) % 4)*420+10, ((i-1)//4)*620+25))
        ImageDraw.Draw(sheet).text((((i-1) % 4)*420+10, ((i-1)//4)*620+4), str(i), fill='black')
        records.append(dict(page=i, page_mm=mm, raster_images=raster,
                            text_spans=len(spans), source_links=len(page.get_links())))
    if len(doc) != 12 or not embedded:
        findings.append('Expected 12 pages and embedded Chinese fonts')
    sheet.save(args.render_dir/'contact-sheet.png')
    report = dict(pdf_sha256=hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
                  inspector_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  page_count=len(doc), embedded_chinese_fonts=embedded,
                  pages=records, findings=findings, passed=not findings,
                  visual_review_required=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(json.dumps({'pages': len(doc), 'findings': findings, 'passed': not findings}, ensure_ascii=False))
    return 1 if findings else 0


if __name__ == '__main__':
    raise SystemExit(main())
