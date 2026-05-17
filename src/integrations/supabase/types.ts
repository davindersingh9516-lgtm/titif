export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          meta: Json | null
          target: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          meta?: Json | null
          target?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          meta?: Json | null
          target?: string | null
        }
        Relationships: []
      }
      daily_menu_overrides: {
        Row: {
          created_at: string
          date: string
          id: string
          is_open: boolean
          meal_type: Database["public"]["Enums"]["meal_type"]
          note: string | null
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          is_open?: boolean
          meal_type: Database["public"]["Enums"]["meal_type"]
          note?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          is_open?: boolean
          meal_type?: Database["public"]["Enums"]["meal_type"]
          note?: string | null
        }
        Relationships: []
      }
      daily_menu_plan: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          id: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          menu_item_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          id?: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          menu_item_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          meal_type?: Database["public"]["Enums"]["meal_type"]
          menu_item_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_menu_plan_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          arrived_at: string | null
          created_at: string
          delivered_at: string | null
          failed_reason: string | null
          id: string
          order_id: string
          picked_up_at: string | null
          rider_id: string | null
          route_index: number | null
          status: Database["public"]["Enums"]["delivery_status"]
          updated_at: string
        }
        Insert: {
          arrived_at?: string | null
          created_at?: string
          delivered_at?: string | null
          failed_reason?: string | null
          id?: string
          order_id: string
          picked_up_at?: string | null
          rider_id?: string | null
          route_index?: number | null
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
        }
        Update: {
          arrived_at?: string | null
          created_at?: string
          delivered_at?: string | null
          failed_reason?: string | null
          id?: string
          order_id?: string
          picked_up_at?: string | null
          rider_id?: string | null
          route_index?: number | null
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          created_at: string
          id: string
          number: string
          pdf_url: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          number: string
          pdf_url?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          number?: string
          pdf_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      kitchen_batches: {
        Row: {
          created_at: string
          created_by: string | null
          delivery_date: string
          dispatched_at: string | null
          id: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          note: string | null
          planned_breakfast: number
          planned_large: number
          planned_mini: number
          rider_id: string | null
          round_label: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delivery_date: string
          dispatched_at?: string | null
          id?: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          note?: string | null
          planned_breakfast?: number
          planned_large?: number
          planned_mini?: number
          rider_id?: string | null
          round_label?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delivery_date?: string
          dispatched_at?: string | null
          id?: string
          meal_type?: Database["public"]["Enums"]["meal_type"]
          note?: string | null
          planned_breakfast?: number
          planned_large?: number
          planned_mini?: number
          rider_id?: string | null
          round_label?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      loyalty_accounts: {
        Row: {
          lifetime_points: number
          points: number
          updated_at: string
          user_id: string
        }
        Insert: {
          lifetime_points?: number
          points?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          lifetime_points?: number
          points?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      loyalty_ledger: {
        Row: {
          balance_after: number
          created_at: string
          delta: number
          id: string
          reason: string
          reference_id: string | null
          user_id: string
        }
        Insert: {
          balance_after: number
          created_at?: string
          delta: number
          id?: string
          reason: string
          reference_id?: string | null
          user_id: string
        }
        Update: {
          balance_after?: number
          created_at?: string
          delta?: number
          id?: string
          reason?: string
          reference_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      menu_items: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          meal_type: Database["public"]["Enums"]["meal_type"]
          name: string
          price: number
          size: Database["public"]["Enums"]["meal_size"]
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          meal_type: Database["public"]["Enums"]["meal_type"]
          name: string
          price: number
          size: Database["public"]["Enums"]["meal_size"]
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          meal_type?: Database["public"]["Enums"]["meal_type"]
          name?: string
          price?: number
          size?: Database["public"]["Enums"]["meal_size"]
        }
        Relationships: []
      }
      notification_log: {
        Row: {
          attempts: number
          channel: Database["public"]["Enums"]["notify_channel"]
          created_at: string
          error: string | null
          id: string
          last_attempt_at: string | null
          max_attempts: number
          payload: Json
          priority: number
          scheduled_for: string
          sent_at: string | null
          status: string
          template: string
          to_phone: string | null
          user_id: string | null
        }
        Insert: {
          attempts?: number
          channel: Database["public"]["Enums"]["notify_channel"]
          created_at?: string
          error?: string | null
          id?: string
          last_attempt_at?: string | null
          max_attempts?: number
          payload?: Json
          priority?: number
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          template: string
          to_phone?: string | null
          user_id?: string | null
        }
        Update: {
          attempts?: number
          channel?: Database["public"]["Enums"]["notify_channel"]
          created_at?: string
          error?: string | null
          id?: string
          last_attempt_at?: string | null
          max_attempts?: number
          payload?: Json
          priority?: number
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          template?: string
          to_phone?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          in_app: boolean
          low_balance_threshold: number
          updated_at: string
          user_id: string
          whatsapp: boolean
        }
        Insert: {
          in_app?: boolean
          low_balance_threshold?: number
          updated_at?: string
          user_id: string
          whatsapp?: boolean
        }
        Update: {
          in_app?: boolean
          low_balance_threshold?: number
          updated_at?: string
          user_id?: string
          whatsapp?: boolean
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          payload: Json
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          payload?: Json
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          payload?: Json
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      order_events: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          note: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string
          status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: []
      }
      order_items: {
        Row: {
          id: string
          menu_item_id: string | null
          name: string
          order_id: string
          price: number
          qty: number
          size: Database["public"]["Enums"]["meal_size"]
        }
        Insert: {
          id?: string
          menu_item_id?: string | null
          name: string
          order_id: string
          price: number
          qty?: number
          size: Database["public"]["Enums"]["meal_size"]
        }
        Update: {
          id?: string
          menu_item_id?: string | null
          name?: string
          order_id?: string
          price?: number
          qty?: number
          size?: Database["public"]["Enums"]["meal_size"]
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_ratings: {
        Row: {
          comment: string | null
          created_at: string
          food_rating: number
          order_id: string
          rider_id: string | null
          rider_rating: number | null
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          food_rating: number
          order_id: string
          rider_id?: string | null
          rider_rating?: number | null
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          food_rating?: number
          order_id?: string
          rider_id?: string | null
          rider_rating?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_ratings_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address: string
          batch_id: string | null
          created_at: string
          delivery_date: string
          delivery_otp: string | null
          delivery_window: Database["public"]["Enums"]["delivery_window"]
          id: string
          lat: number | null
          lng: number | null
          meal_type: Database["public"]["Enums"]["meal_type"]
          notes: string | null
          packed_at: string | null
          prep_status: string
          rider_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          batch_id?: string | null
          created_at?: string
          delivery_date: string
          delivery_otp?: string | null
          delivery_window: Database["public"]["Enums"]["delivery_window"]
          id?: string
          lat?: number | null
          lng?: number | null
          meal_type: Database["public"]["Enums"]["meal_type"]
          notes?: string | null
          packed_at?: string | null
          prep_status?: string
          rider_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total: number
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          batch_id?: string | null
          created_at?: string
          delivery_date?: string
          delivery_otp?: string | null
          delivery_window?: Database["public"]["Enums"]["delivery_window"]
          id?: string
          lat?: number | null
          lng?: number | null
          meal_type?: Database["public"]["Enums"]["meal_type"]
          notes?: string | null
          packed_at?: string | null
          prep_status?: string
          rider_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      otp_requests: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          phone: string
          purpose: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          phone: string
          purpose: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
          purpose?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          invoice_id: string | null
          method: Database["public"]["Enums"]["payment_method"]
          qr_payload: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
          user_id: string
          utr_reference: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          invoice_id?: string | null
          method: Database["public"]["Enums"]["payment_method"]
          qr_payload?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          user_id: string
          utr_reference?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          qr_payload?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          user_id?: string
          utr_reference?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          created_at: string
          full_name: string | null
          id: string
          lat: number | null
          lng: number | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          lat?: number | null
          lng?: number | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      referral_codes: {
        Row: {
          code: string
          created_at: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          code: string
          created_at: string
          id: string
          referee_id: string
          referrer_id: string
          reward_amount: number | null
          rewarded_at: string | null
          status: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          referee_id: string
          referrer_id: string
          reward_amount?: number | null
          rewarded_at?: string | null
          status?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          referee_id?: string
          referrer_id?: string
          reward_amount?: number | null
          rewarded_at?: string | null
          status?: string
        }
        Relationships: []
      }
      riders: {
        Row: {
          active: boolean
          created_at: string
          current_lat: number | null
          current_lng: number | null
          id: string
          last_seen_at: string | null
          name: string
          online: boolean
          phone: string | null
          user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          id?: string
          last_seen_at?: string | null
          name: string
          online?: boolean
          phone?: string | null
          user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          id?: string
          last_seen_at?: string | null
          name?: string
          online?: boolean
          phone?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          is_admin: boolean
          ticket_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          is_admin?: boolean
          ticket_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          is_admin?: boolean
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          category: Database["public"]["Enums"]["ticket_category"]
          created_at: string
          id: string
          last_message_at: string
          order_id: string | null
          priority: Database["public"]["Enums"]["ticket_priority"]
          refund_amount: number | null
          resolution_note: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          category?: Database["public"]["Enums"]["ticket_category"]
          created_at?: string
          id?: string
          last_message_at?: string
          order_id?: string | null
          priority?: Database["public"]["Enums"]["ticket_priority"]
          refund_amount?: number | null
          resolution_note?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          category?: Database["public"]["Enums"]["ticket_category"]
          created_at?: string
          id?: string
          last_message_at?: string
          order_id?: string | null
          priority?: Database["public"]["Enums"]["ticket_priority"]
          refund_amount?: number | null
          resolution_note?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          created_at: string
          device_label: string | null
          id: string
          ip: string | null
          last_seen_at: string
          revoked_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_label?: string | null
          id?: string
          ip?: string | null
          last_seen_at?: string
          revoked_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_label?: string | null
          id?: string
          ip?: string | null
          last_seen_at?: string
          revoked_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          reference_id: string | null
          type: Database["public"]["Enums"]["wallet_tx_type"]
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          description?: string | null
          id?: string
          reference_id?: string | null
          type: Database["public"]["Enums"]["wallet_tx_type"]
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          reference_id?: string | null
          type?: Database["public"]["Enums"]["wallet_tx_type"]
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accrue_loyalty_for_delivered: { Args: never; Returns: number }
      add_support_message: {
        Args: { p_body: string; p_ticket_id: string }
        Returns: string
      }
      admin_adjust_wallet: {
        Args: { p_delta: number; p_reason: string; p_user_id: string }
        Returns: number
      }
      admin_copy_plan: {
        Args: {
          p_from: string
          p_meal?: Database["public"]["Enums"]["meal_type"]
          p_to: string
        }
        Returns: number
      }
      admin_daily_series: {
        Args: { p_days?: number }
        Returns: {
          day: string
          orders: number
          revenue: number
        }[]
      }
      admin_growth_kpis: { Args: never; Returns: Json }
      admin_kpis: { Args: never; Returns: Json }
      admin_meal_mix: {
        Args: { p_days?: number }
        Returns: {
          meal_type: Database["public"]["Enums"]["meal_type"]
          orders: number
          revenue: number
        }[]
      }
      admin_reject_payment: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: undefined
      }
      admin_resolve_ticket_with_refund: {
        Args: { p_refund?: number; p_resolution: string; p_ticket_id: string }
        Returns: undefined
      }
      admin_rider_performance: {
        Args: { p_days?: number }
        Returns: {
          avg_minutes: number
          delivered: number
          failed: number
          name: string
          online: boolean
          rider_id: string
        }[]
      }
      admin_set_daily_plan: {
        Args: {
          p_date: string
          p_items: Json
          p_meal: Database["public"]["Enums"]["meal_type"]
        }
        Returns: number
      }
      admin_set_ticket_status: {
        Args: {
          p_priority?: Database["public"]["Enums"]["ticket_priority"]
          p_status: Database["public"]["Enums"]["ticket_status"]
          p_ticket_id: string
        }
        Returns: undefined
      }
      admin_support_kpis: { Args: never; Returns: Json }
      admin_top_customers: {
        Args: { p_days?: number; p_limit?: number }
        Returns: {
          full_name: string
          orders: number
          phone: string
          spend: number
          user_id: string
        }[]
      }
      admin_verify_payment: {
        Args: { p_payment_id: string }
        Returns: undefined
      }
      apply_referral_code: { Args: { p_code: string }; Returns: undefined }
      assign_delivery: {
        Args: { p_order_id: string; p_rider_id: string }
        Returns: string
      }
      cancel_order_with_refund: {
        Args: { p_order_id: string; p_reason?: string }
        Returns: undefined
      }
      claim_pending_notifications: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          channel: Database["public"]["Enums"]["notify_channel"]
          created_at: string
          error: string | null
          id: string
          last_attempt_at: string | null
          max_attempts: number
          payload: Json
          priority: number
          scheduled_for: string
          sent_at: string | null
          status: string
          template: string
          to_phone: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_log"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_payment_request: { Args: { p_amount: number }; Returns: Json }
      create_support_ticket: {
        Args: {
          p_category: Database["public"]["Enums"]["ticket_category"]
          p_message: string
          p_order_id?: string
          p_priority?: Database["public"]["Enums"]["ticket_priority"]
          p_subject: string
        }
        Returns: string
      }
      cutoff_for: {
        Args: {
          p_date: string
          p_meal: Database["public"]["Enums"]["meal_type"]
        }
        Returns: string
      }
      gen_referral_code: { Args: { p_user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      kitchen_create_batch: {
        Args: {
          p_date: string
          p_meal: Database["public"]["Enums"]["meal_type"]
          p_round?: string
          p_window?: Database["public"]["Enums"]["delivery_window"]
        }
        Returns: string
      }
      kitchen_dispatch_batch: {
        Args: { p_batch_id: string; p_rider_id: string }
        Returns: number
      }
      kitchen_meal_toggle: {
        Args: {
          p_date: string
          p_meal: Database["public"]["Enums"]["meal_type"]
          p_note?: string
          p_open: boolean
        }
        Returns: undefined
      }
      kitchen_plan: {
        Args: {
          p_date?: string
          p_meal?: Database["public"]["Enums"]["meal_type"]
        }
        Returns: Json
      }
      kitchen_set_batch_status: {
        Args: { p_batch_id: string; p_status: string }
        Returns: undefined
      }
      kitchen_set_order_prep: {
        Args: { p_order_id: string; p_status: string }
        Returns: undefined
      }
      kitchen_today_orders: {
        Args: {
          p_date?: string
          p_meal?: Database["public"]["Enums"]["meal_type"]
        }
        Returns: {
          address: string
          batch_id: string
          created_at: string
          delivery_window: Database["public"]["Enums"]["delivery_window"]
          fixed: number
          full_name: string
          large: number
          meal_type: Database["public"]["Enums"]["meal_type"]
          mini: number
          order_id: string
          phone: string
          prep_status: string
          status: Database["public"]["Enums"]["order_status"]
          total: number
          user_id: string
        }[]
      }
      link_rider_to_phone: {
        Args: { p_phone: string; p_rider_id: string }
        Returns: string
      }
      lock_orders_past_cutoff: { Args: never; Returns: number }
      mark_all_notifications_read: { Args: never; Returns: number }
      mark_notification_failed: {
        Args: { p_error: string; p_id: string }
        Returns: undefined
      }
      mark_notification_read: { Args: { p_id: string }; Returns: undefined }
      mark_notification_sent: {
        Args: { p_id: string; p_meta?: Json }
        Returns: undefined
      }
      menu_for_day: {
        Args: {
          p_date: string
          p_meal: Database["public"]["Enums"]["meal_type"]
        }
        Returns: {
          description: string
          id: string
          image_url: string
          is_planned: boolean
          meal_type: Database["public"]["Enums"]["meal_type"]
          name: string
          price: number
          size: Database["public"]["Enums"]["meal_size"]
          sort_order: number
        }[]
      }
      my_referral_code: { Args: never; Returns: string }
      notify_user: {
        Args: {
          p_body?: string
          p_channels?: string[]
          p_link?: string
          p_payload?: Json
          p_priority?: number
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: string
      }
      place_order: {
        Args: {
          p_address: string
          p_delivery_date: string
          p_items: Json
          p_lat: number
          p_lng: number
          p_meal: Database["public"]["Enums"]["meal_type"]
          p_notes?: string
          p_window: Database["public"]["Enums"]["delivery_window"]
        }
        Returns: string
      }
      record_session: {
        Args: { p_device_label: string; p_ip: string; p_user_agent: string }
        Returns: string
      }
      redeem_loyalty_points: { Args: { p_points: number }; Returns: number }
      retention_scan: { Args: never; Returns: Json }
      revoke_session: { Args: { p_session_id: string }; Returns: undefined }
      reward_pending_referrals: { Args: never; Returns: number }
      rider_heartbeat: {
        Args: { p_lat: number; p_lng: number }
        Returns: undefined
      }
      rider_update_delivery: {
        Args: {
          p_delivery_id: string
          p_lat?: number
          p_lng?: number
          p_reason?: string
          p_status: Database["public"]["Enums"]["delivery_status"]
        }
        Returns: undefined
      }
      set_rider_online: { Args: { p_online: boolean }; Returns: undefined }
      submit_order_rating: {
        Args: {
          p_comment?: string
          p_food: number
          p_order_id: string
          p_rider?: number
        }
        Returns: undefined
      }
      submit_payment_utr: {
        Args: { p_payment_id: string; p_utr: string }
        Returns: undefined
      }
      super_overview: { Args: never; Returns: Json }
      touch_session: { Args: { p_session_id: string }; Returns: undefined }
      unread_notifications_count: { Args: never; Returns: number }
      verify_delivery_otp: {
        Args: { p_delivery_id: string; p_otp: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "super_admin" | "admin" | "rider" | "customer"
      delivery_status:
        | "assigned"
        | "picked_up"
        | "en_route"
        | "arrived"
        | "delivered"
        | "failed"
      delivery_window: "round_1" | "round_2"
      meal_size: "mini" | "large" | "fixed"
      meal_type: "breakfast" | "lunch" | "dinner"
      notify_channel: "whatsapp" | "sms" | "push" | "in_app"
      order_status:
        | "placed"
        | "preparing"
        | "out_for_delivery"
        | "delivered"
        | "cancelled"
      payment_method: "upi_qr" | "cash" | "admin_credit"
      payment_status: "pending" | "success" | "failed" | "reversed"
      ticket_category:
        | "delivery_delayed"
        | "delivery_wrong"
        | "delivery_failed"
        | "payment_failed"
        | "wallet_not_updated"
        | "recharge_issue"
        | "refund_request"
        | "otp_issue"
        | "rider_issue"
        | "order_issue"
        | "other"
      ticket_priority: "low" | "normal" | "high" | "urgent"
      ticket_status:
        | "open"
        | "in_progress"
        | "waiting_customer"
        | "resolved"
        | "closed"
      wallet_tx_type: "topup" | "order_debit" | "refund" | "adjustment"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin", "admin", "rider", "customer"],
      delivery_status: [
        "assigned",
        "picked_up",
        "en_route",
        "arrived",
        "delivered",
        "failed",
      ],
      delivery_window: ["round_1", "round_2"],
      meal_size: ["mini", "large", "fixed"],
      meal_type: ["breakfast", "lunch", "dinner"],
      notify_channel: ["whatsapp", "sms", "push", "in_app"],
      order_status: [
        "placed",
        "preparing",
        "out_for_delivery",
        "delivered",
        "cancelled",
      ],
      payment_method: ["upi_qr", "cash", "admin_credit"],
      payment_status: ["pending", "success", "failed", "reversed"],
      ticket_category: [
        "delivery_delayed",
        "delivery_wrong",
        "delivery_failed",
        "payment_failed",
        "wallet_not_updated",
        "recharge_issue",
        "refund_request",
        "otp_issue",
        "rider_issue",
        "order_issue",
        "other",
      ],
      ticket_priority: ["low", "normal", "high", "urgent"],
      ticket_status: [
        "open",
        "in_progress",
        "waiting_customer",
        "resolved",
        "closed",
      ],
      wallet_tx_type: ["topup", "order_debit", "refund", "adjustment"],
    },
  },
} as const
