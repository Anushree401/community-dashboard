import type { Community } from "../../types/community";
import PageHeading from "../../components/ui/PageHeading";
import EmptyState from "../../components/ui/EmptyState";
import CommunityCard from "../../components/communities/CommunityCard";
import Icon from "../../components/ui/Icon";

type Props = {
  items: Community[];
  loading: boolean;
  error: string;
  query: string;
  onRetry: () => void;
  onCreate: () => void;
  onJoin: (community: Community) => void;
  onOpen: (community: Community) => void;
};

export default function CommunitiesPage({
  items,
  loading,
  error,
  query,
  onRetry,
  onCreate,
  onJoin,
  onOpen,
}: Props) {
  const filtered = items.filter((community) =>
    `${community.name} ${community.description ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <section className="page-content">
      <PageHeading
        eyebrow="YOUR SPACE"
        title="Discover communities"
        subtitle="Find a space to join or create a community of your own."
        action={
          <button className="primary-button" type="button" onClick={onCreate}>
            <Icon name="plus" size={16} />
            Create community
          </button>
        }
      />

      {loading ? (
        <EmptyState
          title="Loading communities"
          description="Fetching public communities."
        />
      ) : error ? (
        <EmptyState
          title="Could not load communities"
          description={error}
          action={
            <button className="outline-button" onClick={onRetry} type="button">
              Try again
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={query ? "No matching communities" : "No public communities yet"}
          description={
            query
              ? "Try another search term."
              : "Create a community to give people a place to connect."
          }
          action={
            !query ? (
              <button
                className="primary-button"
                type="button"
                onClick={onCreate}
              >
                <Icon name="plus" size={16} />
                Create community
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="community-cards">
          {filtered.map((community) => (
            <CommunityCard
              key={community.id}
              community={community}
              onOpen={onOpen}
              onJoin={onJoin}
            />
          ))}
        </div>
      )}
    </section>
  );
}
