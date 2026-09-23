/**
 * Supabase type definitions matching supabase/migrations/0001_init.sql.
 * Keep in sync when the schema changes (or regenerate with
 * `supabase gen types typescript`).
 *
 * NOTE: supabase-js v2 requires every table to declare `Relationships`
 * (matching its `GenericTable` shape) or the whole schema falls back to
 * `never` and all queries stop type-checking.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string;
          email: string | null;
          photo_url: string | null;
          phone: string | null;
          role: string;
          created_at: string;
          updated_at: string;
          location_id: string | null;
          payout_method: string;
          bank_code: string | null;
          bank_account_number: string | null;
          bank_account_name: string | null;
          seller_verified: boolean;
          verification_requested_at: string | null;
        };
        Insert: {
          id: string;
          name?: string;
          email?: string | null;
          photo_url?: string | null;
          phone?: string | null;
          role?: string;
          created_at?: string;
          updated_at?: string;
          location_id?: string | null;
          payout_method?: string;
          bank_code?: string | null;
          bank_account_number?: string | null;
          bank_account_name?: string | null;
          seller_verified?: boolean;
          verification_requested_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          email?: string | null;
          photo_url?: string | null;
          phone?: string | null;
          role?: string;
          created_at?: string;
          updated_at?: string;
          location_id?: string | null;
          payout_method?: string;
          bank_code?: string | null;
          bank_account_number?: string | null;
          bank_account_name?: string | null;
          seller_verified?: boolean;
          verification_requested_at?: string | null;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          title: string;
          brand: string;
          category: string;
          size: string;
          condition: string;
          era: string | null;
          price_kes: number;
          image_url: string;
          description: string | null;
          source: string;
          seller_id: string | null;
          seller_name: string | null;
          status: string;
          created_at: string;
          boost_expires_at: string | null;
          location_id: string | null;
          location_label: string;
          seller_verified: boolean;
        };
        Insert: {
          id?: string;
          title: string;
          brand?: string;
          category?: string;
          size?: string;
          condition?: string;
          era?: string | null;
          price_kes?: number;
          image_url?: string;
          description?: string | null;
          source?: string;
          seller_id?: string | null;
          seller_name?: string | null;
          status?: string;
          created_at?: string;
          boost_expires_at?: string | null;
          location_id?: string | null;
          location_label?: string;
          seller_verified?: boolean;
        };
        Update: {
          id?: string;
          title?: string;
          brand?: string;
          category?: string;
          size?: string;
          condition?: string;
          era?: string | null;
          price_kes?: number;
          image_url?: string;
          description?: string | null;
          source?: string;
          seller_id?: string | null;
          seller_name?: string | null;
          status?: string;
          created_at?: string;
          boost_expires_at?: string | null;
          location_id?: string | null;
          location_label?: string;
          seller_verified?: boolean;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          product_id: string | null;
          product_snapshot: Json;
          buyer_id: string | null;
          buyer_name: string;
          buyer_email: string;
          method: string;
          amount_kes: number;
          status: string;
          provider_ref: string | null;
          mpesa_receipt: string | null;
          checkout_request_id: string | null;
          mpesa_phone: string | null;
          failure_reason: string | null;
          created_at: string;
          completed_at: string | null;
          receipt_confirmed_at: string | null;
          escrow_held_at: string | null;
          disputed_at: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
        };
        Insert: {
          id?: string;
          product_id?: string | null;
          product_snapshot?: Json;
          buyer_id?: string | null;
          buyer_name?: string;
          buyer_email?: string;
          method?: string;
          amount_kes?: number;
          status?: string;
          provider_ref?: string | null;
          mpesa_receipt?: string | null;
          checkout_request_id?: string | null;
          mpesa_phone?: string | null;
          failure_reason?: string | null;
          created_at?: string;
          completed_at?: string | null;
          receipt_confirmed_at?: string | null;
          escrow_held_at?: string | null;
          disputed_at?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
        };
        Update: {
          id?: string;
          product_id?: string | null;
          product_snapshot?: Json;
          buyer_id?: string | null;
          buyer_name?: string;
          buyer_email?: string;
          method?: string;
          amount_kes?: number;
          status?: string;
          provider_ref?: string | null;
          mpesa_receipt?: string | null;
          checkout_request_id?: string | null;
          mpesa_phone?: string | null;
          failure_reason?: string | null;
          created_at?: string;
          completed_at?: string | null;
          receipt_confirmed_at?: string | null;
          escrow_held_at?: string | null;
          disputed_at?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
        };
        Relationships: [];
      };
      payouts: {
        Row: {
          id: string;
          order_id: string | null;
          to: string;
          role: string;
          amount_kes: number;
          status: string;
          provider_ref: string | null;
          failure_reason: string | null;
          paid_at: string | null;
          created_at: string;
          escrow_release_at: string | null;
          refund_phone: string | null;
          processing_started_at: string | null;
          payout_method: string | null;
          recipient_code: string | null;
        };
        Insert: {
          id?: string;
          order_id?: string | null;
          to: string;
          role?: string;
          amount_kes?: number;
          status?: string;
          provider_ref?: string | null;
          failure_reason?: string | null;
          paid_at?: string | null;
          created_at?: string;
          escrow_release_at?: string | null;
          refund_phone?: string | null;
          processing_started_at?: string | null;
          payout_method?: string | null;
          recipient_code?: string | null;
        };
        Update: {
          id?: string;
          order_id?: string | null;
          to?: string;
          role?: string;
          amount_kes?: number;
          status?: string;
          provider_ref?: string | null;
          failure_reason?: string | null;
          paid_at?: string | null;
          created_at?: string;
          escrow_release_at?: string | null;
          refund_phone?: string | null;
          processing_started_at?: string | null;
          payout_method?: string | null;
          recipient_code?: string | null;
        };
        Relationships: [];
      };
      listings: {
        Row: {
          id: string;
          product_id: string | null;
          seller_id: string | null;
          title: string;
          brand: string;
          category: string;
          size: string;
          price_kes: number;
          image_url: string;
          status: string;
          order_id: string | null;
          sold_at: string | null;
          created_at: string;
          boost_expires_at: string | null;
          condition: string;
          era: string | null;
          description: string | null;
          location_id: string | null;
          location_label: string;
        };
        Insert: {
          id?: string;
          product_id?: string | null;
          seller_id?: string | null;
          title?: string;
          brand?: string;
          category?: string;
          size?: string;
          price_kes?: number;
          image_url?: string;
          status?: string;
          order_id?: string | null;
          sold_at?: string | null;
          created_at?: string;
          boost_expires_at?: string | null;
          condition?: string;
          era?: string | null;
          description?: string | null;
          location_id?: string | null;
          location_label?: string;
        };
        Update: {
          id?: string;
          product_id?: string | null;
          seller_id?: string | null;
          title?: string;
          brand?: string;
          category?: string;
          size?: string;
          price_kes?: number;
          image_url?: string;
          status?: string;
          order_id?: string | null;
          sold_at?: string | null;
          created_at?: string;
          boost_expires_at?: string | null;
          condition?: string;
          era?: string | null;
          description?: string | null;
          location_id?: string | null;
          location_label?: string;
        };
        Relationships: [];
      };
      wishlists: {
        Row: {
          id: string;
          user_id: string;
          product_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          product_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          product_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          title: string;
          body: string;
          read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type?: string;
          title?: string;
          body?: string;
          read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: string;
          title?: string;
          body?: string;
          read?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      ratings: {
        Row: {
          id: string;
          user_id: string;
          order_id: string | null;
          score: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          order_id?: string | null;
          score: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          order_id?: string | null;
          score?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      payout_reports: {
        Row: {
          id: string;
          payout_id: string;
          user_id: string;
          reason: string;
          status: string;
          admin_note: string | null;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          payout_id: string;
          user_id: string;
          reason?: string;
          status?: string;
          admin_note?: string | null;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          payout_id?: string;
          user_id?: string;
          reason?: string;
          status?: string;
          admin_note?: string | null;
          created_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [];
      };
      boosts: {
        Row: {
          id: string;
          product_id: string | null;
          seller_id: string;
          amount_kes: number;
          status: string;
          failure_reason: string | null;
          checkout_request_id: string | null;
          mpesa_phone: string | null;
          mpesa_receipt: string | null;
          provider_ref: string | null;
          created_at: string;
          paid_at: string | null;
        };
        Insert: {
          id?: string;
          product_id?: string | null;
          seller_id: string;
          amount_kes?: number;
          status?: string;
          failure_reason?: string | null;
          checkout_request_id?: string | null;
          mpesa_phone?: string | null;
          mpesa_receipt?: string | null;
          provider_ref?: string | null;
          created_at?: string;
          paid_at?: string | null;
        };
        Update: {
          id?: string;
          product_id?: string | null;
          seller_id?: string;
          amount_kes?: number;
          status?: string;
          failure_reason?: string | null;
          checkout_request_id?: string | null;
          mpesa_phone?: string | null;
          mpesa_receipt?: string | null;
          provider_ref?: string | null;
          created_at?: string;
          paid_at?: string | null;
        };
        Relationships: [];
      };
      locations: {
        Row: {
          id: string;
          city: string;
          area: string;
          landmark: string;
        };
        Insert: {
          id?: string;
          city: string;
          area: string;
          landmark?: string;
        };
        Update: {
          id?: string;
          city?: string;
          area?: string;
          landmark?: string;
        };
        Relationships: [];
      };
      location_alerts: {
        Row: {
          id: string;
          user_id: string;
          location_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          location_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          location_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      order_disputes: {
        Row: {
          id: string;
          order_id: string;
          user_id: string;
          reason: string;
          status: string;
          admin_note: string | null;
          created_at: string;
          resolved_at: string | null;
          proof_url: string | null;
          proof_uploaded_by: string | null;
        };
        Insert: {
          id?: string;
          order_id: string;
          user_id: string;
          reason?: string;
          status?: string;
          admin_note?: string | null;
          created_at?: string;
          resolved_at?: string | null;
          proof_url?: string | null;
          proof_uploaded_by?: string | null;
        };
        Update: {
          id?: string;
          order_id?: string;
          user_id?: string;
          reason?: string;
          status?: string;
          admin_note?: string | null;
          created_at?: string;
          resolved_at?: string | null;
          proof_url?: string | null;
          proof_uploaded_by?: string | null;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          order_id: string;
          sender_id: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          sender_id: string;
          body?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          sender_id?: string;
          body?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      listing_conversations: {
        Row: {
          id: string;
          listing_id: string;
          buyer_id: string;
          seller_id: string;
          listing_title: string;
          listing_image: string;
          buyer_name: string;
          seller_name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          listing_id: string;
          buyer_id: string;
          seller_id: string;
          listing_title?: string;
          listing_image?: string;
          buyer_name?: string;
          seller_name?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          listing_id?: string;
          buyer_id?: string;
          seller_id?: string;
          listing_title?: string;
          listing_image?: string;
          buyer_name?: string;
          seller_name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      listing_messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          sender_id?: string;
          body?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      meetup_checkins: {
        Row: {
          id: string;
          order_id: string;
          user_id: string;
          checked_in_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          user_id: string;
          checked_in_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          user_id?: string;
          checked_in_at?: string;
        };
        Relationships: [];
      };
      meetup_shares: {
        Row: {
          id: string;
          order_id: string;
          user_id: string;
          lat: number;
          lng: number;
          accuracy: number;
          expires_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          user_id: string;
          lat: number;
          lng: number;
          accuracy?: number;
          expires_at: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          user_id?: string;
          lat?: number;
          lng?: number;
          accuracy?: number;
          expires_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      open_listing_chat: {
        Args: {
          p_listing_id: string;
        };
        Returns: string;
      };
      purchase_product: {
        Args: {
          p_product_id: string;
          p_buyer_name: string;
          p_buyer_email: string;
          p_method: string;
          p_provider_ref?: string | null;
        };
        Returns: string;
      };
      finalize_order: {
        Args: {
          p_order_id: string;
          p_mpesa_receipt?: string | null;
          p_provider_ref?: string | null;
        };
        Returns: string;
      };
      finalize_by_checkout_request: {
        Args: {
          p_checkout_request_id: string;
          p_mpesa_receipt?: string | null;
          p_expected_amount?: number | null;
          p_expected_phone?: string | null;
        };
        Returns: string | null;
      };
      finalize_order_by_reference: {
        Args: {
          p_reference: string;
          p_expected_amount: number;
        };
        Returns: string | null;
      };
      mark_order_failed_by_reference: {
        Args: {
          p_reference: string;
          p_reason?: string | null;
        };
        Returns: string | null;
      };
      finalize_boost_by_reference: {
        Args: {
          p_reference: string;
          p_expected_amount: number;
        };
        Returns: string | null;
      };
      mark_boost_failed_by_reference: {
        Args: {
          p_reference: string;
          p_reason?: string | null;
        };
        Returns: string | null;
      };
      mark_order_failed: {
        Args: {
          p_checkout_request_id: string;
          p_reason?: string | null;
        };
        Returns: string | null;
      };
      finalize_boost: {
        Args: {
          p_checkout_request_id: string;
          p_mpesa_receipt?: string | null;
          p_expected_amount?: number | null;
          p_expected_phone?: string | null;
        };
        Returns: string | null;
      };
      mark_boost_failed: {
        Args: {
          p_checkout_request_id: string;
          p_reason?: string | null;
        };
        Returns: string | null;
      };
      dispute_order: {
        Args: {
          p_order_id: string;
          p_reason?: string | null;
        };
        Returns: string;
      };
      admin_resolve_order_dispute: {
        Args: {
          p_dispute_id: string;
          p_admin_note?: string | null;
          p_outcome?: string;
        };
        Returns: string;
      };
      cancel_order_no_show: {
        Args: {
          p_order_id: string;
        };
        Returns: string;
      };
      create_listing: {
        Args: {
          p_title: string;
          p_brand: string;
          p_category: string;
          p_size: string;
          p_condition: string;
          p_price_kes: number;
          p_image_url: string;
          p_image_urls?: string[] | null;
          p_description?: string | null;
          p_era?: string | null;
        };
        Returns: string;
      };
      admin_delete_product: {
        Args: {
          p_product_id: string;
          p_note?: string | null;
        };
        Returns: undefined;
      };
      admin_set_product_status: {
        Args: {
          p_product_id: string;
          p_status: string;
        };
        Returns: undefined;
      };
      admin_create_product: {
        Args: {
          p_title: string;
          p_brand: string;
          p_category: string;
          p_size: string;
          p_condition: string;
          p_price_kes: number;
          p_image_url: string;
          p_image_urls?: string[] | null;
          p_description?: string | null;
          p_era?: string | null;
        };
        Returns: string;
      };
      admin_reset_payout: {
        Args: {
          p_payout_id: string;
        };
        Returns: undefined;
      };
      report_payout: {
        Args: {
          p_payout_id: string;
          p_reason?: string | null;
        };
        Returns: string;
      };
      admin_resolve_payout_report: {
        Args: {
          p_report_id: string;
          p_admin_note?: string | null;
        };
        Returns: undefined;
      };
      confirm_receipt: {
        Args: {
          p_order_id: string;
        };
        Returns: number;
      };
      release_expired_escrow: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      check_in_order: {
        Args: {
          p_order_id: string;
        };
        Returns: string;
      };
      meetup_share_start: {
        Args: {
          p_order_id: string;
          p_lat: number;
          p_lng: number;
          p_accuracy?: number;
        };
        Returns: string;
      };
      meetup_share_update: {
        Args: {
          p_order_id: string;
          p_lat: number;
          p_lng: number;
          p_accuracy?: number;
        };
        Returns: undefined;
      };
      meetup_share_stop: {
        Args: {
          p_order_id: string;
        };
        Returns: undefined;
      };
      get_rating_summary: {
        Args: {
          p_seller_id?: string | null;
        };
        Returns: {
          avg_score: number;
          total: number;
        }[];
      };
      get_seller_profile: {
        Args: {
          p_seller_id: string;
        };
        Returns: {
          name: string;
          member_since: string;
          location_label: string | null;
          avg_score: number | null;
          rating_count: number;
          sales: number;
          seller_verified: boolean;
        }[];
      };
      request_seller_verification: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      admin_set_seller_verified: {
        Args: {
          p_user_id: string;
          p_verified: boolean;
        };
        Returns: undefined;
      };
      add_dispute_proof: {
        Args: {
          p_dispute_id: string;
          p_url: string;
        };
        Returns: undefined;
      };
      rate_limit_hit: {
        Args: {
          p_key: string;
          p_limit: number;
          p_window_ms: number;
        };
        Returns: {
          ok: boolean;
          remaining: number;
          reset_at: string;
        }[];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}
