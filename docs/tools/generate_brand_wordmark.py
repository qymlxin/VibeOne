"""Export the vector symbol with live system-font lettering; no font dependencies."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / 'assets/brand'

text = ('<text x="6" y="225" font-family="system-ui, -apple-system, '
        'BlinkMacSystemFont, Segoe UI, sans-serif" font-size="300" '
        'font-weight="700" letter-spacing="-7.5">VibeOne</text>')


def document(width, content):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 237" '
            'fill="currentColor" role="img" aria-label="VibeOne">'
            '<title>VibeOne</title>' + content + '</svg>\n')


(BRAND / 'vibeone-logo-wordmark.svg').write_text(document(1240, text))
mark = (BRAND / 'vibeone-logo-mark.svg').read_text()
symbol = ('<g transform="translate(-269 -275)">'
          + ''.join(re.findall(r'<path\b[^>]*/>', mark)) + '</g>')
(BRAND / 'vibeone-logo-lockup.svg').write_text(
    document(1630, symbol + f'<g transform="translate(390 0)">{text}</g>'))
print('Exported system-font lettering and vector-symbol lockup.')
