import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { assertBillingOrigin, billingAdmin, getBillingStatus } from '@/lib/billing';
import { randomUUID } from 'node:crypto';

const BUCKET = 'record-photos';
const MAX_BODY = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
class PhotoError extends Error { constructor(public status: number) { super('Photo operation unavailable'); } }
const fail = (status: number) => NextResponse.json({ error: 'Photo operation unavailable' }, { status, headers });
async function active(userId: string) {
  if (!['master', 'active', 'trialing'].includes((await getBillingStatus(userId)).status)) throw new PhotoError(403);
}
async function authenticate(request: Request) {
  try { assertBillingOrigin(request); } catch { throw new PhotoError(403); }
  const client = createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new PhotoError(401);
  await active(user.id);
  return { client, user };
}
async function parent(client: ReturnType<typeof createClient>, recordId: string, userId: string) {
  const { data, error } = await client.from('medical_records').select('id, stylist_id')
    .eq('id', recordId).eq('stylist_id', userId).maybeSingle();
  if (error) throw new PhotoError(503);
  if (!data || data.stylist_id !== userId) throw new PhotoError(404);
}
async function privateStorage(admin: ReturnType<typeof billingAdmin>) {
  const { data, error } = await admin.storage.getBucket(BUCKET);
  if (error || !data || data.public !== false) throw new PhotoError(503);
  return admin.storage.from(BUCKET);
}
async function boundedForm(request: Request) {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) throw new PhotoError(413);
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new PhotoError(400);
  if (!request.body) throw new PhotoError(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new PhotoError(413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData(); }
  catch { throw new PhotoError(400); }
}
function imageExtension(bytes: Uint8Array, mime: string) {
  const starts = (values: number[], offset = 0) => values.every((v, i) => bytes[offset + i] === v);
  if (mime === 'image/jpeg' && bytes.length >= 4 && starts([255, 216, 255])) return 'jpg';
  if (mime === 'image/png' && bytes.length >= 24 && starts([137,80,78,71,13,10,26,10]) && starts([73,72,68,82], 12)) return 'png';
  if (mime === 'image/webp' && bytes.length >= 16 && starts([82,73,70,70]) && starts([87,69,66,80], 8) &&
      starts([86,80,56], 12) && [32,76,88].includes(bytes[15])) return 'webp';
  throw new PhotoError(415);
}
function validPath(path: unknown): path is string {
  return typeof path === 'string' && !!path && !path.startsWith('/') && !/[\\\x00-\x1f]/.test(path) &&
    !path.split('/').some(part => !part || part === '.' || part === '..');
}

export async function uploadPhoto(request: Request) {
  try {
    const { client, user } = await authenticate(request);
    const form = await boundedForm(request);
    const recordId = form.get('recordId'); const file = form.get('file');
    if (Array.from(form.keys()).some(key => !['recordId', 'file'].includes(key)) || form.getAll('recordId').length !== 1 ||
        form.getAll('file').length !== 1 || typeof recordId !== 'string' || !UUID.test(recordId) ||
        !file || typeof file === 'string' || file.size === 0) throw new PhotoError(400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = imageExtension(bytes, file.type);
    await parent(client, recordId, user.id);
    const admin = billingAdmin(); const storage = await privateStorage(admin);
    const id = randomUUID(); const path = `${user.id}/${recordId}/${id}.${extension}`;
    const { error: uploadError } = await storage.upload(path, bytes, { contentType: file.type, upsert: false });
    if (uploadError) throw new PhotoError(503);
    let insertAttempted = false;
    try {
      // Access can expire or ownership can change while bytes are being transferred.
      await parent(client, recordId, user.id);
      await active(user.id);
      insertAttempted = true;
      const { error } = await admin.from('record_photos').insert({ id, record_id: recordId, storage_path: path });
      if (error) throw new PhotoError(503);
    } catch (error) {
      // A failed network response may follow a committed insert. Never remove its object.
      const { data: stored, error: lookupError } = await admin.from('record_photos').select('id, record_id, storage_path')
        .eq('id', id).maybeSingle();
      if (insertAttempted && !lookupError && stored?.id === id && stored.record_id === recordId && stored.storage_path === path) {
        return NextResponse.json({ id }, { status: 201, headers });
      }
      if (!lookupError && !stored) {
        const { error: cleanupError } = await storage.remove([path]);
        if (cleanupError) console.error('Photo upload compensation failed');
      }
      throw error;
    }
    return NextResponse.json({ id }, { status: 201, headers });
  } catch (error) {
    return fail(error instanceof PhotoError ? error.status : 503);
  }
}

export async function deletePhoto(request: Request, id: string) {
  try {
    const { client, user } = await authenticate(request);
    if (!UUID.test(id)) throw new PhotoError(400);
    const { data: photo, error } = await client.from('record_photos')
      .select('id, record_id, storage_path, medical_records!inner(stylist_id)')
      .eq('id', id).eq('medical_records.stylist_id', user.id).maybeSingle();
    if (error) throw new PhotoError(503);
    const owner = Array.isArray(photo?.medical_records) ? photo.medical_records[0] : photo?.medical_records;
    if (!photo || owner?.stylist_id !== user.id || !validPath(photo.storage_path)) throw new PhotoError(404);
    const admin = billingAdmin(); const storage = await privateStorage(admin);
    // Legacy paths are supported only if no other photo references the same object.
    const { count, error: referencesError } = await admin.from('record_photos')
      .select('id', { count: 'exact', head: true }).eq('storage_path', photo.storage_path);
    if (referencesError || count !== 1) throw new PhotoError(503);
    await parent(client, photo.record_id, user.id);
    await active(user.id);
    // Storage deletion is idempotent. Keep the DB reference on Storage failure so retry
    // still authorizes the same object; never claim cross-service atomicity.
    const { error: storageError } = await storage.remove([photo.storage_path]);
    if (storageError) throw new PhotoError(503);
    await parent(client, photo.record_id, user.id);
    await active(user.id);
    const { data: deleted, error: deleteError } = await admin.from('record_photos').delete()
      .eq('id', id).eq('record_id', photo.record_id).eq('storage_path', photo.storage_path).select('id');
    if (deleteError || !deleted?.some(row => row.id === id)) {
      // A lost response or concurrent deletion is successful only after proving absence.
      const { data: remaining, error: lookupError } = await admin.from('record_photos')
        .select('id').eq('id', id).maybeSingle();
      if (lookupError || remaining) throw new PhotoError(503);
    }
    return NextResponse.json({ deleted: true }, { headers });
  } catch (error) {
    return fail(error instanceof PhotoError ? error.status : 503);
  }
}
