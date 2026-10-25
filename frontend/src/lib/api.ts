
const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000"
).replace(/\/$/, "");

export type Community = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  createdAt: string;
  updatedAt?: string;
  creator?: {
    id: string;
    displayName: string;
  };
  _count?: {
    memberships: number;
  };
};

export type Membership = {
  role: "COMMUNITY_ADMIN" | "MODERATOR" | "MEMBER";
  status: "ACTIVE" | "PENDING" | "BANNED";
};

type ApiOptions = Omit<RequestInit, "headers"> & {
  token?: string;
  headers?: HeadersInit;
};

export async function apiRequest<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const token =
    options.token ?? sessionStorage.getItem("ceh_session_token");

  const headers = new Headers(options.headers);

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 204) {
    if (!response.ok) {
      throw new Error("Request failed");
    }
    return undefined as T;
  }

  const result: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof result.error === "string"
        ? result.error
        : `Request failed (${response.status})`;

    if (response.status === 401) {
      sessionStorage.removeItem("ceh_session_token");
    }

    throw new Error(message);
  }

  return result as T;
}

export async function listPublicCommunities(page = 1) {
  return apiRequest<{
    data: Community[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }>(`/api/communities?page=${page}&limit=50`);
}

export async function listMyCommunities() {
  return apiRequest<{ data: Community[] }>("/api/communities/mine");
}

export async function createCommunity(input: {
  name: string;
  description?: string;
  visibility: "PUBLIC" | "PRIVATE";
}) {
  return apiRequest<{
    community: Community;
    membership: Membership;
  }>("/api/communities", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function joinCommunity(communityId: string) {
  return apiRequest<{ message?: string; membership: Membership }>(
    `/api/communities/${encodeURIComponent(communityId)}/join`,
    { method: "POST" },
  );
}

export async function getCommunity(communityId: string) {
  return apiRequest<{
    community: Community & {
      updatedAt: string;
      createdById: string;
    };
    membership: Membership | null;
  }>(`/api/communities/${encodeURIComponent(communityId)}`);
}

export async function leaveCommunity(communityId: string) {
  return apiRequest<{ message: string }>(
    `/api/communities/${encodeURIComponent(communityId)}/leave`,
    { method: "POST" },
  );
}

export type CommunityPost = {
  id: string;
  communityId: string;
  authorId: string;
  topicId: string | null;
  title: string;
  body: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  editedAt?: string | null;
  author?: {
    id: string;
    displayName: string;
    avatarUrl?: string | null;
  };
  topic?: {
    id: string;
    name: string;
  } | null;
  _count?: {
    comments: number;
    reactions: number;
  };
};

export type CommunityAnnouncement = {
  id: string;
  communityId: string;
  authorId: string;
  title: string;
  body: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
};

export type CommunityMember = {
  communityId: string;
  userId: string;
  role: "COMMUNITY_ADMIN" | "MODERATOR" | "MEMBER";
  status: string;
  user?: {
    id: string;
    displayName: string;
    email?: string;
    avatarUrl?: string | null;
  };
};

export type CommunityOverview = {
  communityId: string;
  members: {
    total: number;
    active: number;
    pending: number;
  };
  content: {
    publishedPosts: number;
    publishedAnnouncements: number;
    comments: number;
    reactions: number;
  };
  gamification: {
    netPointsAwarded: number;
  };
};

export type PaginatedResult<T> = {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  posts?: T[];
  announcements?: T[];
  members?: T[];
};

export async function getCommunityPosts(
  communityId: string,
  page = 1,
) {
  return apiRequest<{
    posts: CommunityPost[];
    pagination: PaginatedResult<CommunityPost>["pagination"];
  }>(
    `/api/posts/community/${encodeURIComponent(communityId)}?page=${page}&limit=20`,
  );
}

export async function createCommunityPost(
  communityId: string,
  input: {
    title: string;
    body: string;
    topicId?: string | null;
  },
) {
  return apiRequest<{ post: CommunityPost }>(
    `/api/posts/community/${encodeURIComponent(communityId)}`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function getCommunityAnnouncements(
  communityId: string,
  page = 1,
) {
  return apiRequest<{
    announcements: CommunityAnnouncement[];
    pagination: PaginatedResult<CommunityAnnouncement>["pagination"];
  }>(
    `/api/announcements/community/${encodeURIComponent(communityId)}?page=${page}&limit=20`,
  );
}

export async function createCommunityAnnouncement(
  communityId: string,
  input: {
    title: string;
    body: string;
    status?: "DRAFT" | "PUBLISHED";
  },
) {
  return apiRequest<{ announcement: CommunityAnnouncement }>(
    `/api/announcements/community/${encodeURIComponent(communityId)}`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function getCommunityMembers(
  communityId: string,
  page = 1,
) {
  return apiRequest<{
    members: CommunityMember[];
    pagination: PaginatedResult<CommunityMember>["pagination"];
  }>(
    `/api/communities/${encodeURIComponent(communityId)}/members?page=${page}&limit=50`,
  );
}

export async function getCommunityOverview(communityId: string) {
  return apiRequest<CommunityOverview>(
    `/api/analytics/community/${encodeURIComponent(communityId)}/overview`,
  );
}


export type MembershipGrowthPoint = {
  date: string;
  newMembers: number;
};

export type EngagementPoint = {
  date: string;
  posts: number;
  comments: number;
  reactions: number;
};

export type DailyActiveUserPoint = {
  date: string;
  activeUsers: number;
};

export type MembershipGrowthResponse = {
  communityId: string;
  days: number;
  growth: MembershipGrowthPoint[];
};

export type EngagementResponse = {
  communityId: string;
  days: number;
  engagement: EngagementPoint[];
};

export type ActiveUsersResponse = {
  communityId: string;
  days: number;
  dau: number;
  mau: number;
  dailyActiveUsers: DailyActiveUserPoint[];
  definition: {
    activeEvents: string[];
    mauWindowDays: number;
  };
};

export async function getCommunityMembershipGrowth(
  communityId: string,
  days = 30,
) {
  return apiRequest<MembershipGrowthResponse>(
    `/api/analytics/community/${encodeURIComponent(communityId)}/membership-growth?days=${days}`,
  );
}

export async function getCommunityEngagement(
  communityId: string,
  days = 30,
) {
  return apiRequest<EngagementResponse>(
    `/api/analytics/community/${encodeURIComponent(communityId)}/engagement?days=${days}`,
  );
}

export async function getCommunityActiveUsers(
  communityId: string,
  days = 30,
) {
  return apiRequest<ActiveUsersResponse>(
    `/api/analytics/community/${encodeURIComponent(communityId)}/active-users?days=${days}`,
  );
}


export async function getCommunityLeaderboard(communityId: string) {
  return apiRequest<unknown>(
    `/api/gamification/community/${encodeURIComponent(communityId)}/leaderboard`,
  );
}

export async function getMyCommunityPoints(communityId: string) {
  return apiRequest<unknown>(
    `/api/gamification/community/${encodeURIComponent(communityId)}/points`,
  );
}

export async function updateCommunitySettings(
  communityId: string,
  input: {
    name?: string;
    description?: string | null;
    visibility?: "PUBLIC" | "PRIVATE";
  },
) {
  return apiRequest<{ community: Community }>(
    `/api/communities/${encodeURIComponent(communityId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export async function changeCommunityMemberRole(
  communityId: string,
  userId: string,
  role: "MEMBER" | "MODERATOR" | "COMMUNITY_ADMIN",
) {
  return apiRequest<{ membership: CommunityMember }>(
    `/api/communities/${encodeURIComponent(communityId)}/members/${encodeURIComponent(userId)}/role`,
    {
      method: "PATCH",
      body: JSON.stringify({ role }),
    },
  );
}

export async function removeCommunityMember(
  communityId: string,
  userId: string,
) {
  return apiRequest<void>(
    `/api/communities/${encodeURIComponent(communityId)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
}
export async function inviteCommunityMember(
  communityId: string,
  email: string,
) {
  return apiRequest<{
    invitation: {
      id: string;
      communityId: string;
      inviteeId: string;
      expiresAt: string;
      createdAt: string;
    };
  }>(`/api/communities/${encodeURIComponent(communityId)}/invitations`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}
export type GamificationPoints = {
  communityId: string;
  userId: string;
  points: number;
};

export type GamificationTransaction = {
  id: string;
  points: number;
  reason: string;
  activityId: string | null;
  postId: string | null;
  createdAt: string;
  createdById: string | null;
};

export type GamificationLeaderboardEntry = {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  points: number;
};

export type GamificationBadge = {
  id: string;
  code: string;
  name: string;
  description: string;
  iconPath: string | null;
};

export type GamificationBadgeAward = {
  id: string;
  awardedAt: string;
  reason: string | null;
  badge: GamificationBadge;
  awardedBy: { id: string; displayName: string } | null;
};

export async function getMyCommunityPointHistory(communityId: string) {
  return apiRequest<{
    transactions: GamificationTransaction[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }>(
    `/api/gamification/community/${encodeURIComponent(communityId)}/points/history`,
  );
}

export async function getCommunityBadges() {
  return apiRequest<{ badges: GamificationBadge[] }>("/api/gamification/badges");
}

export async function getMyCommunityBadges(communityId: string) {
  return apiRequest<{ awards: GamificationBadgeAward[] }>(
    `/api/gamification/community/${encodeURIComponent(communityId)}/badges`,
  );
}

export async function awardCommunityPoints(
  communityId: string,
  input: {
    userId: string;
    points: number;
    reason: string;
    idempotencyKey?: string;
  },
) {
  return apiRequest<{ transaction: GamificationTransaction }>(
    `/api/gamification/community/${encodeURIComponent(communityId)}/points/award`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function awardCommunityBadge(
  communityId: string,
  input: { userId: string; badgeId: string; reason?: string },
) {
  return apiRequest<{ award: GamificationBadgeAward }>(
    `/api/gamification/community/${encodeURIComponent(communityId)}/badges/award`,
    { method: "POST", body: JSON.stringify(input) },
  );
}
