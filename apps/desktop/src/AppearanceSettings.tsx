import React, { useEffect, useState } from "react";
import { Appearance } from "./approved/Appearance.tsx";
import {
  appearanceKey,
  applyAppearance,
  normalizeAppearance,
  readAppearance,
  type AppearanceConfig,
} from "./appearance.ts";

export function useAppearance(theme: string) {
  const [value, setValue] = useState<AppearanceConfig>(readAppearance);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [temporary, setTemporary] = useState(false);
  const dark = theme === "system" ? systemDark : theme === "dark";

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(
    () => applyAppearance(value, dark ? "dark" : "light"),
    [value, dark],
  );

  useEffect(() => {
    try {
      localStorage.setItem(appearanceKey, JSON.stringify(value));
    } catch {
      setTemporary(true);
    }
  }, [value]);

  const update = (
    next:
      | AppearanceConfig
      | ((previous: AppearanceConfig) => AppearanceConfig),
  ) =>
    setValue((previous) =>
      normalizeAppearance(typeof next === "function" ? next(previous) : next),
    );

  return { value, update, dark, temporary };
}

export function AppearanceSettings({
  theme,
  setTheme,
  appearance,
  onBack,
}: {
  theme: string;
  setTheme: (theme: string) => void;
  appearance: ReturnType<typeof useAppearance>;
  onBack: () => void;
}) {
  const { value, update, dark, temporary } = appearance;
  const mode = dark ? "dark" : "light";
  return (
    <>
      <Appearance
        theme={theme}
        setTheme={setTheme}
        dark={dark}
        colors={{
          ...(value[mode].background ? { bg: value[mode].background } : {}),
          ...(value[mode].foreground ? { fg: value[mode].foreground } : {}),
        }}
        accent={value.accent}
        setAccent={(accent) => update((previous) => ({ ...previous, accent }))}
        changeColor={(key, color) =>
          update((previous) => ({
            ...previous,
            [mode]: {
              ...previous[mode],
              [key === "bg" ? "background" : "foreground"]: color,
            },
          }))
        }
        reset={() =>
          update((previous) => ({
            ...previous,
            accent: "#3564F5",
            [mode]: {},
          }))
        }
        onBack={onBack}
      />
      {temporary && (
        <p role="status">当前浏览器无法保存，调整在本次页面中有效。</p>
      )}
    </>
  );
}
