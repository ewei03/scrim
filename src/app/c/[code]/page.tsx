import { Suspense } from "react";
import { Loading } from "@/components/RequireAuth";
import { CrewView } from "./CrewView";

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <CrewView />
    </Suspense>
  );
}
