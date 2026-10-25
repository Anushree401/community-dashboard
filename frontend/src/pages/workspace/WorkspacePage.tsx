import { useNavigate, useParams } from "react-router-dom";
import CommunityWorkspace from "../../components/communities/CommunityWorkspace";

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  if (!id) {
    return (
      <section className="page-content">
        <h1>Community not found</h1>
        <button
          className="outline-button"
          type="button"
          onClick={() => navigate("/")}
        >
          Back to home
        </button>
      </section>
    );
  }

  return (
    <CommunityWorkspace
      communityId={id}
      onBack={() => navigate("/")}
    />
  );
}
