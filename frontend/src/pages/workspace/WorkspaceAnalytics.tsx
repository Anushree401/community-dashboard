
import { useCallback, useEffect, useState } from "react";
import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    Bar,
    BarChart,
} from "recharts";

import {
    getCommunityActiveUsers,
    getCommunityEngagement,
    getCommunityMembershipGrowth,
    getCommunityOverview,
    type ActiveUsersResponse,
    type CommunityOverview,
    type EngagementResponse,
    type MembershipGrowthResponse,
} from "../../lib/api";

type Props = {
    communityId: string;
};

type Days = 7 | 30 | 90;

function formatDate(value: string) {
    return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
    });
}

function MetricCard({
    label,
    value,
    detail,
}: {
    label: string;
    value: number;
    detail?: string;
}) {
    return (
        <article className="workspace-stat">
            <span>{label}</span>
            <strong>{value.toLocaleString()}</strong>
            {detail && <small>{detail}</small>}
        </article>
    );
}

export default function WorkspaceAnalytics({ communityId }: Props) {
    const [days, setDays] = useState<Days>(30);
    const [overview, setOverview] = useState<CommunityOverview | null>(null);
    const [growth, setGrowth] = useState<MembershipGrowthResponse | null>(null);
    const [engagement, setEngagement] =
        useState<EngagementResponse | null>(null);
    const [activeUsers, setActiveUsers] =
        useState<ActiveUsersResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const loadAnalytics = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const [overviewResult, growthResult, engagementResult, activeResult] =
                await Promise.all([
                    getCommunityOverview(communityId),
                    getCommunityMembershipGrowth(communityId, days),
                    getCommunityEngagement(communityId, days),
                    getCommunityActiveUsers(communityId, days),
                ]);

            setOverview(overviewResult);
            setGrowth(growthResult);
            setEngagement(engagementResult);
            setActiveUsers(activeResult);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to load community analytics.",
            );
        } finally {
            setLoading(false);
        }
    }, [communityId, days]);

    useEffect(() => {
        void loadAnalytics();
    }, [loadAnalytics]);

    if (loading) {
        return (
            <section className="workspace-section">
                <h2>Community analytics</h2>
                <p role="status">Loading analytics…</p>
            </section>
        );
    }

    if (error) {
        return (
            <section className="workspace-section">
                <h2>Community analytics</h2>
                <p className="workspace-error" role="alert">{error}</p>
                <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void loadAnalytics()}
                >
                    Retry
                </button>
            </section>
        );
    }

    const engagementData = engagement?.engagement ?? [];
    const growthData = growth?.growth ?? [];
    const activeData = activeUsers?.dailyActiveUsers ?? [];

    return (
        <section className="workspace-section workspace-analytics">
            <div className="workspace-section-heading">
                <div>
                    <h2>Community analytics</h2>
                    <p>Measure activity, participation, and community growth.</p>
                </div>

                <label>
                    Reporting period{" "}
                    <select
                        value={days}
                        onChange={(event) => setDays(Number(event.target.value) as Days)}
                    >
                        <option value={7}>Last 7 days</option>
                        <option value={30}>Last 30 days</option>
                        <option value={90}>Last 90 days</option>
                    </select>
                </label>
            </div>

            <div className="workspace-stats">
                <MetricCard
                    label="Total members"
                    value={overview?.members.total ?? 0}
                />
                <MetricCard
                    label="Active members"
                    value={overview?.members.active ?? 0}
                />
                <MetricCard
                    label="Published posts"
                    value={overview?.content.publishedPosts ?? 0}
                />
                <MetricCard
                    label="Comments"
                    value={overview?.content.comments ?? 0}
                />
                <MetricCard
                    label="Reactions"
                    value={overview?.content.reactions ?? 0}
                />
                <MetricCard
                    label="Net points awarded"
                    value={overview?.gamification.netPointsAwarded ?? 0}
                />
            </div>

            <div className="workspace-stats">
                <MetricCard
                    label="Daily active users"
                    value={activeUsers?.dau ?? 0}
                    detail="Latest day in the selected reporting period"
                />
                <MetricCard
                    label="Monthly active users"
                    value={activeUsers?.mau ?? 0}
                    detail="Rolling 30-day window"
                />
            </div>

            <div className="workspace-panel">
                <h3>Daily engagement</h3>
                <p>Published posts, comments, and reactions per day.</p>

                {engagementData.length === 0 ? (
                    <p>No engagement data is available for this period.</p>
                ) : (
                    <div className="workspace-chart">
                        <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={engagementData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={formatDate}
                                    minTickGap={24}
                                />
                                <YAxis allowDecimals={false} />
                                <Tooltip labelFormatter={(label) => formatDate(String(label))} />
                                <Legend />
                                <Line
                                    type="monotone"
                                    dataKey="posts"
                                    name="Posts"
                                    stroke="#2563eb"
                                    strokeWidth={2}
                                    dot={false}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="comments"
                                    name="Comments"
                                    stroke="#16a34a"
                                    strokeWidth={2}
                                    dot={false}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="reactions"
                                    name="Reactions"
                                    stroke="#9333ea"
                                    strokeWidth={2}
                                    dot={false}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>

            <div className="workspace-panel">
                <h3>Membership growth</h3>
                <p>New member additions per day.</p>

                {growthData.length === 0 ? (
                    <p>No membership growth data is available for this period.</p>
                ) : (
                    <div className="workspace-chart">
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={growthData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={formatDate}
                                    minTickGap={24}
                                />
                                <YAxis allowDecimals={false} />
                                <Tooltip labelFormatter={(label) => formatDate(String(label))} />
                                <Bar
                                    dataKey="newMembers"
                                    name="New members"
                                    fill="#2563eb"
                                    radius={[4, 4, 0, 0]}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>

            <div className="workspace-panel">
                <h3>Daily active users</h3>
                <p>
                    Unique members who created a post, created a comment, or added a
                    reaction each day.
                </p>

                {activeData.length === 0 ? (
                    <p>No active-user data is available for this period.</p>
                ) : (
                    <div className="workspace-chart">
                        <ResponsiveContainer width="100%" height={280}>
                            <LineChart data={activeData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={formatDate}
                                    minTickGap={24}
                                />
                                <YAxis allowDecimals={false} />
                                <Tooltip labelFormatter={(label) => formatDate(String(label))} />
                                <Line
                                    type="monotone"
                                    dataKey="activeUsers"
                                    name="Active users"
                                    stroke="#0d9488"
                                    strokeWidth={2}
                                    dot={false}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </section>
    );
}
