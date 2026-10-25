import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  getCommunityOverview,
  getCommunityMembershipGrowth,
  getCommunityEngagement,
  getCommunityActiveUsers,
  getCommunityTopPosts,
  type CommunityOverview,
  type MembershipGrowthPoint,
  type EngagementPoint,
  type DailyActiveUserPoint,
  type CommunityTopPost,
} from "../../lib/api";

type Props = {
  communityId: string;
};

const RANGE_OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
] as const;

function formatShortDate(value: ReactNode) {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function WorkspaceAnalytics({ communityId }: Props) {
  const [overview, setOverview] = useState<CommunityOverview | null>(null);
  const [growth, setGrowth] = useState<MembershipGrowthPoint[]>([]);
  const [engagement, setEngagement] = useState<EngagementPoint[]>([]);
  const [activeUsers, setActiveUsers] = useState<DailyActiveUserPoint[]>([]);
  const [dau, setDau] = useState(0);
  const [mau, setMau] = useState(0);
  const [topPosts, setTopPosts] = useState<CommunityTopPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [days, setDays] = useState(30);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const [
        overviewResult,
        growthResult,
        engagementResult,
        activeResult,
        topPostResult,
      ] = await Promise.all([
        getCommunityOverview(communityId),
        getCommunityMembershipGrowth(communityId, days),
        getCommunityEngagement(communityId, days),
        getCommunityActiveUsers(communityId, days),
        getCommunityTopPosts(communityId, 10),
      ]);

      setOverview(overviewResult);
      setGrowth(growthResult.growth ?? []);
      setEngagement(engagementResult.engagement ?? []);
      setActiveUsers(activeResult.dailyActiveUsers ?? []);
      setDau(activeResult.dau ?? 0);
      setMau(activeResult.mau ?? 0);
      setTopPosts(topPostResult.topPosts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load analytics data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [communityId, days]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <section className="workspace-section">
        <h2>Analytics</h2>
        <p role="status">Loading analytics…</p>
      </section>
    );
  }

  if (error && !overview) {
    return (
      <section className="workspace-section">
        <h2>Analytics</h2>
        <p className="workspace-error" role="alert">{error}</p>
        <button type="button" className="secondary-button" onClick={() => void load()}>
          Retry
        </button>
      </section>
    );
  }

  return (
    <section className="workspace-section">
      <div className="workspace-section-heading">
        <div>
          <h2>Analytics</h2>
          <p>Community metrics and engagement trends.</p>
        </div>
        <div className="workspace-inline-actions">
          <label>
            <span className="sr-only">Date range</span>
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              aria-label="Date range"
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button"
            type="button"
            disabled={refreshing}
            onClick={() => void load(true)}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <p className="workspace-error" role="alert">{error}</p>}

      {overview && (
        <div className="workspace-stats">
          <article className="workspace-stat"><span>Active members</span><strong>{overview.members.active}</strong></article>
          <article className="workspace-stat"><span>Published posts</span><strong>{overview.content.publishedPosts}</strong></article>
          <article className="workspace-stat"><span>Comments</span><strong>{overview.content.comments}</strong></article>
          <article className="workspace-stat"><span>Reactions</span><strong>{overview.content.reactions}</strong></article>
          <article className="workspace-stat"><span>DAU</span><strong>{dau}</strong></article>
          <article className="workspace-stat"><span>MAU (30 day)</span><strong>{mau}</strong></article>
          <article className="workspace-stat"><span>Net points</span><strong>{overview.gamification.netPointsAwarded}</strong></article>
          <article className="workspace-stat"><span>Announcements</span><strong>{overview.content.publishedAnnouncements}</strong></article>
        </div>
      )}

      <div className="workspace-panel">
        <h3>Membership growth</h3>
        {growth.length === 0 ? <p>No membership data for this period.</p> : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={growth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} stroke="#888" fontSize={12} />
              <YAxis allowDecimals={false} stroke="#888" fontSize={12} />
              <Tooltip labelFormatter={formatShortDate} contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #333", color: "#fff" }} />
              <Bar dataKey="newMembers" fill="#888" name="New members" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="workspace-panel">
        <h3>Engagement trends</h3>
        {engagement.length === 0 ? <p>No engagement data for this period.</p> : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={engagement}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} stroke="#888" fontSize={12} />
              <YAxis allowDecimals={false} stroke="#888" fontSize={12} />
              <Tooltip labelFormatter={formatShortDate} contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #333", color: "#fff" }} />
              <Legend />
              <Line type="monotone" dataKey="posts" stroke="#fff" strokeWidth={2} name="Posts" dot={false} />
              <Line type="monotone" dataKey="comments" stroke="#aaa" strokeWidth={2} name="Comments" dot={false} />
              <Line type="monotone" dataKey="reactions" stroke="#666" strokeWidth={2} name="Reactions" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="workspace-panel">
        <h3>Daily active users</h3>
        {activeUsers.length === 0 ? <p>No active user data for this period.</p> : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={activeUsers}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} stroke="#888" fontSize={12} />
              <YAxis allowDecimals={false} stroke="#888" fontSize={12} />
              <Tooltip labelFormatter={formatShortDate} contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #333", color: "#fff" }} />
              <Bar dataKey="activeUsers" fill="#aaa" name="Active users" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="workspace-panel">
        <h3>Top posts by reactions</h3>
        {topPosts.length === 0 ? <p>No posts to rank yet.</p> : (
          <div className="workspace-table-wrap">
            <table className="workspace-table">
              <thead><tr><th>Title</th><th>Author</th><th>Reactions</th><th>Comments</th></tr></thead>
              <tbody>
                {topPosts.map((post) => (
                  <tr key={post.id}>
                    <td>{post.title}</td>
                    <td>{post.authorName}</td>
                    <td>{post.reactionCount}</td>
                    <td>{post.commentCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
