import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import Dashboard from "@/components/Dashboard";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.room) redirect("/setup");
  return <Dashboard />;
}
