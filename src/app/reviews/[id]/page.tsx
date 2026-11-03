import { loadReview } from "@/features/releases/queries";
import { notFound } from "next/navigation";
import { ReviewContent } from "@/features/releases/components/review-content";
export default async function ClientReview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadReview(id);
  if (data.review.owner_id === data.user.id) notFound();
  return <ReviewContent {...data} />;
}
