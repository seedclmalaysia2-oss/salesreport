# SEED MY SALES app icons — the SEED house standard (seed-app-icon skill,
# hrdashboard fa1ebaf): navy #13245A tile, the SEED logo on a white rounded card,
# the app label "SALES" below in Georgia bold. The logo (src/assets/seed-logo.png)
# is the company file and is only ever RESIZED — never redrawn, recoloured, cropped
# or traced.
#
#   pip install pillow   &&   python scripts/gen-icons.py
#
# Version is the cache-bust: bump ICON_VERSION, rerun, commit the new PNGs, and
# point the manifest / index.html at the new paths. Never overwrite a PNG under an
# existing name (Android + the CDN keep the old one).
import base64, os
from PIL import Image, ImageDraw, ImageFont

PREFIX = "seed-my-sales"
ICON_VERSION = "v1"
LABEL = "SALES"
NAVY = (19, 36, 90)        # #13245A — the SEED logo's own navy
FONT = next((p for p in ("C:/Windows/Fonts/georgiab.ttf",
                         "C:/Windows/Fonts/cambriab.ttf",
                         "C:/Windows/Fonts/arialbd.ttf") if os.path.exists(p)), None)

logo = Image.open("src/assets/seed-logo.png").convert("RGBA")
os.makedirs("public/icons", exist_ok=True)

def content(R):
    """The white card + logo + label, drawn in a 100-unit space scaled to R."""
    L = Image.new("RGBA", (R, R), (0, 0, 0, 0)); d = ImageDraw.Draw(L); u = R / 100.0
    cw = 80 * u; cx = (R - cw) / 2
    lw = 66 * u; lh = lw * logo.height / logo.width
    pad = 6 * u; ch = lh + 2 * pad; cy = 11 * u
    d.rounded_rectangle([cx, cy, cx + cw, cy + ch], radius=10 * u, fill=(255, 255, 255, 255))
    L.alpha_composite(logo.resize((round(lw), round(lh)), Image.LANCZOS), (round((R - lw) / 2), round(cy + pad)))
    fs, ls = 22, 1 * u
    f = ImageFont.truetype(FONT, round(fs * u))
    tw = lambda s, ff: sum(d.textlength(c, font=ff) + ls for c in s) - ls
    while tw(LABEL, f) > 88 * u and fs > 10:
        fs -= 1; f = ImageFont.truetype(FONT, round(fs * u))
    w = tw(LABEL, f); bb = d.textbbox((0, 0), LABEL, font=f)
    rt, rb = cy + ch, 100 * u
    ty = rt + ((rb - rt) - (bb[3] - bb[1])) / 2 - bb[1]; x = (R - w) / 2
    for c in LABEL:
        d.text((x, ty), c, font=f, fill=(255, 255, 255, 255)); x += d.textlength(c, font=f) + ls
    return L

def design(S, maskable=False):
    R = S * 4; img = Image.new("RGBA", (R, R), NAVY + (255,)); cl = content(R)
    if maskable:  # scale the drawing to the central 70% (Android safe circle)
        nl = cl.resize((round(R * 0.7), round(R * 0.7)), Image.LANCZOS)
        img.alpha_composite(nl, ((R - nl.width) // 2, (R - nl.height) // 2))
    else:
        img.alpha_composite(cl, (0, 0))
    return img.resize((S, S), Image.LANCZOS)

def path(size): return f"public/icons/{PREFIX}-{ICON_VERSION}-{size}.png"
for s in (32, 180, 192, 512):
    design(s).save(path(s))
design(512, True).save(path("512-maskable"))

# SVG favicon: navy tile + white card + the logo (embedded) + the SALES label.
b64 = base64.b64encode(open("src/assets/seed-logo.png", "rb").read()).decode()
lw = 66.0; lh = lw * logo.height / logo.width; cy = 11.0; ch = lh + 12
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 100 100">\n'
       f'  <rect width="100" height="100" fill="#13245A"/>\n'
       f'  <rect x="10" y="{cy}" width="80" height="{ch:.1f}" rx="10" fill="#fff"/>\n'
       f'  <image x="{(100-lw)/2:.1f}" y="{cy+6:.1f}" width="{lw}" height="{lh:.1f}" href="data:image/png;base64,{b64}"/>\n'
       f'  <text x="50" y="{cy+ch+ (100-(cy+ch))/2 + 7:.1f}" text-anchor="middle" fill="#fff" '
       f'font-family="Georgia,Cambria,serif" font-weight="bold" font-size="22" letter-spacing="1">{LABEL}</text>\n'
       f'</svg>\n')
open("public/icon.svg", "w", encoding="utf-8").write(svg)
print(f"Wrote public/icons/{PREFIX}-{ICON_VERSION}-* and public/icon.svg")
