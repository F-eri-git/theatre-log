#!/usr/bin/env python3
"""Icon generator: a claret-gradient rounded square with a gold ticket stub
and a star, matching the app's tokens.css palette (claret / gold / paper).
Supersampled 4x then downscaled for anti-aliased edges. Not used at runtime —
run once, then icons/*.png is what the app ships."""
import numpy as np
from PIL import Image, ImageDraw

DESIGN = 512
SUPERSAMPLE = 4

CLARET_TOP = (168, 45, 60)
CLARET_BOTTOM = (122, 23, 36)
PAPER = (247, 243, 236)
GOLD = (196, 148, 64)
GOLD_LIGHT = (224, 184, 102)


def linear_gradient(size, c1, c2, x0, y0, x1, y1):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
    dx, dy = (x1 - x0), (y1 - y0)
    length2 = dx * dx + dy * dy
    t = ((xx - x0) * dx + (yy - y0) * dy) / length2
    t = np.clip(t, 0, 1)
    out = np.empty((size, size, 3), dtype=np.uint8)
    for i in range(3):
        out[:, :, i] = (c1[i] + (c2[i] - c1[i]) * t).astype(np.uint8)
    return Image.fromarray(out, 'RGB')


def star_points(cx, cy, r_outer, r_inner, rotation=-90):
    import math
    pts = []
    for i in range(10):
        ang = math.radians(rotation + i * 36)
        r = r_outer if i % 2 == 0 else r_inner
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return pts


def render(size):
    S = size * SUPERSAMPLE
    scale = S / DESIGN

    def pt(x, y):
        return (x * scale, y * scale)

    def rounded_square_mask(margin, radius):
        m = Image.new('L', (S, S), 0)
        ImageDraw.Draw(m).rounded_rectangle(
            [pt(margin, margin), pt(DESIGN - margin, DESIGN - margin)],
            radius=radius * scale, fill=255)
        return m

    def poly_mask(points):
        m = Image.new('L', (S, S), 0)
        ImageDraw.Draw(m).polygon([pt(x, y) for x, y in points], fill=255)
        return m

    bg = linear_gradient(S, CLARET_TOP, CLARET_BOTTOM, 0, 0, 0, S).convert('RGBA')
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    img.paste(bg, (0, 0), rounded_square_mask(0, 110))

    # Ticket stub: paper rounded rect with notch circles cut from each long edge.
    stub_w, stub_h, stub_r = 300, 190, 22
    sx0, sy0 = (DESIGN - stub_w) / 2, (DESIGN - stub_h) / 2 + 8
    sx1, sy1 = sx0 + stub_w, sy0 + stub_h
    stub = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(stub)
    d.rounded_rectangle([pt(sx0, sy0), pt(sx1, sy1)], radius=stub_r * scale, fill=255)
    notch_r = 26
    for ny in (sy0, sy1):
        d.ellipse([pt(sx0 - notch_r, ny - notch_r), pt(sx0 + notch_r, ny + notch_r)], fill=0)
        d.ellipse([pt(sx1 - notch_r, ny - notch_r), pt(sx1 + notch_r, ny + notch_r)], fill=0)
    img.paste(Image.new('RGBA', (S, S), PAPER), (0, 0), stub)

    # Dashed perforation line, a third of the way across the stub.
    perf_x = sx0 + stub_w * 0.36
    dash_len, gap_len = 10, 8
    y = sy0 + 16
    dash_w = 5 * scale
    while y < sy1 - 16:
        d2 = ImageDraw.Draw(img)
        d2.line([pt(perf_x, y), pt(perf_x, min(y + dash_len, sy1 - 16))], fill=GOLD, width=int(dash_w))
        y += dash_len + gap_len

    # Gold star on the right-hand side of the stub.
    star_cx, star_cy = sx0 + stub_w * 0.68, sy0 + stub_h * 0.5
    star = poly_mask(star_points(star_cx, star_cy, 62, 25))
    img.paste(Image.new('RGBA', (S, S), GOLD), (0, 0), star)

    return img.convert('RGB').resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    for size in (180, 192, 512):
        render(size).save(f'icon-{size}.png')
        print(f'wrote icon-{size}.png')
