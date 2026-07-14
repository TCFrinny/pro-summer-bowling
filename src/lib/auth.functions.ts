import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Returns whether the current authenticated user has the 'admin' role.
 *  Uses the security-definer public.has_role() function via RPC, which is
 *  the same pathway RLS uses — so a passing check here means every admin
 *  policy will also let this user write. */
export const getIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (error) {
      console.error("has_role check failed", error);
      return { isAdmin: false, userId: context.userId };
    }
    return { isAdmin: Boolean(data), userId: context.userId };
  });

/** Ensures a season row labelled "2026 Summer" exists and is marked current.
 *  Idempotent. Admin-only — uses the caller's session (RLS enforces admin).
 *  Called from the admin layout after admin verification. */
export const ensureCurrentSeason = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isAdmin = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
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
