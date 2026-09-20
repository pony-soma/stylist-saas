import { deletePhoto } from '@/lib/photo-mutations';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  return deletePhoto(request, params.id);
}
