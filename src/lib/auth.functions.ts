import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Returns whether the current authenticated user has the 'admin' role.
 *  Uses public.current_user_is_admin() — a no-argument SECURITY DEFINER RPC
 *  that internally checks has_role(auth.uid(), 'admin'). This avoids
 *  exposing the arbitrary-user has_role() function to authenticated callers. */
export const getIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("current_user_is_admin");
    if (error) {
      console.error("current_user_is_admin check failed", error);
      return { isAdmin: false, userId: context.userId };
    }
    return { isAdmin: Boolean(data), userId: context.userId };
  });

/** Ensures a season row labelled "2026 Summer" exists and is marked current.
 *  Idempotent. Admin-only — verified via current_user_is_admin(). */
export const ensureCurrentSeason = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isAdmin = await context.supabase.rpc("current_user_is_admin");
    if (isAdmin.error || !isAdmin.data) {
      throw new Error("Forbidden: admin role required");
    }

    const existing = await context.supabase
      .from("seasons")
      .select("id, label, is_current")
      .eq("is_current", true)
      .maybeSingle();

    if (existing.data) return { seasonId: existing.data.id, created: false };

    const inserted = await context.supabase
      .from("seasons")
      .insert({ label: "2026 Summer", is_current: true })
      .select("id")
      .single();

    if (inserted.error) throw inserted.error;
    return { seasonId: inserted.data.id, created: true };
  });
