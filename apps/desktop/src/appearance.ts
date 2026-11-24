export const appearanceKey = "vibeone-appearance-v1";

export type ThemeMode = "light" | "dark";

export interface ModeAppearance {
  background?: string;
  foreground?: string;
}

export interface AppearanceConfig {
  accent: string;
  light: ModeAppearance;
  dark: ModeAppearance;
}

export const baseColors: Record<
  ThemeMode,
  { background: string; foreground: string }
> = {
  light: { background: "#F6F7F9", foreground: "#141821" },
  dark: { background: "#0E1116", foreground: "#EDF1F7" },
};

const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[\da-f]{6}$/i.test(value);

/** 规范化外观配置，过滤非法颜色值 */
export function normalizeAppearance(value: unknown): AppearanceConfig {
  const result: AppearanceConfig = {
    accent: "#3564F5",
    light: {},
    dark: {},
  };
  if (!value || typeof value !== "object") {
    return result;
  }
  const input = value as Record<string, unknown>;
  if (isHexColor(input.accent)) {
    result.accent = input.accent;
  }
  for (const mode of ["light", "dark"] as const) {
    const modeInput = input[mode];
    if (!modeInput || typeof modeInput !== "object") {
      continue;
    }
    const modeRecord = modeInput as Record<string, unknown>;
    for (const key of ["background", "foreground"] as const) {
      const color = modeRecord[key];
      if (isHexColor(color)) {
        result[mode][key] = color;
      }
    }
  }
  return result;
}

/** 从本地存储读取用户外观配置 */
export function readAppearance(): AppearanceConfig {
  try {
    const raw = localStorage.getItem(appearanceKey);
    return normalizeAppearance(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeAppearance(null);
  }
}

/** 将外观配置写入根元素的 CSS 变量 */
export function applyAppearance(
  value: AppearanceConfig,
  mode: ThemeMode,
): void {
  const root = document.documentElement;
  for (const name of [
    "surface",
    "canvas",
    "soft",
    "hover",
    "selected",
    "ink",
    "muted",
    "line",
    "line-strong",
    "bar",
    "raised",
    "sidebar",
    "panel",
  ]) {
    root.style.removeProperty(`--${name}`);
  }
  // 默认钴蓝在暗色背景下自动使用高可读性浅钴蓝 #5B82FF
  const resolvedAccent =
    value.accent.toUpperCase() === "#3564F5" && mode === "dark"
      ? "#5B82FF"
      : value.accent;
  root.style.setProperty("--ui-accent", resolvedAccent);
  const colors = value[mode];
  if (!colors.background && !colors.foreground) {
    return;
  }
  const bg = colors.background ?? baseColors[mode].background;
  const fg = colors.foreground ?? baseColors[mode].foreground;
  const mix = (amount: number) => `color-mix(in srgb,${bg} ${amount}%,${fg})`;
  for (const [key, color] of Object.entries({
    surface: bg,
    ink: fg,
    canvas: mix(98),
    soft: mix(97),
    hover: mix(91),
    selected: mix(86),
    muted: mix(36),
    line: mix(88),
    "line-strong": mix(62),
    bar: mix(95),
    raised: mix(89.5),
    sidebar: mix(96),
    panel: mix(98.7),
  })) {
    root.style.setProperty(`--${key}`, color);
  }
}

/** 计算背景与前景色的 WCAG 对比度 */
export function contrastRatio(background: string, foreground: string): number {
  const luminance = (color: string) => {
    const parts = color.slice(1).match(/../g) ?? ["00", "00", "00"];
    const [r = 0, g = 0, b = 0] = parts
      .map((val) => parseInt(val, 16) / 255)
      .map((val) =>
        val <= 0.04045 ? val / 12.92 : ((val + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(background);
  const b = luminance(foreground);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
