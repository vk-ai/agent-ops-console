import { Suspense } from "react";
import { MemoryViewer } from "@/components/MemoryViewer";

async function Viewer({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = typeof sp.user === "string" ? sp.user : undefined;
  return <MemoryViewer initialUser={user} />;
}

export default function MemoriesPage(props: PageProps<"/memories">) {
  return (
    <>
      <h1>Memory</h1>
      <p className="muted">Long-term facts the agent saved from &quot;remember …&quot; in tasks. Read-only: the runtime has no edit or delete endpoint.</p>
      <Suspense fallback={<p>Loading…</p>}>
        <Viewer searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
