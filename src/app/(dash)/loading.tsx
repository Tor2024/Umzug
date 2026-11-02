// Skeleton при навигации внутри dash-группы (RU). Локаль здесь всегда ru —
// DE-зеркало живёт в app/de/(dash)/loading.tsx со своим текстом.
export default function DashLoading() {
  return (
    <div className="grid gap-4" role="status" aria-label="Загружается…">
      <div className="h-8 w-56 animate-pulse rounded-base bg-surface" />
      <div className="h-24 w-full animate-pulse rounded-container bg-surface" />
      <div className="h-40 w-full animate-pulse rounded-container bg-surface" />
    </div>
  );
}
