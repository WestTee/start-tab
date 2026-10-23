"""Generate the extension icons (a 2x2 tile grid) at every size the manifest needs."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'src' / 'icons'
BG, TILE = (53, 61, 47, 255), (167, 192, 128, 255)

for size in (16, 32, 48, 128):
    s = size * 8  # draw large, downsample for smooth edges
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=s // 5, fill=BG)
    pad, gap = s * 0.2, s * 0.08
    cell = (s - 2 * pad - gap) / 2
    for row in range(2):
        for col in range(2):
            x, y = pad + col * (cell + gap), pad + row * (cell + gap)
            d.rounded_rectangle((x, y, x + cell, y + cell), radius=cell / 4, fill=TILE)
    img.resize((size, size), Image.LANCZOS).save(OUT / f'icon-{size}.png')
