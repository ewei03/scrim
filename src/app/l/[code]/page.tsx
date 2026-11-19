import { Suspense } from "react";
import { Loading } from "@/components/RequireAuth";
import { LobbyView } from "./LobbyView";

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <LobbyView />
    </Suspense>
  );
}
