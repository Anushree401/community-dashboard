
import { useCallback, useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import AuthPage from "./pages/auth/AuthPage";
import HomePage from "./pages/home/HomePage";
import CommunitiesPage from "./pages/communities/CommunitiesPage";
import WorkspacePage from "./pages/workspace/WorkspacePage";
import AppLayout from "./components/layout/AppLayout";
import CreateCommunityDialog from "./components/communities/CreateCommunityDialog";

import {
  apiRequest,
  listPublicCommunities,
  createCommunity,
  joinCommunity,
  getCommunity,
  listMyCommunities,
} from "./lib/api";

import type { AuthMode, AuthUser } from "./types/auth";
import type { Community, Membership } from "./types/community";

const TOKEN_KEY = "ceh_session_token";
const MY_COMMUNITIES_KEY = "ceh_my_community_ids";

function readCommunityIds(): string[] {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(MY_COMMUNITIES_KEY) || "[]",
    );

    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function saveCommunityIds(ids: string[]) {
  sessionStorage.setItem(
    MY_COMMUNITIES_KEY,
    JSON.stringify([...new Set(ids)]),
  );
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authChecking, setAuthChecking] = useState(true);

  const [publicCommunities, setPublicCommunities] = useState<Community[]>([]);
  const [myCommunities, setMyCommunities] = useState<Community[]>([]);
  const [communityIds, setCommunityIds] =
    useState<string[]>(readCommunityIds);

  const [selectedCommunity, setSelectedCommunity] =
    useState<Community | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loadingCommunities, setLoadingCommunities] = useState(false);
  const [communityError, setCommunityError] = useState("");
  const [actionError, setActionError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshCommunities = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  const rememberCommunity = useCallback((community: Community) => {
    setCommunityIds((previous) => {
      const next = [...new Set([...previous, community.id])];
      saveCommunityIds(next);
      return next;
    });

    setMyCommunities((previous) => [
      community,
      ...previous.filter((item) => item.id !== community.id),
    ]);
  }, []);

  // Restore and validate the current session.
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const token = sessionStorage.getItem(TOKEN_KEY);

      if (!token) {
        if (!cancelled) setAuthChecking(false);
        return;
      }

      try {
        const result = await apiRequest<{ user: AuthUser }>("/api/auth/me");

        if (!cancelled) {
          setUser(result.user);
        }
      } catch {
        sessionStorage.removeItem(TOKEN_KEY);

        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load public communities for discovery.
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    async function loadPublicCommunities() {
      setLoadingCommunities(true);
      setCommunityError("");

      try {
        const result = await listPublicCommunities();

        if (!cancelled) {
          setPublicCommunities(result.data);
        }
      } catch (error) {
        if (!cancelled) {
          setCommunityError(
            error instanceof Error
              ? error.message
              : "Could not load communities.",
          );
        }
      } finally {
        if (!cancelled) setLoadingCommunities(false);
      }
    }

    void loadPublicCommunities();

    return () => {
      cancelled = true;
    };
  }, [user, refreshKey]);

  // Restore communities created or joined in this browser session.
  // Restore communities from the authenticated user's database memberships.
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    async function loadMyCommunities() {
      setLoadingCommunities(true);
      setCommunityError("");

      try {
        const result = await listMyCommunities();

        if (!cancelled) {
          setMyCommunities(result.data);
        }
      } catch (error) {
        if (!cancelled) {
          setCommunityError(
            error instanceof Error
              ? error.message
              : "Could not load your communities.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingCommunities(false);
        }
      }
    }

    void loadMyCommunities();

    return () => {
      cancelled = true;
    };
  }, [user, refreshKey]);

  // Synchronize the selected community with the workspace URL.
  useEffect(() => {
    const match = location.pathname.match(/^\/community\/([^/]+)/);

    if (!match) {
      setSelectedCommunity(null);
      return;
    }

    const communityId = decodeURIComponent(match[1]);
    let cancelled = false;

    async function loadSelectedCommunity() {
      try {
        const result = await getCommunity(communityId);

        if (!cancelled) {
          setSelectedCommunity(result.community);
        }
      } catch {
        if (!cancelled) {
          setSelectedCommunity(null);
        }
      }
    }

    void loadSelectedCommunity();

    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  const handleSignOut = useCallback(async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch {
      // Clear the local session even if the logout request fails.
    }

    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(MY_COMMUNITIES_KEY);

    setUser(null);
    setMyCommunities([]);
    setCommunityIds([]);
    setPublicCommunities([]);
    setSelectedCommunity(null);
    setCreateDialogOpen(false);

    navigate("/login", { replace: true });
  }, [navigate]);

  // Submit the create-community dialog to the real backend.
  const handleCreateCommunity = useCallback(
    async (input: {
      name: string;
      description: string;
      visibility: "PUBLIC" | "PRIVATE";
    }) => {
      setActionError("");

      const result = await createCommunity({
        name: input.name,
        description: input.description || undefined,
        visibility: input.visibility,
      });

      rememberCommunity(result.community);
      setSelectedCommunity(result.community);
      setCreateDialogOpen(false);
      refreshCommunities();

      navigate(`/community/${result.community.id}`);
    },
    [navigate, refreshCommunities, rememberCommunity],
  );

  const handleJoinCommunity = useCallback(
    async (community: Community) => {
      setActionError("");

      try {
        await joinCommunity(community.id);

        const result = await getCommunity(community.id);

        if (result.membership?.status === "ACTIVE") {
          rememberCommunity(result.community);
          refreshCommunities();

          // Navigate only after membership is confirmed active.
          navigate(`/community/${community.id}`);
        } else {
          setActionError(
            "Your membership is pending approval. It will not appear in your active communities yet.",
          );
        }
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : "Could not join the community.",
        );
      }
    },
    [navigate, refreshCommunities, rememberCommunity],
  );

  if (authChecking) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-500">Restoring your session...</p>
      </main>
    );
  }

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={
            user ? (
              <Navigate to="/" replace />
            ) : (
              <AuthPage
                mode={authMode}
                setMode={setAuthMode}
                onAuthenticated={(authenticatedUser) => {
                  setUser(authenticatedUser);
                  navigate("/", { replace: true });
                }}
              />
            )
          }
        />

        <Route
          element={
            user ? (
              <AppLayout
                user={user}
                selectedCommunity={selectedCommunity}
                search={search}
                onSearchChange={setSearch}
                onSignOut={handleSignOut}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        >
          <Route
            path="/"
            element={
              user ? (
                <HomePage
                  user={user}
                  communities={myCommunities}
                  loading={loadingCommunities}
                  onCreate={() => setCreateDialogOpen(true)}
                  onDiscover={() => navigate("/communities")}
                />
              ) : null
            }
          />

          <Route
            path="/communities"
            element={
              <CommunitiesPage
                items={publicCommunities}
                loading={loadingCommunities}
                error={communityError || actionError}
                query={search}
                onRetry={refreshCommunities}
                onCreate={() => setCreateDialogOpen(true)}
                onJoin={(community) => void handleJoinCommunity(community)}
                onOpen={(community) =>
                  navigate(`/community/${community.id}`)
                }
              />
            }
          />

          <Route
            path="/community/:id/*"
            element={<WorkspacePage />}
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {user && (
        <CreateCommunityDialog
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
          onSubmit={handleCreateCommunity}
        />
      )}
    </>
  );
}
