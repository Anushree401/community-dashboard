import type { AuthUser } from "../../types/auth";

type Props = {
  user: AuthUser;
  onSignOut: () => void;
};

export default function ProfileMenu({ user, onSignOut }: Props) {
  const initials = user.displayName
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <button
      className="profile-row"
      type="button"
      onClick={onSignOut}
      title="Sign out"
    >
      <span className="avatar avatar-you">{initials}</span>
      <span className="profile-copy">
        <strong>{user.displayName}</strong>
        <span>{user.email}</span>
      </span>
      <span className="signout-label">Sign out</span>
    </button>
  );
}
