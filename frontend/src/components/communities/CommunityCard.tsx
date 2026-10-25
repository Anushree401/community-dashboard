import type { Community } from "../../types/community";
import Icon from "../ui/Icon";

type Props = {
  community: Community;
  onOpen: (community: Community) => void;
  onJoin?: (community: Community) => void;
  joined?: boolean;
};

const COVERS = ["cover-0", "cover-1", "cover-2", "cover-3", "cover-4"] as const;
const SPARKS = ["✦", "◈", "◉", "⬡", "◇"] as const;
const ICON_COLORS = ["lavender", "blue", "peach"] as const;

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export default function CommunityCard({
  community,
  onOpen,
  onJoin,
  joined = false,
}: Props) {
  const idx = hashString(community.id);
  const coverClass = COVERS[idx % COVERS.length];
  const spark = SPARKS[idx % SPARKS.length];
  const iconColor = ICON_COLORS[idx % ICON_COLORS.length];
  const initial = community.name.slice(0, 1).toUpperCase();

  return (
    <article className="community-card">
      <div className={`community-card-cover ${coverClass}`}>
        <div className={`community-card-icon ${iconColor}`}>{initial}</div>
        <span className="cover-spark">{spark}</span>
      </div>

      <div className="community-card-content">
        <span className="eyebrow">{community.visibility}</span>
        <h2>{community.name}</h2>
        <p>{community.description || "No description provided yet."}</p>

        <div className="community-card-stats">
          <span>
            <Icon name="users" size={14} />
            {community._count?.memberships ?? 0} members
          </span>
        </div>

        <div className="community-card-actions">
          <button
            className="outline-button"
            type="button"
            onClick={() => onOpen(community)}
          >
            {joined ? "Open workspace" : "View details"}
          </button>

          {!joined && community.visibility === "PUBLIC" && onJoin && (
            <button
              className="primary-button"
              type="button"
              onClick={() => onJoin(community)}
            >
              Join
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
