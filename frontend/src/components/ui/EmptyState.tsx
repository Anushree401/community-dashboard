import type { ReactNode } from "react";

type Props = {
  title: string;
  description: string;
  action?: ReactNode;
};

export default function EmptyState({
  title,
  description,
  action,
}: Props) {
  return (
    <section className="empty-state">
      <strong>{title}</strong>
      <span>{description}</span>
      {action}
    </section>
  );
}
