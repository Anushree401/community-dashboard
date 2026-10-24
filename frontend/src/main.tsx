import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
    return (
        <main>
            <h1>Community Engagement Hub</h1>
            <p>Frontend setup successful.</p>
        </main>
    );
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);