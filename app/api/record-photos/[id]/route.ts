import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { billingAdmin } from '@/lib/billing';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
const fail = (status: number) => NextResponse.json({ error: 'Photo unavailable' }, { status, headers });

export async function GET(request: Request, { params }: { params: { id: string } }) {
  // Cross-site embedding is unnecessary. Every request still requires authentication.
  if (request.headers.get('sec-fetch-site') === 'cross-site') return fail(403);
  if (!uuid.test(params.id)) return fail(400);
  try {
    const client = createClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return fail(401);
    // Read through caller RLS and explicitly check the parent owner as defense in depth.
    // Billing expiration does not remove access to the owner's existing records.
    const { data: photo, error } = await client.from('record_photos')
      .select('storage_path, medical_records!inner(stylist_id)')
      .eq('id', params.id).eq('medical_records.stylist_id', user.id).maybeSingle();
    if (error) return fail(503);
    if (!photo) return fail(404);
    const owner = Array.isArray(photo.medical_records) ? photo.medical_records[0] : photo.medical_records;
    if (owner?.stylist_id !== user.id) return fail(404);
    const path = photo.storage_path;
    if (typeof path !== 'string' || !path || path.startsWith('/') || /[\\\x00-\x1f]/.test(path) ||
        path.split('/').some(part => !part || part === '.' || part === '..')) return fail(404);

    const admin = billingAdmin();
    const { data: bucket, error: bucketError } = await admin.storage.getBucket('record-photos');
    // A public bucket bypasses record authorization; do not silently serve it.
    if (bucketError || !bucket || bucket.public !== false) return fail(503);
    const { data: blob, error: downloadError } = await admin.storage.from('record-photos').download(path);
    if (downloadError || !blob) return fail(503);
    if (!mimeTypes.includes(blob.type) || blob.size > 10 * 1024 * 1024) return fail(415);
    return new Response(blob, { status: 200, headers: {
      ...headers, 'Content-Type': blob.type, 'Content-Disposition': 'inline',
      'Cross-Origin-Resource-Policy': 'same-origin',
    } });
  } catch {
    console.error('Record photo read failed');
    return fail(503);
  }
}
