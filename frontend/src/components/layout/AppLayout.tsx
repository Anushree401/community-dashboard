import { Outlet } from "react-router-dom";
import type { AuthUser } from "../../types/auth";
import type { Community } from "../../types/community";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

type Props = {
  user: AuthUser;
  selectedCommunity: Community | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSignOut: () => void;
};

export default function AppLayout({
  user,
  selectedCommunity,
  search,
  onSearchChange,
  onSignOut,
}: Props) {
  return (
    <div className="app-shell">
      <Sidebar
        user={user}
        selectedCommunity={selectedCommunity}
        onSignOut={onSignOut}
      />
      <main className="main-area">
        <Topbar
          search={search}
          onSearchChange={onSearchChange}
          displayName={user.displayName}
          communityName={selectedCommunity?.name}
        />
        <Outlet />
      </main>
    </div>
  );
}
