import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import SetupForm from "./SetupForm";

export default async function SetupPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.room) redirect("/");
  return <SetupForm name={user.name} />;
}
