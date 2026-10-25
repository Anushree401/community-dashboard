import type { ReactNode } from "react";

type Props = {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
};

export default function PageHeading({
  eyebrow,
  title,
  subtitle,
  action,
}: Props) {
  return (
    <header className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </header>
  );
}
