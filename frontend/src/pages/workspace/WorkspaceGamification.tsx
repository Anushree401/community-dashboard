import { useCallback, useEffect, useState } from "react";
import {
  awardCommunityBadge,
  awardCommunityPoints,
  getCommunityBadges,
  getCommunityLeaderboard,
  getMyCommunityBadges,
  getMyCommunityPointHistory,
  getMyCommunityPoints,
  type GamificationBadge,
  type GamificationBadgeAward,
  type GamificationLeaderboardEntry,
  type GamificationPoints,
  type GamificationTransaction,
} from "../../lib/api";

type Props = {
  communityId: string;
  canManage?: boolean;
};

function makeIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `admin-adjustment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function WorkspaceGamification({
  communityId,
  canManage = false,
}: Props) {
  const [points, setPoints] = useState<GamificationPoints | null>(null);
  const [leaderboard, setLeaderboard] = useState<GamificationLeaderboardEntry[]>([]);
  const [transactions, setTransactions] = useState<GamificationTransaction[]>([]);
  const [badges, setBadges] = useState<GamificationBadge[]>([]);
  const [awards, setAwards] = useState<GamificationBadgeAward[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [targetUser, setTargetUser] = useState("");
  const [awardPoints, setAwardPoints] = useState("10");
  const [selectedBadge, setSelectedBadge] = useState("");
  const [awardMessage, setAwardMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const [
        pointResult,
        leaderboardResult,
        historyResult,
        badgeResult,
        awardResult,
      ] = await Promise.all([
        getMyCommunityPoints(communityId),
        getCommunityLeaderboard(communityId),
        getMyCommunityPointHistory(communityId),
        getCommunityBadges(),
        getMyCommunityBadges(communityId),
      ]);

      setPoints(pointResult);
      setLeaderboard(leaderboardResult.leaderboard ?? []);
      setTransactions(historyResult.transactions ?? []);
      setBadges(badgeResult.badges ?? []);
      setAwards(awardResult.awards ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load gamification data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [communityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitPoints(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(awardPoints);
    if (!targetUser.trim() || !Number.isInteger(amount) || amount < 1 || amount > 10000) {
      setAwardMessage("Enter a valid member user ID and a whole-number point amount from 1 to 10,000.");
      return;
    }

    setSubmitting(true);
    setAwardMessage("");

    try {
      await awardCommunityPoints(communityId, {
        userId: targetUser.trim(),
        points: amount,
        reason: "ADMIN_ADJUSTMENT",
        idempotencyKey: makeIdempotencyKey(),
      });
      setAwardMessage("Points awarded successfully.");
      await load(true);
    } catch (err) {
      setAwardMessage(err instanceof Error ? err.message : "Could not award points.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitBadge(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetUser.trim() || !selectedBadge) {
      setAwardMessage("Enter a member user ID and select a badge.");
      return;
    }

    setSubmitting(true);
    setAwardMessage("");

    try {
      await awardCommunityBadge(communityId, {
        userId: targetUser.trim(),
        badgeId: selectedBadge,
        reason: "Awarded by a community manager",
      });
      setAwardMessage("Badge awarded successfully.");
      await load(true);
    } catch (err) {
      setAwardMessage(err instanceof Error ? err.message : "Could not award badge.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <section className="workspace-section">
        <h2>Gamification</h2>
        <p role="status">Loading points, badges and leaderboard…</p>
      </section>
    );
  }

  if (error && !points) {
    return (
      <section className="workspace-section">
        <h2>Gamification</h2>
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
          <h2>Gamification</h2>
          <p>Recognize contributions, track your points and celebrate community achievements.</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={refreshing}
          onClick={() => void load(true)}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p className="workspace-error" role="alert">{error}</p>}

      <div className="workspace-stats">
        <article className="workspace-stat">
          <span>Your points</span>
          <strong>{points?.points ?? 0}</strong>
        </article>
        <article className="workspace-stat">
          <span>Your badges</span>
          <strong>{awards.length}</strong>
        </article>
        <article className="workspace-stat">
          <span>Ranked members</span>
          <strong>{leaderboard.length}</strong>
        </article>
      </div>

      <div className="workspace-panel">
        <h3>Community leaderboard</h3>
        {leaderboard.length === 0 ? <p>No members to rank yet.</p> : (
          <div className="workspace-table-wrap">
            <table className="workspace-table">
              <thead><tr><th>Rank</th><th>Member</th><th>Points</th></tr></thead>
              <tbody>
                {leaderboard.map((entry) => (
                  <tr key={entry.userId}>
                    <td>{entry.rank}</td>
                    <td>{entry.displayName}{entry.userId === points?.userId ? " (You)" : ""}</td>
                    <td>{entry.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="workspace-panel">
        <h3>Your badges</h3>
        {awards.length === 0 ? <p>You haven't earned a badge in this community yet.</p> : (
          <div className="workspace-badge-grid">
            {awards.map((award) => (
              <article className="workspace-badge" key={award.id}>
                <strong>{award.badge.name}</strong>
                <p>{award.badge.description}</p>
                <small>Earned {new Date(award.awardedAt).toLocaleDateString()}</small>
                {award.reason && <p>{award.reason}</p>}
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="workspace-panel">
        <h3>Point history</h3>
        {transactions.length === 0 ? <p>No point transactions yet.</p> : (
          <div className="workspace-table-wrap">
            <table className="workspace-table">
              <thead><tr><th>Date</th><th>Reason</th><th>Points</th></tr></thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{new Date(transaction.createdAt).toLocaleDateString()}</td>
                    <td>{transaction.reason.replaceAll("_", " ").toLowerCase()}</td>
                    <td>{transaction.points > 0 ? "+" : ""}{transaction.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canManage && (
        <div className="workspace-panel">
          <h3>Recognize a member</h3>
          <p>Enter the recipient's user ID from member-management data.</p>
          <label className="workspace-field">
            Member user ID
            <input
              value={targetUser}
              onChange={(event) => setTargetUser(event.target.value)}
              required
              placeholder="UUID of the member"
            />
          </label>

          <form onSubmit={submitPoints} className="workspace-form">
            <h4>Award points</h4>
            <label className="workspace-field">
              Points
              <input
                type="number"
                min="1"
                max="10000"
                step="1"
                value={awardPoints}
                onChange={(event) => setAwardPoints(event.target.value)}
                required
              />
            </label>
            <p>Manual awards are recorded as an admin adjustment.</p>
            <button
              className="primary-button"
              type="submit"
              disabled={submitting || !targetUser.trim()}
            >
              Award points
            </button>
          </form>

          <form onSubmit={submitBadge} className="workspace-form">
            <h4>Award a badge</h4>
            <label className="workspace-field">
              Badge
              <select
                value={selectedBadge}
                onChange={(event) => setSelectedBadge(event.target.value)}
                required
              >
                <option value="">Select a badge</option>
                {badges.map((badge) => (
                  <option value={badge.id} key={badge.id}>{badge.name}</option>
                ))}
              </select>
            </label>
            <button
              className="primary-button"
              type="submit"
              disabled={submitting || !targetUser.trim() || !selectedBadge}
            >
              Award badge
            </button>
          </form>
          {awardMessage && <p role="status">{awardMessage}</p>}
        </div>
      )}
    </section>
  );
}
