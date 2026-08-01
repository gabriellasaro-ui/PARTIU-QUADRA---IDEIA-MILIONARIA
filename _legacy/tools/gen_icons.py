"""Gera os ícones da PWA (quadrado verde + pin branco) em static/icons/.
Uso:  pip install Pillow  &&  python tools/gen_icons.py
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "static", "icons")
OUT = os.path.abspath(OUT)
os.makedirs(OUT, exist_ok=True)

G1 = (31, 138, 66)   # #1f8a42 (verde autoral, topo)
G2 = (12, 67, 33)    # #0c4321 (base)
WHITE = (255, 255, 255)


def gradient(size):
    img = Image.new("RGB", (size, size), G1)
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        c = tuple(int(G1[i] + (G2[i] - G1[i]) * t) for i in range(3))
        d.line((0, y, size, y), fill=c)
    return img


def draw_pin(base, scale, top_factor):
    size = base.size[0]
    cx = size / 2
    w = size * scale
    rad = w / 2
    h = w * 1.42
    top = size * top_factor
    head_cy = top + rad
    hole_col = base.getpixel((int(cx), int(head_cy)))  # amostra o fundo antes de pintar
    d = ImageDraw.Draw(base)
    d.ellipse([cx - rad, top, cx + rad, top + 2 * rad], fill=WHITE)
    d.polygon([(cx - rad, head_cy), (cx + rad, head_cy), (cx, top + h)], fill=WHITE)
    hr = rad * 0.4
    d.ellipse([cx - hr, head_cy - hr, cx + hr, head_cy + hr], fill=hole_col)


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, img.size[0] - 1, img.size[1] - 1], radius=radius, fill=255
    )
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def make(size, rounded_icon=True, scale=0.5, top=0.24):
    base = gradient(size)
    draw_pin(base, scale, top)
    return rounded(base, int(size * 0.22)) if rounded_icon else base.convert("RGBA")


if __name__ == "__main__":
    make(192).save(os.path.join(OUT, "icon-192.png"))
    make(512).save(os.path.join(OUT, "icon-512.png"))
    make(180, rounded_icon=False).convert("RGB").save(os.path.join(OUT, "apple-touch-180.png"))
    make(32).save(os.path.join(OUT, "favicon-32.png"))
    make(512, rounded_icon=False, scale=0.4, top=0.30).convert("RGB").save(
        os.path.join(OUT, "icon-512-maskable.png")
    )
    print("Icones gerados em", OUT)
