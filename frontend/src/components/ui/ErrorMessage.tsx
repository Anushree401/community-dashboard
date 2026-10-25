export default function ErrorMessage({
  message,
}: {
  message: string;
}) {
  return (
    <p className="workspace-error" role="alert">
      {message}
    </p>
  );
}
