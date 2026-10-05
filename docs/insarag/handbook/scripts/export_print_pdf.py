#!/usr/bin/env python3
"""Export 300 dpi RGB and CMYK print PDFs from the verified A5 handbook PDF.

Each page is rasterised at the requested resolution and placed on an A5 page
with lossless (Flate) compression. The CMYK file is converted from sRGB with
an ICC output profile, so black generation follows the profile instead of a
naive RGB inversion. Outputs go to print/, which is not tracked by git.
"""
import argparse
import io
import json
from datetime import date
from pathlib import Path

import fitz
from PIL import Image, ImageCms

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'insarag-marking-a5-zh-tw.pdf'
DEFAULT_PROFILE = Path('C:/Windows/System32/spool/drivers/color/RSWOP.icm')
A5_POINTS = (419.53, 595.28)


def render(page, dpi):
    pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csRGB, alpha=False)
    return Image.frombytes('RGB', (pix.width, pix.height), pix.samples)


def to_cmyk(image, transform):
    return ImageCms.applyTransform(image, transform)


def add_page(doc, image, size):
    mode = {'RGB': fitz.csRGB, 'CMYK': fitz.csCMYK}[image.mode]
    pix = fitz.Pixmap(mode, image.width, image.height, image.tobytes(), False)
    page = doc.new_page(width=size[0], height=size[1])
    page.insert_image(page.rect, pixmap=pix)


def tag_profile(doc, icc_bytes):
    # PyMuPDF tags CMYK images with its own default profile; embed the profile the data was converted with.
    refs = set()
    for page in doc:
        for image in page.get_images(full=True):
            kind, value = doc.xref_get_key(image[0], 'ColorSpace')
            space = doc.xref_object(int(value.split()[0]), compressed=True) if kind == 'xref' else value
            if '/ICCBased' not in space:
                raise ValueError(f'Unexpected colour space: {space}')
            refs.add(int(space.split('/ICCBased')[1].split()[0]))
    for ref in refs:
        doc.update_stream(ref, icc_bytes, compress=True)
    return len(refs)


def max_ink(image):
    # Total area coverage (TAC) in percent, the sum of C+M+Y+K at the darkest pixel.
    bands = [band.load() for band in image.split()]
    peak = 0
    for y in range(0, image.height, 2):
        for x in range(0, image.width, 2):
            peak = max(peak, sum(b[x, y] for b in bands))
    return round(peak / 255 * 100, 1)


def inspect(path, components, dpi, expected_profile=None):
    doc = fitz.open(path)
    pages = []
    for page in doc:
        images = page.get_images(full=True)
        if len(images) != 1:
            raise ValueError(f'{path.name} p.{page.number+1}: expected one image, found {len(images)}')
        xref, _, width, height, _, space = images[0][:6]
        # RGB may be stored as ICCBased (embedded sRGB); check the channel count instead of the name.
        n = fitz.Pixmap(doc, xref).n
        rect = page.rect
        effective = round(width / (rect.width / 72), 1)
        if n != components or abs(effective - dpi) > 1:
            raise ValueError(f'{path.name} p.{page.number+1}: {space} ({n} channels) at {effective} dpi')
        if abs(rect.width - A5_POINTS[0]) > 0.5 or abs(rect.height - A5_POINTS[1]) > 0.5:
            raise ValueError(f'{path.name} p.{page.number+1}: page is not A5 ({rect.width} x {rect.height})')
        pages.append(dict(page=page.number + 1, pixels=[width, height], colorspace=space, channels=n, dpi=effective))
    profiles = set()
    for xref in range(1, doc.xref_length()):
        obj = doc.xref_object(xref, compressed=True)
        if obj.startswith('[/ICCBased'):
            icc = doc.xref_stream(int(obj.split('/ICCBased')[1].split()[0]))
            profiles.add(ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(icc))).strip())
    if expected_profile and profiles != {expected_profile}:
        raise ValueError(f'{path.name}: embedded profile {profiles}, expected {expected_profile}')
    return dict(file=path.name, pages=len(doc), bytes=path.stat().st_size,
                embedded_profiles=sorted(profiles), detail=pages)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source', type=Path, default=SOURCE)
    ap.add_argument('--out-dir', type=Path, default=ROOT / 'print')
    ap.add_argument('--dpi', type=int, default=300)
    ap.add_argument('--cmyk-profile', type=Path, default=DEFAULT_PROFILE,
                    help='CMYK output ICC profile; use the one your print shop specifies')
    args = ap.parse_args()

    profile = ImageCms.getOpenProfile(str(args.cmyk_profile))
    if profile.profile.xcolor_space.strip() != 'CMYK':
        raise ValueError(f'Not a CMYK profile: {args.cmyk_profile}')
    transform = ImageCms.buildTransform(
        ImageCms.createProfile('sRGB'), profile, 'RGB', 'CMYK',
        renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
        flags=ImageCms.Flags.BLACKPOINTCOMPENSATION)

    args.out_dir.mkdir(exist_ok=True)
    stem = args.source.stem
    rgb_path = args.out_dir / f'{stem}_{args.dpi}dpi_RGB.pdf'
    cmyk_path = args.out_dir / f'{stem}_{args.dpi}dpi_CMYK.pdf'

    source = fitz.open(args.source)
    if source.page_count != 12:
        raise ValueError(f'Expected 12 pages, found {source.page_count}')
    rgb, cmyk, tac = fitz.open(), fitz.open(), []
    for page in source:
        size = (page.rect.width, page.rect.height)
        image = render(page, args.dpi)
        add_page(rgb, image, size)
        converted = to_cmyk(image, transform)
        tac.append(max_ink(converted))
        add_page(cmyk, converted, size)

    profile_name = ImageCms.getProfileDescription(profile).strip()
    tag_profile(cmyk, args.cmyk_profile.read_bytes())
    for doc, path, space in [(rgb, rgb_path, 'sRGB'), (cmyk, cmyk_path, f'CMYK ({profile_name})')]:
        doc.set_metadata({'title': f'{source.metadata.get("title") or stem} ({args.dpi} dpi {space})',
                          'subject': f'Print master rasterised at {args.dpi} dpi from {args.source.name}; {space}',
                          'creator': 'export_print_pdf.py'})
        doc.save(path, garbage=4, deflate=True)

    report = dict(created=date.today().isoformat(), source=args.source.name, dpi=args.dpi,
                  cmyk_profile=str(args.cmyk_profile), cmyk_profile_name=profile_name,
                  rendering_intent='relative colorimetric + black point compensation',
                  max_total_ink_percent=max(tac), max_total_ink_by_page=tac,
                  outputs=[inspect(rgb_path, 3, args.dpi), inspect(cmyk_path, 4, args.dpi, profile_name)])
    (args.out_dir / 'print-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n',
                                                    encoding='utf-8', newline='\n')
    print(json.dumps({k: report[k] for k in ['dpi', 'cmyk_profile_name', 'max_total_ink_percent']}, ensure_ascii=False))
    for out in report['outputs']:
        print(f"{out['file']}: {out['pages']} pages, {out['bytes']/1e6:.1f} MB")


if __name__ == '__main__':
    main()
