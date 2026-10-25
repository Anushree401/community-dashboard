import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../../types/auth";
import type { Community } from "../../types/community";
import Icon from "../../components/ui/Icon";
import CommunityCard from "../../components/communities/CommunityCard";
import EmptyState from "../../components/ui/EmptyState";

type Props = {
  user: AuthUser;
  communities: Community[];
  loading: boolean;
  onCreate: () => void;
  onDiscover: () => void;
};

export default function HomePage({
  user,
  communities,
  loading,
  onCreate,
  onDiscover,
}: Props) {
  const navigate = useNavigate();

  return (
    <section className="minimal-home">
      <header className="page-heading">
        <div>
          <span className="eyebrow">YOUR COMMUNITY SPACE</span>
          <h1>Welcome, {user.displayName}.</h1>
          <p>Your space to connect around what matters to you.</p>
        </div>
        <button className="primary-button" onClick={onCreate} type="button">
          <Icon name="plus" size={16} />
          Create community
        </button>
      </header>

      {loading ? (
        <EmptyState
          title="Loading communities"
          description="Fetching community information."
        />
      ) : communities.length === 0 ? (
        <section className="first-community-card">
          <div className="first-community-icon">
            <Icon name="communities" size={24} />
          </div>
          <h2>Your community starts here</h2>
          <p>
            Create a community of your own, or discover a public community to
            join.
          </p>
          <div className="first-community-actions">
            <button className="primary-button" onClick={onCreate} type="button">
              <Icon name="plus" size={16} />
              Create your community
            </button>
            <button className="outline-button" onClick={onDiscover} type="button">
              Discover communities
            </button>
          </div>
        </section>
      ) : (
        <section>
          <div className="section-heading">
            <div>
              <h2>Your communities</h2>
              <p>Choose a community to open its workspace.</p>
            </div>
            <button
              className="outline-button"
              type="button"
              onClick={onDiscover}
            >
              Discover more
            </button>
          </div>
          <div className="community-cards">
            {communities.map((community) => (
              <CommunityCard
                key={community.id}
                community={community}
                joined
                onOpen={(item) => navigate(`/community/${item.id}`)}
              />
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
