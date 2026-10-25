import { NavLink, useNavigate } from "react-router-dom";
import type { AuthUser } from "../../types/auth";
import type { Community } from "../../types/community";
import Icon from "../ui/Icon";
import ProfileMenu from "./ProfileMenu";

const navigation = [
  { label: "Home", path: "/", icon: "overview" as const },
  {
    label: "Discover communities",
    path: "/communities",
    icon: "communities" as const,
  },
];

type Props = {
  user: AuthUser;
  selectedCommunity: Community | null;
  onSignOut: () => void;
};

export default function Sidebar({
  user,
  selectedCommunity,
  onSignOut,
}: Props) {
  const navigate = useNavigate();

  return (
    <aside className="sidebar">
      <NavLink to="/" className="brand" aria-label="Gather home">
        <div className="brand-mark">
          <span /><span /><span /><span />
        </div>
        <div>
          <div className="brand-name">gather<span>.</span></div>
          <div className="brand-caption">COMMUNITY HUB</div>
        </div>
      </NavLink>

      <div className="nav-label">Workspace</div>
      <nav className="main-nav" aria-label="Main navigation">
        {navigation.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            className={({ isActive }) =>
              `nav-item ${isActive ? "active" : ""}`
            }
          >
            <Icon name={item.icon} size={17} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {selectedCommunity && (
        <>
          <div className="nav-label" style={{ marginTop: 28 }}>Current community</div>
          <button
            className="community-shortcut"
            type="button"
            onClick={() => navigate(`/community/${selectedCommunity.id}`)}
          >
            <span className="mini-community lavender">
              {selectedCommunity.name.slice(0, 1).toUpperCase()}
            </span>
            <span>{selectedCommunity.name}</span>
          </button>
        </>
      )}

      <div className="sidebar-bottom">
        <ProfileMenu user={user} onSignOut={onSignOut} />
      </div>
    </aside>
  );
}
