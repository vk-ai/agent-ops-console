import { Suspense } from "react";
import { RunDetail } from "@/components/RunDetail";

async function Detail({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <RunDetail runId={runId} />;
}

export default function RunPage(props: PageProps<"/runs/[runId]">) {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Detail params={props.params} />
    </Suspense>
  );
}
