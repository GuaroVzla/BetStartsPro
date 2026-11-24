import { Dashboard } from "@/components/Dashboard";
import { getDashboardData } from "@/services/matchAggregator";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const data = await getDashboardData();
  return <Dashboard initialData={data} renderedAt={new Date().toISOString()} />;
}
