import React from "react";
import { ArrowLeft, Check, Monitor, Moon, RotateCcw, Sun } from "lucide-react";

export function BrandMark() {
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label="VibeOne"
      className="brand-mark"
    >
      <rect x="2" y="10" width="96" height="14" rx="7" fill="currentColor" />
      <rect x="14" y="32" width="72" height="14" rx="7" fill="currentColor" />
      <rect x="26" y="54" width="48" height="14" rx="7" fill="currentColor" />
      <rect
        x="38"
        y="76"
        width="24"
        height="14"
        rx="7"
        className="brand-accent"
      />
    </svg>
  );
}

export const defaults = {
  light: { bg: "#FFFFFF", fg: "#1A1C1F" },
  dark: { bg: "#181818", fg: "#FFFFFF" },
} as const;

export function contrastRatio(bg: string, fg: string): number {
  const luminance = (hex: string) => {
    const rgb = (hex.slice(1).match(/../g) ?? ["00", "00", "00"])
      .map((x) => parseInt(x, 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return (rgb[0] ?? 0) * 0.2126 + (rgb[1] ?? 0) * 0.7152 + (rgb[2] ?? 0) * 0.0722;
  };
  const a = luminance(bg);
  const b = luminance(fg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="appearance-row">
      <span>{label}</span>
      <label className="color-pill">
        <span className="color-dot" style={{ background: value }} />
        <code>{value.toUpperCase()}</code>
        <input
          aria-label={`${label}颜色`}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}

export function Appearance({
  theme,
  setTheme,
  dark,
  colors,
  accent,
  setAccent,
  changeColor,
  reset,
  onBack,
}: {
  theme: string;
  setTheme: (value: string) => void;
  dark: boolean;
  colors?: { bg?: string; fg?: string };
  accent: string;
  setAccent: (value: string) => void;
  changeColor: (key: "bg" | "fg", value: string) => void;
  reset: () => void;
  onBack: () => void;
}) {
  const mode = dark ? "暗色" : "亮色";
  const values = { ...defaults[dark ? "dark" : "light"], ...colors };
  const ratio = contrastRatio(values.bg, values.fg);
  return (
    <main className="appearance-page">
      <header>
        <button onClick={onBack}>
          <ArrowLeft size={15} />
          返回工作台
        </button>
        <span>外观设置</span>
      </header>
      <div className="appearance-content">
        <h1>外观</h1>
        <p className="appearance-intro">
          熟悉的黑白层级，也可以调成你的颜色。
        </p>
        <h2>视觉风格</h2>
        <div className="appearance-box mode-box">
          <span>模式</span>
          <div className="mode-options" role="group" aria-label="外观模式">
            {(
              [
                ["system", "跟随系统", Monitor],
                ["light", "亮色", Sun],
                ["dark", "暗色", Moon],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
              >
                <div className={`mode-thumbnail ${value}`}>
                  <div />
                  <section>
                    <i />
                    <i />
                    <i />
                    <b />
                  </section>
                </div>
                <span>
                  <Icon size={12} />
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="appearance-box">
          <div className="appearance-row">
            <span>主题</span>
            <span className="theme-name">
              <BrandMark />
              VibeOne · 默认
            </span>
          </div>
          <div className="appearance-row">
            <span>强调色</span>
            <div className="accent-options" role="group" aria-label="强调色">
              {(
                [
                  ["#3564F5", "默认蓝"],
                  ["#7357D9", "紫色"],
                  ["#207C68", "绿色"],
                  ["#B35B32", "橙色"],
                ] as const
              ).map(([color, label]) => (
                <button
                  key={color}
                  title={label}
                  aria-label={label}
                  aria-pressed={accent.toUpperCase() === color}
                  style={{ background: color }}
                  onClick={() => setAccent(color)}
                >
                  {accent.toUpperCase() === color && <Check size={11} />}
                </button>
              ))}
              <label className="custom-accent">
                <span style={{ background: accent }} />
                自定义
                <input
                  type="color"
                  aria-label="自定义强调色"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                />
              </label>
            </div>
          </div>
          <ColorRow
            label="背景"
            value={values.bg}
            onChange={(value) => changeColor("bg", value)}
          />
          <ColorRow
            label="前景"
            value={values.fg}
            onChange={(value) => changeColor("fg", value)}
          />
          <div className="appearance-row">
            <span>字体</span>
            <span className="setting-value">系统默认</span>
          </div>
        </div>
        <div className="appearance-help">
          <span>
            当前调整：{mode}模式 · 文字对比度 {ratio.toFixed(1)}:1
          </span>
          <button aria-label="恢复默认配色" onClick={reset}>
            <RotateCcw size={12} />
            恢复默认
          </button>
        </div>
        {ratio < 4.5 && (
          <p className="contrast-hint">
            当前文字与背景较接近，建议调整至至少 4.5:1。
          </p>
        )}
        <p className="appearance-footnote">
          亮暗配色分别保存在本设备；切换后可返回工作台查看整体效果。
        </p>
        <div className="appearance-sample">
          <div className="sample-brand">
            <BrandMark />
            <span>
              Vibe<strong>One</strong>
            </span>
          </div>
          <div>
            <strong>让上下文留在身边。</strong>
            <p>
              同一套文字、表面与强调色，会应用到会话、对话和右侧预览。
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
