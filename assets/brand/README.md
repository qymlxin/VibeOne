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

## 当前正式标志

正式桌面使用用户确认的四层圆角横条标志，图形直接由 SVG 绘制，背景透明。亮色用 `vibeone-stacked-mark.svg`，暗色用 `vibeone-stacked-mark-dark.svg`；界面中的同构图形由 `apps/desktop/src/Brand.jsx` 随主题切换，文字使用系统字体，Vibe 500 / One 700。品牌紫色独立于可调整的界面强调色。

`vibeone-app-icon.svg` 是带底色的原生应用图标源，Tauri CLI 生成当前 icon.icns 和 icon.png。原 `vibeone-logo-*` 文件是早期原型资产，正式桌面不再引用它们。
