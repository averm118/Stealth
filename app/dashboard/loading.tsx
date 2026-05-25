import { Card } from "@/components/ui/card";

export default function DashboardLoading() {
  return (
    <div className="pb-24">
      <section className="space-y-5">
        <Card className="overflow-hidden p-0">
          <div className="grid gap-0 lg:grid-cols-[1fr_360px]">
            <div className="p-7 sm:p-8">
              <div className="h-4 w-28 animate-pulse rounded-full bg-[#dfe3ff]" />
              <div className="mt-5 h-14 max-w-2xl animate-pulse rounded-[18px] bg-black/[0.06]" />
              <div className="mt-3 h-4 max-w-xl animate-pulse rounded-full bg-black/[0.05]" />
              <div className="mt-2 h-4 max-w-lg animate-pulse rounded-full bg-black/[0.04]" />
              <div className="mt-6 flex flex-wrap gap-2">
                <LoadingPill />
                <LoadingPill className="w-24" />
                <LoadingPill className="w-36" />
              </div>
            </div>
            <div className="border-t border-black/[0.06] bg-white/55 p-7 lg:border-l lg:border-t-0">
              <div className="h-4 w-24 animate-pulse rounded-full bg-black/[0.08]" />
              <div className="mt-6 space-y-4">
                <LoadingMetric />
                <LoadingMetric />
                <LoadingMetric />
                <LoadingMetric />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-3 sm:p-4">
          <div className="grid gap-3 xl:grid-cols-[1fr_260px_220px] xl:items-center">
            <div className="h-12 animate-pulse rounded-[18px] bg-white/85 shadow-[0_10px_30px_rgba(20,25,34,0.06)]" />
            <div className="h-12 animate-pulse rounded-[18px] bg-white/80 shadow-sm" />
            <div className="h-12 animate-pulse rounded-[18px] bg-white/80 shadow-sm" />
          </div>
        </Card>

        <div className="grid gap-5 xl:grid-cols-[1fr_0.34fr]">
          <Card className="p-5 sm:p-6">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="h-4 w-28 animate-pulse rounded-full bg-[#dfe3ff]" />
                <div className="mt-3 h-4 w-56 animate-pulse rounded-full bg-black/[0.05]" />
              </div>
              <div className="h-7 w-10 animate-pulse rounded-full bg-white shadow-sm" />
            </div>
            <div className="divide-y divide-black/[0.06]">
              {Array.from({ length: 6 }).map((_, index) => (
                <LoadingJobRow key={index} />
              ))}
            </div>
          </Card>

          <aside className="sticky top-28 space-y-4 self-start">
            <Card className="p-6">
              <div className="h-4 w-28 animate-pulse rounded-full bg-black/[0.08]" />
              <div className="mt-6 space-y-4">
                <LoadingMetric />
                <LoadingMetric />
                <LoadingMetric />
              </div>
              <div className="mt-6 h-16 animate-pulse rounded-[18px] bg-black/[0.04]" />
            </Card>
          </aside>
        </div>
      </section>
    </div>
  );
}

function LoadingPill({ className = "w-32" }: Readonly<{ className?: string }>) {
  return <span className={`h-7 animate-pulse rounded-full border border-[#dfe3ff] bg-white/70 shadow-sm ${className}`} />;
}

function LoadingMetric() {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="h-3 w-24 animate-pulse rounded-full bg-black/[0.05]" />
      <div className="h-4 w-16 animate-pulse rounded-full bg-black/[0.08]" />
    </div>
  );
}

function LoadingJobRow() {
  return (
    <div className="-mx-3 grid gap-4 rounded-[24px] px-3 py-5 lg:grid-cols-[56px_1fr_170px_auto] lg:items-center">
      <div className="relative h-12 w-12">
        <div className="h-12 w-12 animate-pulse rounded-2xl border border-black/[0.06] bg-white shadow-[0_10px_30px_rgba(20,25,34,0.08)]" />
        <span className="absolute -bottom-1 -right-1 h-5 w-5 animate-pulse rounded-full border border-white bg-[#f1f3ff] shadow-sm" />
      </div>
      <div className="min-w-0">
        <div className="h-3 w-48 animate-pulse rounded-full bg-black/[0.05]" />
        <div className="mt-3 h-5 w-4/5 animate-pulse rounded-full bg-black/[0.08]" />
        <div className="mt-3 h-4 w-11/12 animate-pulse rounded-full bg-black/[0.05]" />
        <div className="mt-2 h-4 w-2/3 animate-pulse rounded-full bg-black/[0.04]" />
      </div>
      <div className="h-8 w-28 animate-pulse rounded-full border border-[#dfe3ff] bg-white/70" />
      <div className="flex items-center gap-2 sm:justify-end">
        <div className="h-9 w-24 animate-pulse rounded-full bg-white shadow-sm" />
        <div className="h-9 w-9 animate-pulse rounded-full bg-white shadow-sm" />
      </div>
    </div>
  );
}
