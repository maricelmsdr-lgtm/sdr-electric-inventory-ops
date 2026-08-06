import { supabase } from "@/lib/supabase";

// Uploads a file into `${orgId}/${timestamp}-${filename}` inside the given
// bucket. Returns the storage path (not a URL) — store the path in the DB
// and turn it into a URL when displaying (signed for private buckets,
// public for public ones, via the helpers below).
export async function uploadOrgFile(bucket, orgId, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${orgId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

// For private buckets (e.g. receiving-invoices) — generates a temporary
// authenticated URL. RLS still applies: this only succeeds if the caller's
// org matches the object's folder.
export async function getSignedUrl(bucket, path, expiresIn = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl || null;
}

// For public buckets (e.g. part-photos) — no auth needed to view.
export function getPublicUrl(bucket, path) {
  if (!path) return null;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}
