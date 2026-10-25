export type Community = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  createdAt: string;
  updatedAt?: string;
  createdById?: string;
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
