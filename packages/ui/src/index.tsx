import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";

export interface NavigationItem {
  readonly id: string;
  readonly label: string;
}

export type StatusTone = "neutral" | "success" | "warning" | "error";

export const designTokens = {
  borderRadius: "1rem",
  panelBorder: "1px solid var(--border-default)",
  panelBackground: "var(--background-secondary)"
} as const;

export function Button({
  children,
  className,
  ...props
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button
      {...props}
      className={["ui-button", className].filter(Boolean).join(" ")}
      type={props.type ?? "button"}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral"
}: PropsWithChildren<{
  readonly tone?: StatusTone;
}>) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;
}

export function PanelCard({
  eyebrow,
  title,
  children,
  actions
}: PropsWithChildren<{
  readonly eyebrow: string;
  readonly title: string;
  readonly actions?: ReactNode;
}>) {
  return (
    <section className="ui-panel-card">
      <div className="ui-panel-card__header">
        <div>
          <p className="ui-eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {actions ? <div>{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="ui-page-header">
      <div>
        <p className="ui-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="ui-muted">{description}</p>
      </div>
      {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function SidebarItem({
  label,
  active,
  disabled,
  icon,
  suffix,
  onClick
}: {
  readonly label: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly icon?: ReactNode;
  readonly suffix?: ReactNode;
  readonly onClick?: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={[
        "ui-sidebar-item",
        active ? "ui-sidebar-item--active" : "",
        disabled ? "ui-sidebar-item--disabled" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="ui-sidebar-item__label">
        {icon ? <span className="ui-sidebar-item__icon">{icon}</span> : null}
        <span>{label}</span>
      </span>
      {suffix ? <span>{suffix}</span> : null}
    </button>
  );
}

export function SidebarNavigation<TItem extends NavigationItem>({
  items,
  renderItem,
  renderSuffix
}: {
  readonly items: readonly TItem[];
  readonly renderItem: (item: TItem) => ReactNode;
  readonly renderSuffix?: ReactNode;
}) {
  return (
    <nav className="ui-sidebar-nav" aria-label="Primary navigation">
      {items.map((item) => renderItem(item))}
      {renderSuffix}
    </nav>
  );
}

export function StatusIndicator({
  label,
  value,
  tone = "neutral"
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: StatusTone;
}) {
  return (
    <div className="ui-status-indicator">
      <span className={`ui-status-indicator__dot ui-status-indicator__dot--${tone}`} />
      <span className="ui-status-indicator__label">{label}</span>
      <span className="ui-status-indicator__value">{value}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <section className="ui-state-card">
      <h2>{title}</h2>
      <p className="ui-muted">{description}</p>
      {action ? <div className="ui-state-card__action">{action}</div> : null}
    </section>
  );
}

export function LoadingState({
  title,
  description
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <section className="ui-state-card" aria-live="polite">
      <div className="ui-loading-indicator" aria-hidden="true" />
      <h2>{title}</h2>
      <p className="ui-muted">{description}</p>
    </section>
  );
}

export function ErrorState({
  title,
  description,
  action
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <section className="ui-state-card ui-state-card--error" role="alert">
      <h2>{title}</h2>
      <p className="ui-muted">{description}</p>
      {action ? <div className="ui-state-card__action">{action}</div> : null}
    </section>
  );
}
