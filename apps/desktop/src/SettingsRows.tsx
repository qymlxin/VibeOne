import React from "react";
import { Button, type ButtonProps } from "./components/ui/button.tsx";
import { SettingItem, SettingSection } from "./components/ui/setting-layout.tsx";
import { Switch } from "./components/ui/switch.tsx";

export function SettingsAction({
  children,
  primary = false,
  ...props
}: ButtonProps & { primary?: boolean }) {
  return (
    <Button
      variant={primary ? "default" : "outline"}
      size="sm"
      {...props}
    >
      {children}
    </Button>
  );
}

export function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <SettingSection title={title} description={description}>
      {children}
    </SettingSection>
  );
}

export function SettingsRow({
  title,
  description,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <SettingItem title={title} description={description}>
      {children}
    </SettingItem>
  );
}

export function SettingsSwitch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Switch
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
    />
  );
}
