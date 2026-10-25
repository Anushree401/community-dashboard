import { useLocation } from "react-router-dom";
import Icon from "../ui/Icon";

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  displayName: string;
  communityName?: string;
};

export default function Topbar({
  search,
  onSearchChange,
  displayName,
  communityName,
}: Props) {
  const location = useLocation();

  const pageTitle = location.pathname.startsWith("/community/")
    ? communityName || "Community"
    : location.pathname === "/communities"
      ? "Discover communities"
      : "Home";

  const initials = displayName
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="topbar">
      <div className="breadcrumb">
        <span>Gather</span>
        <Icon name="chevron" size={13} />
        <strong>{pageTitle}</strong>
      </div>

      <div className="topbar-actions">
        <label className="search-box">
          <Icon name="search" size={15} />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Find a community…"
            aria-label="Search communities"
          />
        </label>
        <div className="top-avatar" role="img" aria-label={`Signed in as ${displayName}`}>
          {initials}
        </div>
      </div>
    </header>
  );
}
