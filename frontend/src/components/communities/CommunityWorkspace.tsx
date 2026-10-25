
import { useCallback, useEffect, useState } from "react";
import {
    createCommunityAnnouncement,
    createCommunityPost,
    getCommunity,
    getCommunityAnnouncements,
    getCommunityMembers,
    getCommunityOverview,
    getCommunityPosts,
    inviteCommunityMember,
    updateCommunitySettings,
    type Community,
    type CommunityAnnouncement,
    type CommunityMember,
    type CommunityOverview,
    type CommunityPost,
    type Membership,
} from "../../lib/api";
import WorkspaceAnalytics from "../../pages/workspace/WorkspaceAnalytics";
import WorkspaceGamification from "../../pages/workspace/WorkspaceGamification";

type Tab =
    | "overview"
    | "posts"
    | "announcements"
    | "members"
    | "analytics"
    | "gamification";

type Props = {
    communityId: string;
    onBack: () => void;
};

type CommunityDetails = Community & {
    updatedAt?: string;
    createdById?: string;
};

function formatDate(value: string) {
    return new Date(value).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

function ErrorMessage({ message }: { message: string }) {
    return (
        <p className="workspace-error" role="alert">
            {message}
        </p>
    );
}

function SuccessMessage({ message }: { message: string }) {
    return (
        <p className="workspace-success" role="status">
            {message}
        </p>
    );
}

function EmptyState({
    title,
    description,
}: {
    title: string;
    description: string;
}) {
    return (
        <div className="workspace-empty">
            <h3>{title}</h3>
            <p>{description}</p>
        </div>
    );
}

export default function CommunityWorkspace({
    communityId,
    onBack,
}: Props) {
    const [community, setCommunity] = useState<CommunityDetails | null>(null);
    const [membership, setMembership] = useState<Membership | null>(null);
    const [tab, setTab] = useState<Tab>("overview");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [actionError, setActionError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [refreshKey, setRefreshKey] = useState(0);

    const [overview, setOverview] = useState<CommunityOverview | null>(null);
    const [posts, setPosts] = useState<CommunityPost[]>([]);
    const [announcements, setAnnouncements] = useState<
        CommunityAnnouncement[]
    >([]);
    const [members, setMembers] = useState<CommunityMember[]>([]);

    const [postTitle, setPostTitle] = useState("");
    const [postBody, setPostBody] = useState("");
    const [announcementTitle, setAnnouncementTitle] = useState("");
    const [announcementBody, setAnnouncementBody] = useState("");
    const [busy, setBusy] = useState(false);

    // Edit community dialog
    const [editOpen, setEditOpen] = useState(false);
    const [editName, setEditName] = useState("");
    const [editDescription, setEditDescription] = useState("");
    const [editVisibility, setEditVisibility] =
        useState<"PUBLIC" | "PRIVATE">("PUBLIC");
    const [savingSettings, setSavingSettings] = useState(false);

    // Invite member dialog
    const [inviteOpen, setInviteOpen] = useState(false);
    const [inviteEmail, setInviteEmail] = useState("");
    const [sendingInvite, setSendingInvite] = useState(false);

    const isAdmin = membership?.role === "COMMUNITY_ADMIN";

    const canManage =
        membership?.role === "COMMUNITY_ADMIN" ||
        membership?.role === "MODERATOR";

    const loadWorkspace = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const result = await getCommunity(communityId);
            setCommunity(result.community);
            setMembership(result.membership);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to load this community.",
            );
        } finally {
            setLoading(false);
        }
    }, [communityId]);

    useEffect(() => {
        void loadWorkspace();
    }, [loadWorkspace, refreshKey]);

    useEffect(() => {
        if (!community || !membership) return;

        let cancelled = false;

        async function loadTabData() {
            setActionError("");

            try {
                if (tab === "overview") {
                    if (
                        membership?.role === "COMMUNITY_ADMIN" ||
                        membership?.role === "MODERATOR"
                    ) {
                        const result = await getCommunityOverview(communityId);
                        if (!cancelled) setOverview(result);
                    }
                }

                if (tab === "posts") {
                    const result = await getCommunityPosts(communityId);
                    if (!cancelled) setPosts(result.posts);
                }

                if (tab === "announcements") {
                    const result =
                        await getCommunityAnnouncements(communityId);
                    if (!cancelled) {
                        setAnnouncements(result.announcements);
                    }
                }

                if (tab === "members") {
                    const result = await getCommunityMembers(communityId);
                    if (!cancelled) setMembers(result.members);
                }
            } catch (err) {
                if (!cancelled) {
                    setActionError(
                        err instanceof Error
                            ? err.message
                            : "Unable to load this section.",
                    );
                }
            }
        }

        void loadTabData();

        return () => {
            cancelled = true;
        };
    }, [communityId, community, membership, tab, refreshKey]);

    function openEditDialog() {
        if (!community) return;

        setEditName(community.name);
        setEditDescription(community.description ?? "");
        setEditVisibility(
            community.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC",
        );
        setActionError("");
        setSuccessMessage("");
        setEditOpen(true);
    }

    async function handleSaveSettings(
        event: React.FormEvent<HTMLFormElement>,
    ) {
        event.preventDefault();

        if (!isAdmin) {
            setActionError("Only a community admin can edit these details.");
            return;
        }

        const name = editName.trim();
        const description = editDescription.trim();

        if (!name) {
            setActionError("Community name is required.");
            return;
        }

        setSavingSettings(true);
        setActionError("");
        setSuccessMessage("");

        try {
            await updateCommunitySettings(communityId, {
                name,
                description,
                visibility: editVisibility,
            });

            setCommunity((current) =>
                current
                    ? {
                        ...current,
                        name,
                        description,
                        visibility: editVisibility,
                    }
                    : current,
            );

            setEditOpen(false);
            setSuccessMessage("Community details updated successfully.");
            setRefreshKey((value) => value + 1);
        } catch (err) {
            setActionError(
                err instanceof Error
                    ? err.message
                    : "Unable to update community details.",
            );
        } finally {
            setSavingSettings(false);
        }
    }

    async function handleInviteMember(
        event: React.FormEvent<HTMLFormElement>,
    ) {
        event.preventDefault();

        if (!isAdmin) {
            setActionError("Only a community admin can invite members.");
            return;
        }

        const email = inviteEmail.trim();

        if (!email) {
            setActionError("Enter the email address of the person to invite.");
            return;
        }

        setSendingInvite(true);
        setActionError("");
        setSuccessMessage("");

        try {
            await inviteCommunityMember(communityId, email);

            setInviteEmail("");
            setInviteOpen(false);
            setSuccessMessage(
                `Invitation created for ${email}. They must accept it to join the community.`,
            );
        } catch (err) {
            setActionError(
                err instanceof Error
                    ? err.message
                    : "Unable to invite this member.",
            );
        } finally {
            setSendingInvite(false);
        }
    }

    async function handleCreatePost(
        event: React.FormEvent<HTMLFormElement>,
    ) {
        event.preventDefault();
        setBusy(true);
        setActionError("");
        setSuccessMessage("");

        try {
            await createCommunityPost(communityId, {
                title: postTitle.trim(),
                body: postBody.trim(),
            });

            setPostTitle("");
            setPostBody("");
            setSuccessMessage("Post published successfully.");
            setRefreshKey((value) => value + 1);
        } catch (err) {
            setActionError(
                err instanceof Error
                    ? err.message
                    : "Unable to create the post.",
            );
        } finally {
            setBusy(false);
        }
    }

    async function handleCreateAnnouncement(
        event: React.FormEvent<HTMLFormElement>,
    ) {
        event.preventDefault();
        setBusy(true);
        setActionError("");
        setSuccessMessage("");

        try {
            await createCommunityAnnouncement(communityId, {
                title: announcementTitle.trim(),
                body: announcementBody.trim(),
                status: "PUBLISHED",
            });

            setAnnouncementTitle("");
            setAnnouncementBody("");
            setSuccessMessage("Announcement published successfully.");
            setRefreshKey((value) => value + 1);
        } catch (err) {
            setActionError(
                err instanceof Error
                    ? err.message
                    : "Unable to create the announcement.",
            );
        } finally {
            setBusy(false);
        }
    }

    if (loading) {
        return (
            <main className="page-content community-workspace">
                <button className="text-button" onClick={onBack}>
                    ← Back
                </button>
                <p>Loading community...</p>
            </main>
        );
    }

    if (error || !community) {
        return (
            <main className="page-content community-workspace">
                <button className="text-button" onClick={onBack}>
                    ← Back
                </button>
                <ErrorMessage message={error || "Community not found."} />
                <button
                    className="primary-button"
                    onClick={() => setRefreshKey((value) => value + 1)}
                >
                    Retry
                </button>
            </main>
        );
    }

    if (!membership || membership.status !== "ACTIVE") {
        return (
            <main className="page-content community-workspace">
                <button className="text-button" onClick={onBack}>
                    ← Back
                </button>
                <h1>{community.name}</h1>
                <p>
                    You must be an active member to access this workspace.
                </p>
            </main>
        );
    }

    return (
        <main className="page-content community-workspace">
            <button className="text-button" onClick={onBack}>
                ← Back to communities
            </button>

            <header className="workspace-header">
                <div>
                    <p className="eyebrow">COMMUNITY WORKSPACE</p>
                    <h1>{community.name}</h1>
                    <p>
                        {community.description ||
                            "No description has been added."}
                    </p>
                </div>

                <div className="workspace-header-actions">
                    <span className="workspace-role">
                        {membership.role.replaceAll("_", " ")}
                    </span>

                    {isAdmin && (
                        <button
                            type="button"
                            className="secondary-button"
                            onClick={openEditDialog}
                        >
                            Edit details
                        </button>
                    )}
                </div>
            </header>

            <nav className="workspace-tabs" aria-label="Community sections">
                {(
                    [
                        ["overview", "Overview"],
                        ["posts", "Posts"],
                        ["announcements", "Announcements"],
                        ["members", "Members"],
                        ["analytics", "Analytics"],
                        ["gamification", "Gamification"],
                    ] as [Tab, string][]
                ).map(([value, label]) => (
                    <button
                        key={value}
                        className={
                            tab === value
                                ? "workspace-tab active"
                                : "workspace-tab"
                        }
                        onClick={() => {
                            setTab(value);
                            setActionError("");
                            setSuccessMessage("");
                        }}
                    >
                        {label}
                    </button>
                ))}
            </nav>

            {actionError && <ErrorMessage message={actionError} />}
            {successMessage && (
                <SuccessMessage message={successMessage} />
            )}

            {tab === "overview" && (
                <section className="workspace-section">
                    <h2>Overview</h2>

                    {canManage ? (
                        overview ? (
                            <div className="workspace-stats">
                                <article className="workspace-stat">
                                    <span>Active members</span>
                                    <strong>{overview.members.active}</strong>
                                </article>

                                <article className="workspace-stat">
                                    <span>Published posts</span>
                                    <strong>
                                        {overview.content.publishedPosts}
                                    </strong>
                                </article>

                                <article className="workspace-stat">
                                    <span>Announcements</span>
                                    <strong>
                                        {
                                            overview.content
                                                .publishedAnnouncements
                                        }
                                    </strong>
                                </article>

                                <article className="workspace-stat">
                                    <span>Reactions</span>
                                    <strong>{overview.content.reactions}</strong>
                                </article>
                            </div>
                        ) : (
                            <p>
                                Loading community metrics or metrics are
                                unavailable.
                            </p>
                        )
                    ) : (
                        <div className="workspace-panel">
                            <h3>Welcome to {community.name}</h3>
                            <p>
                                Use the sections above to read community posts,
                                view announcements, and see the member
                                directory.
                            </p>
                        </div>
                    )}

                    <div className="workspace-panel">
                        <h3>Community details</h3>
                        <p>
                            {community.description ||
                                "No description has been added."}
                        </p>
                        <p>
                            Visibility: {community.visibility.toLowerCase()}
                        </p>
                        <p>
                            Created:{" "}
                            {community.createdAt
                                ? formatDate(community.createdAt)
                                : "—"}
                        </p>
                        {typeof community.updatedAt === "string" &&
                            community.updatedAt && (
                                <p>
                                    Updated: {formatDate(community.updatedAt)}
                                </p>
                            )}
                    </div>

                    {isAdmin && (
                        <div className="workspace-panel">
                            <h3>Manage community</h3>
                            <p>
                                Update your community information or invite
                                registered users to join.
                            </p>
                            <div className="workspace-inline-actions">
                                <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={openEditDialog}
                                >
                                    Edit details
                                </button>
                                <button
                                    type="button"
                                    className="primary-button"
                                    onClick={() => {
                                        setInviteEmail("");
                                        setActionError("");
                                        setSuccessMessage("");
                                        setInviteOpen(true);
                                    }}
                                >
                                    Add members
                                </button>
                            </div>
                        </div>
                    )}
                </section>
            )}

            {tab === "posts" && (
                <section className="workspace-section">
                    <h2>Community posts</h2>

                    <form
                        className="workspace-form"
                        onSubmit={handleCreatePost}
                    >
                        <h3>Create a post</h3>

                        <label htmlFor="community-post-title">Title</label>
                        <input
                            id="community-post-title"
                            value={postTitle}
                            onChange={(event) =>
                                setPostTitle(event.target.value)
                            }
                            maxLength={200}
                            required
                        />

                        <label htmlFor="community-post-body">Post</label>
                        <textarea
                            id="community-post-body"
                            value={postBody}
                            onChange={(event) =>
                                setPostBody(event.target.value)
                            }
                            rows={4}
                            maxLength={20000}
                            required
                        />

                        <button className="primary-button" disabled={busy}>
                            {busy ? "Publishing..." : "Publish post"}
                        </button>
                    </form>

                    {posts.length === 0 ? (
                        <EmptyState
                            title="No posts yet"
                            description="Create the first post for this community."
                        />
                    ) : (
                        <div className="workspace-list">
                            {posts.map((post) => (
                                <article
                                    className="workspace-panel"
                                    key={post.id}
                                >
                                    <div className="workspace-item-meta">
                                        <span>
                                            {post.author?.displayName ||
                                                "Community member"}
                                        </span>
                                        <span>{formatDate(post.createdAt)}</span>
                                    </div>

                                    <h3>{post.title}</h3>
                                    <p className="workspace-body">
                                        {post.body}
                                    </p>

                                    <div className="workspace-item-meta">
                                        <span>
                                            {post._count?.comments ?? 0}{" "}
                                            comments
                                        </span>
                                        <span>
                                            {post._count?.reactions ?? 0}{" "}
                                            reactions
                                        </span>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {tab === "announcements" && (
                <section className="workspace-section">
                    <h2>Announcements</h2>

                    {canManage && (
                        <form
                            className="workspace-form"
                            onSubmit={handleCreateAnnouncement}
                        >
                            <h3>Publish an announcement</h3>

                            <label htmlFor="announcement-title">Title</label>
                            <input
                                id="announcement-title"
                                value={announcementTitle}
                                onChange={(event) =>
                                    setAnnouncementTitle(event.target.value)
                                }
                                maxLength={200}
                                required
                            />

                            <label htmlFor="announcement-body">Message</label>
                            <textarea
                                id="announcement-body"
                                value={announcementBody}
                                onChange={(event) =>
                                    setAnnouncementBody(event.target.value)
                                }
                                rows={4}
                                required
                            />

                            <button
                                className="primary-button"
                                disabled={busy}
                            >
                                {busy
                                    ? "Publishing..."
                                    : "Publish announcement"}
                            </button>
                        </form>
                    )}

                    {announcements.length === 0 ? (
                        <EmptyState
                            title="No announcements"
                            description="Announcements published by community admins will appear here."
                        />
                    ) : (
                        <div className="workspace-list">
                            {announcements.map((announcement) => (
                                <article
                                    className="workspace-panel"
                                    key={announcement.id}
                                >
                                    <div className="workspace-item-meta">
                                        <span>{announcement.status}</span>
                                        <span>
                                            {formatDate(announcement.createdAt)}
                                        </span>
                                    </div>

                                    <h3>{announcement.title}</h3>
                                    <p className="workspace-body">
                                        {announcement.body}
                                    </p>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {tab === "members" && (
                <section className="workspace-section">
                    <div className="workspace-section-heading">
                        <h2>Members</h2>

                        {isAdmin && (
                            <button
                                type="button"
                                className="primary-button"
                                onClick={() => {
                                    setInviteEmail("");
                                    setActionError("");
                                    setSuccessMessage("");
                                    setInviteOpen(true);
                                }}
                            >
                                Add members
                            </button>
                        )}
                    </div>

                    {members.length === 0 ? (
                        <EmptyState
                            title="No members to display"
                            description="The member directory returned no active memberships."
                        />
                    ) : (
                        <div className="workspace-list">
                            {members.map((member) => (
                                <article
                                    className="workspace-member"
                                    key={member.userId}
                                >
                                    <div>
                                        <strong>
                                            {member.user?.displayName ||
                                                member.userId}
                                        </strong>
                                        {member.user?.email && (
                                            <p>{member.user.email}</p>
                                        )}
                                    </div>

                                    <span className="workspace-role">
                                        {member.role.replaceAll("_", " ")}
                                    </span>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {tab === "analytics" && (
                canManage ? (
                    <WorkspaceAnalytics communityId={communityId} />
                ) : (
                    <section className="workspace-section">
                        <h2>Analytics</h2>
                        <p>Analytics are available to community admins and moderators.</p>
                    </section>
                )
            )}

            {tab === "gamification" && (
                <WorkspaceGamification
                    communityId={communityId}
                    canManage={canManage}
                />
            )}

            {editOpen && (
                <div
                    className="workspace-modal-backdrop"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) {
                            setEditOpen(false);
                        }
                    }}
                >
                    <section
                        className="workspace-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="edit-community-title"
                    >
                        <div className="workspace-modal-header">
                            <div>
                                <p className="eyebrow">COMMUNITY SETTINGS</p>
                                <h2 id="edit-community-title">
                                    Edit community details
                                </h2>
                            </div>
                            <button
                                type="button"
                                className="workspace-modal-close"
                                aria-label="Close dialog"
                                onClick={() => setEditOpen(false)}
                            >
                                ×
                            </button>
                        </div>

                        <form
                            className="workspace-form"
                            onSubmit={handleSaveSettings}
                        >
                            <label htmlFor="edit-community-name">Name</label>
                            <input
                                id="edit-community-name"
                                value={editName}
                                onChange={(event) =>
                                    setEditName(event.target.value)
                                }
                                maxLength={100}
                                required
                            />

                            <label htmlFor="edit-community-description">
                                Description
                            </label>
                            <textarea
                                id="edit-community-description"
                                value={editDescription}
                                onChange={(event) =>
                                    setEditDescription(event.target.value)
                                }
                                rows={4}
                                maxLength={2000}
                            />

                            <label htmlFor="edit-community-visibility">
                                Visibility
                            </label>
                            <select
                                id="edit-community-visibility"
                                value={editVisibility}
                                onChange={(event) =>
                                    setEditVisibility(
                                        event.target.value as
                                        | "PUBLIC"
                                        | "PRIVATE",
                                    )
                                }
                            >
                                <option value="PUBLIC">Public</option>
                                <option value="PRIVATE">Private</option>
                            </select>

                            <div className="workspace-modal-actions">
                                <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={() => setEditOpen(false)}
                                    disabled={savingSettings}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="primary-button"
                                    disabled={savingSettings}
                                >
                                    {savingSettings
                                        ? "Saving..."
                                        : "Save changes"}
                                </button>
                            </div>
                        </form>
                    </section>
                </div>
            )}

            {inviteOpen && (
                <div
                    className="workspace-modal-backdrop"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) {
                            setInviteOpen(false);
                        }
                    }}
                >
                    <section
                        className="workspace-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="invite-community-title"
                    >
                        <div className="workspace-modal-header">
                            <div>
                                <p className="eyebrow">COMMUNITY MEMBERS</p>
                                <h2 id="invite-community-title">
                                    Invite a member
                                </h2>
                            </div>
                            <button
                                type="button"
                                className="workspace-modal-close"
                                aria-label="Close dialog"
                                onClick={() => setInviteOpen(false)}
                            >
                                ×
                            </button>
                        </div>

                        <p>
                            Enter the email address associated with the
                            person's account. They must accept the invitation
                            before they appear as an active member.
                        </p>

                        <form
                            className="workspace-form"
                            onSubmit={handleInviteMember}
                        >
                            <label htmlFor="invite-member-email">
                                Email address
                            </label>
                            <input
                                id="invite-member-email"
                                type="email"
                                value={inviteEmail}
                                onChange={(event) =>
                                    setInviteEmail(event.target.value)
                                }
                                placeholder="person@example.com"
                                autoComplete="email"
                                required
                            />

                            <div className="workspace-modal-actions">
                                <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={() => setInviteOpen(false)}
                                    disabled={sendingInvite}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="primary-button"
                                    disabled={sendingInvite}
                                >
                                    {sendingInvite
                                        ? "Sending invitation..."
                                        : "Create invitation"}
                                </button>
                            </div>
                        </form>
                    </section>
                </div>
            )}
        </main>
    );
}
