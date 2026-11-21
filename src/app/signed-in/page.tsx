import type { Metadata } from "next";
import { SignedIn } from "./SignedIn";

export const metadata: Metadata = { title: "Signed in - Scrim" };

export default function Page() {
  return <SignedIn />;
}
