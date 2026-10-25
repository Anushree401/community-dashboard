
import { useState } from "react";

type CreateCommunityDialogProps = {
    open: boolean;
    onClose: () => void;
    onSubmit: (input: {
        name: string;
        description: string;
        visibility: "PUBLIC" | "PRIVATE";
    }) => Promise<void>;
};

export default function CreateCommunityDialog({
    open,
    onClose,
    onSubmit,
}: CreateCommunityDialogProps) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    if (!open) return null;

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const trimmedName = name.trim();

        if (trimmedName.length < 2) {
            setError("Community name must contain at least 2 characters.");
            return;
        }

        setSubmitting(true);
        setError("");

        try {
            await onSubmit({
                name: trimmedName,
                description: description.trim(),
                visibility,
            });

            setName("");
            setDescription("");
            setVisibility("PUBLIC");
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not create community.");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div
            className="fixed inset-0 z-[9999] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget && !submitting) onClose();
            }}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="create-community-title"
                className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 text-gray-900 shadow-2xl dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
                <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <h2 id="create-community-title" className="text-xl font-semibold">
                            Create a community
                        </h2>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            Create a space for people to connect and collaborate.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        aria-label="Close dialog"
                        className="rounded-lg px-3 py-1 text-xl hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800"
                    >
                        ×
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label htmlFor="community-name" className="mb-2 block text-sm font-medium">
                            Community name <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="community-name"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder="e.g. Design Enthusiasts"
                            minLength={2}
                            maxLength={120}
                            required
                            autoFocus
                            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-gray-700 dark:bg-gray-800"
                        />
                    </div>

                    <div>
                        <label htmlFor="community-description" className="mb-2 block text-sm font-medium">
                            Description
                        </label>
                        <textarea
                            id="community-description"
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            placeholder="What is this community about?"
                            rows={3}
                            maxLength={2000}
                            className="w-full resize-y rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-gray-700 dark:bg-gray-800"
                        />
                        <p className="mt-1 text-right text-xs text-gray-400">
                            {description.length}/2000
                        </p>
                    </div>

                    <fieldset>
                        <legend className="mb-3 text-sm font-medium">Community visibility</legend>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {(["PUBLIC", "PRIVATE"] as const).map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    aria-pressed={visibility === value}
                                    onClick={() => setVisibility(value)}
                                    className={`rounded-xl border p-4 text-left transition ${visibility === value
                                            ? "border-amber-500 bg-amber-50 ring-1 ring-amber-500 dark:bg-amber-950/30"
                                            : "border-gray-200 hover:border-gray-400 dark:border-gray-700"
                                        }`}
                                >
                                    <span className="block text-sm font-semibold">
                                        {value === "PUBLIC" ? "Public" : "Private"}
                                    </span>
                                    <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                                        {value === "PUBLIC"
                                            ? "Discoverable by everyone."
                                            : "Restricted community access."}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </fieldset>

                    {error && (
                        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
                            {error}
                        </p>
                    )}

                    <div className="flex justify-end gap-3 border-t border-gray-100 pt-5 dark:border-gray-800">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={submitting}
                            className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting || name.trim().length < 2}
                            className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {submitting ? "Creating..." : "Create community"}
                        </button>
                    </div>
                </form>
            </section>
        </div>
    );
}
