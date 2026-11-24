import React, { Children, cloneElement, isValidElement } from "react";

export function SettingsAction({
  children,
  primary = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      className={`settings-action ${primary ? "primary" : ""}`}
      {...props}
    >
      {children}
    </button>
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
    <section className="settings-group desktop-settings-section">
      <h2>{title}</h2>
      {description && <p className="group-description">{description}</p>}
      <div className="settings-rows desktop-settings-card">{children}</div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="settings-row desktop-settings-row">
      <div>
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      <div className="settings-control">
        {Children.map(children, (child) => {
          if (
            isValidElement<{ role?: string; className?: string }>(child) &&
            child.type === "button" &&
            child.props.role !== "switch"
          ) {
            return cloneElement(child, {
              className: `settings-action ${child.props.className ?? ""}`,
            });
          }
          if (
            isValidElement<{ className?: string }>(child) &&
            child.type === "span"
          ) {
            return cloneElement(child, {
              className: `setting-value ${child.props.className ?? ""}`,
            });
          }
          return child;
        })}
      </div>
    </div>
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
    <button
      type="button"
      className="settings-switch desktop-settings-switch"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
