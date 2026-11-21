# Regenerate the SEED app icons (favicon PNGs + the embedded-mark icon.svg) from
# the brand logo src/assets/seed-logo.png. The mark is the SEED "lens swoosh"
# cropped from the logo, keyed to a clean anti-aliased blue, set in a white
# circle on the deep SEED navy tile.
#
#   pip install pillow
#   python scripts/gen-icons.py
#
# Outputs: src/assets/seed-mark.png, public/icon-{192,512}.png,
#          public/icon-maskable-512.png, public/apple-touch-icon.png, public/icon.svg
import base64
from PIL import Image, ImageDraw

BLUE = (0, 111, 186)   # SEED swoosh blue  (#006FBA)
NAVY = (13, 31, 74)    # icon tile navy    (#0D1F4A)

logo = Image.open("src/assets/seed-logo.png").convert("RGBA")
# The swoosh occupies cols 0-126, rows 0-192 of the horizontal logo.
sw = logo.crop((0, 0, 128, 193))
# Soft alpha from "non-whiteness" so edges stay anti-aliased; recolour to brand blue.
sw.putdata([(BLUE[0], BLUE[1], BLUE[2], 0 if a < 20 else 255 - min(r, g, b))
            for (r, g, b, a) in sw.getdata()])
sw = sw.crop(sw.getbbox())
sw.save("src/assets/seed-mark.png")

def make(out, maskable=False):
    R = out * 4
    img = Image.new("RGBA", (R, R), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, R, R], fill=NAVY + (255,)); D = int(R * 0.64)
    else:
        d.rounded_rectangle([0, 0, R - 1, R - 1], radius=int(R * 0.225), fill=NAVY + (255,)); D = int(R * 0.74)
    c = R // 2
    d.ellipse([c - D // 2, c - D // 2, c + D // 2, c + D // 2], fill=(255, 255, 255, 255))
    tw = int(D * 0.60)
    m = sw.resize((tw, int(sw.height * tw / sw.width)), Image.LANCZOS)
    img.alpha_composite(m, (c - m.width // 2, c - m.height // 2))
    return img.resize((out, out), Image.LANCZOS)

make(192).save("public/icon-192.png")
make(512).save("public/icon-512.png")
make(512, True).save("public/icon-maskable-512.png")
make(180, True).save("public/apple-touch-icon.png")

# icon.svg: navy tile + white circle + the swoosh as an embedded PNG data URI.
b64 = base64.b64encode(open("src/assets/seed-mark.png", "rb").read()).decode()
mw = 227; mh = round(227 * sw.height / sw.width)
x = 256 - mw / 2; y = 256 - mh / 2
open("public/icon.svg", "w", encoding="utf-8").write(
    f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">\n'
    f'  <rect width="512" height="512" rx="115" fill="#0D1F4A"/>\n'
    f'  <circle cx="256" cy="256" r="189" fill="#ffffff"/>\n'
    f'  <image x="{x:.1f}" y="{y:.1f}" width="{mw}" height="{mh}" href="data:image/png;base64,{b64}"/>\n'
    f'</svg>\n')
print("Wrote SEED icons to public/ and src/assets/seed-mark.png")
