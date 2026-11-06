import type { Metadata } from "next";
import { Landing } from "@/components/landing";

export const metadata: Metadata = { title: { absolute: "Clutch · Every moment is a market" } };

export default function Page() {
  return <Landing />;
}
