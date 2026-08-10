export default function ForumHeader({
  totalThreads,
  totalReplies,
}: {
  totalThreads: number;
  totalReplies: number;
}) {
  return (
    <div className="mb-10">
      <h1 className="text-3xl md:text-5xl font-bold text-text mb-4">Forum</h1>
      <p className="text-text-muted leading-relaxed">
        Ask questions, share ideas, and connect with the Misty community.
      </p>
      <div className="flex items-center gap-5 mt-4">
        <span className="text-xs text-text-muted">
          <span className="text-text font-medium">{totalThreads}</span> threads
        </span>
        <span className="text-xs text-text-muted">
          <span className="text-text font-medium">{totalReplies}</span> replies
        </span>
      </div>
    </div>
  );
}
