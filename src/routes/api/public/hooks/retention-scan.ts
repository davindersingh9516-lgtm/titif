import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@supabase/supabase-js'

export const Route = createFileRoute('/api/public/hooks/retention-scan')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronSecret = process.env.CRON_SECRET
        const bearer = request.headers.get('authorization')?.replace('Bearer ', '')

        // Prefer CRON_SECRET when set; fall back to legacy apikey header
        if (cronSecret) {
          if (bearer !== cronSecret) return new Response('unauthorized', { status: 401 })
        } else {
          const legacyKey = request.headers.get('apikey') || bearer
          if (!legacyKey) return new Response('unauthorized', { status: 401 })
        }

        const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!url || !key) {
          return Response.json({ ok: false, error: 'server_misconfigured' }, { status: 500 })
        }

        const supabase = createClient(url, key, {
          auth: { autoRefreshToken: false, persistSession: false },
        })

        const [retention, loyalty, refs] = await Promise.all([
          supabase.rpc('retention_scan'),
          supabase.rpc('accrue_loyalty_for_delivered'),
          supabase.rpc('reward_pending_referrals'),
        ])

        return Response.json({
          ok: true,
          retention: retention.data ?? null,
          loyalty_accrued: loyalty.data ?? 0,
          referrals_rewarded: refs.data ?? 0,
          errors: [retention.error, loyalty.error, refs.error].filter(Boolean).map((e) => e!.message),
        })
      },
    },
  },
})
