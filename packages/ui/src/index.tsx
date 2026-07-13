import type { PropsWithChildren, ReactNode } from "react";

export interface NavigationItem {
  readonly id: string;
  readonly label: string;
}

export const designTokens = {
  borderRadius: "1rem",
  panelBorder: "1px solid rgba(148, 163, 184, 0.18)",
  panelBackground: "rgba(15, 23, 42, 0.72)"
} as const;

export function PanelCard({
  eyebrow,
  title,
  children
}: PropsWithChildren<{
  readonly eyebrow: string;
  readonly title: string;
}>) {
  return (
    <section className="panel">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function SidebarNavigation({
  items,
  renderSuffix
}: {
  readonly items: readonly NavigationItem[];
  readonly renderSuffix?: ReactNode;
}) {
  return (
    <nav className="nav-list" aria-label="Primary navigation">
      {items.map((item) => (
        <button key={item.id} className="nav-item" type="button">
          {item.label}
        </button>
      ))}
      {renderSuffix}
    </nav>
  );
}
