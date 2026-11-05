# VibeOne Brand Assets

The current brand consists of three transparent-background SVG assets:

| Asset | Content |
| --- | --- |
| [Symbol](vibeone-logo-mark.svg) | Two editable vector paths, no embedded images or fonts |
| [Wordmark](vibeone-logo-wordmark.svg) | Live system-font SVG text |
| [Lockup](vibeone-logo-lockup.svg) | Vector symbol with system-font text |

The prototype uses the symbol with live HTML text. Lettering uses `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`, weight 700 and tracking -0.025em. No font files are distributed; letter shapes may vary between operating systems.

The SVGs use `currentColor` with no background. Inline SVG can inherit CSS color; the prototype adapts the standalone symbol for dark mode.

To regenerate the wordmark and lockup, run `python3 docs/tools/generate_brand_wordmark.py`. The symbol SVG is the editable source for its geometry.
