export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3";
  };
  public: {
    Tables: {
      ai_usage: {
        Row: {
          chat_count: number;
          period: string;
          scan_count: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          chat_count?: number;
          period: string;
          scan_count?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          chat_count?: number;
          period?: string;
          scan_count?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      budget: {
        Row: {
          amount: number;
          category: number | null;
          created_at: string;
          id: number;
          user_id: string;
        };
        Insert: {
          amount: number;
          category?: number | null;
          created_at?: string;
          id?: number;
          user_id?: string;
        };
        Update: {
          amount?: number;
          category?: number | null;
          created_at?: string;
          id?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "budget_category_fkey";
            columns: ["category"];
            isOneToOne: false;
            referencedRelation: "expense_category";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_message: {
        Row: {
          created_at: string;
          data: Json;
          id: number;
          session_id: string;
          type: string;
          ui_id: string;
        };
        Insert: {
          created_at?: string;
          data: Json;
          id?: never;
          session_id: string;
          type: string;
          ui_id?: string;
        };
        Update: {
          created_at?: string;
          data?: Json;
          id?: never;
          session_id?: string;
          type?: string;
          ui_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_message_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "chat_session";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_session: {
        Row: {
          created_at: string;
          id: string;
          title: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          title?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          title?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      expense: {
        Row: {
          amount: number | null;
          category: number | null;
          created_at: string;
          id: number;
          is_expense: boolean | null;
          name: string | null;
          spend_date: string | null;
          user_id: string | null;
        };
        Insert: {
          amount?: number | null;
          category?: number | null;
          created_at?: string;
          id?: number;
          is_expense?: boolean | null;
          name?: string | null;
          spend_date?: string | null;
          user_id?: string | null;
        };
        Update: {
          amount?: number | null;
          category?: number | null;
          created_at?: string;
          id?: number;
          is_expense?: boolean | null;
          name?: string | null;
          spend_date?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "expense_category_fkey";
            columns: ["category"];
            isOneToOne: false;
            referencedRelation: "expense_category";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_category: {
        Row: {
          created_at: string;
          id: number;
          is_expense: boolean | null;
          name: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: number;
          is_expense?: boolean | null;
          name?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: number;
          is_expense?: boolean | null;
          name?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      loan: {
        Row: {
          created_at: string;
          id: number;
          interest_rate: number | null;
          name: string | null;
          total_amount: number | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: number;
          interest_rate?: number | null;
          name?: string | null;
          total_amount?: number | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: number;
          interest_rate?: number | null;
          name?: string | null;
          total_amount?: number | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      loan_record: {
        Row: {
          amount: string | null;
          created_at: string;
          id: number;
          loan: number | null;
          pay_date: string | null;
          user_id: string | null;
        };
        Insert: {
          amount?: string | null;
          created_at?: string;
          id?: number;
          loan?: number | null;
          pay_date?: string | null;
          user_id?: string | null;
        };
        Update: {
          amount?: string | null;
          created_at?: string;
          id?: number;
          loan?: number | null;
          pay_date?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "loan_record_loan_fkey";
            columns: ["loan"];
            isOneToOne: false;
            referencedRelation: "loan";
            referencedColumns: ["id"];
          },
        ];
      };
      recurring_expense: {
        Row: {
          amount: number;
          category: number;
          created_at: string;
          day_of_month: number;
          id: number;
          is_active: boolean;
          is_expense: boolean;
          last_run_date: string | null;
          name: string;
          user_id: string;
        };
        Insert: {
          amount: number;
          category: number;
          created_at?: string;
          day_of_month: number;
          id?: number;
          is_active?: boolean;
          is_expense?: boolean;
          last_run_date?: string | null;
          name: string;
          user_id?: string;
        };
        Update: {
          amount?: number;
          category?: number;
          created_at?: string;
          day_of_month?: number;
          id?: number;
          is_active?: boolean;
          is_expense?: boolean;
          last_run_date?: string | null;
          name?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_expense_category_fkey";
            columns: ["category"];
            isOneToOne: false;
            referencedRelation: "expense_category";
            referencedColumns: ["id"];
          },
        ];
      };
      revenuecat_event: {
        Row: {
          app_user_id: string | null;
          environment: string | null;
          event_at: string;
          id: string;
          payload: Json;
          received_at: string;
          type: string;
        };
        Insert: {
          app_user_id?: string | null;
          environment?: string | null;
          event_at: string;
          id: string;
          payload: Json;
          received_at?: string;
          type: string;
        };
        Update: {
          app_user_id?: string | null;
          environment?: string | null;
          event_at?: string;
          id?: string;
          payload?: Json;
          received_at?: string;
          type?: string;
        };
        Relationships: [];
      };
      user_profile: {
        Row: {
          billing_issue: boolean;
          created_at: string;
          environment: string | null;
          expires_at: string | null;
          grace_expires_at: string | null;
          last_event_at: string | null;
          last_event_id: string | null;
          period_type: string | null;
          product_id: string | null;
          push_platform: string | null;
          push_token: string | null;
          store: string | null;
          tier: string;
          trial_used: boolean;
          updated_at: string;
          user_id: string;
          will_renew: boolean;
        };
        Insert: {
          billing_issue?: boolean;
          created_at?: string;
          environment?: string | null;
          expires_at?: string | null;
          grace_expires_at?: string | null;
          last_event_at?: string | null;
          last_event_id?: string | null;
          period_type?: string | null;
          product_id?: string | null;
          push_platform?: string | null;
          push_token?: string | null;
          store?: string | null;
          tier?: string;
          trial_used?: boolean;
          updated_at?: string;
          user_id: string;
          will_renew?: boolean;
        };
        Update: {
          billing_issue?: boolean;
          created_at?: string;
          environment?: string | null;
          expires_at?: string | null;
          grace_expires_at?: string | null;
          last_event_at?: string | null;
          last_event_id?: string | null;
          period_type?: string | null;
          product_id?: string | null;
          push_platform?: string | null;
          push_token?: string | null;
          store?: string | null;
          tier?: string;
          trial_used?: boolean;
          updated_at?: string;
          user_id?: string;
          will_renew?: boolean;
        };
        Relationships: [];
      };
      whatsapp_pending_actions: {
        Row: {
          actions: Json;
          created_at: string | null;
          expires_at: string;
          id: string;
          phone_number: string;
        };
        Insert: {
          actions: Json;
          created_at?: string | null;
          expires_at?: string;
          id?: string;
          phone_number: string;
        };
        Update: {
          actions?: Json;
          created_at?: string | null;
          expires_at?: string;
          id?: string;
          phone_number?: string;
        };
        Relationships: [];
      };
      whatsapp_users: {
        Row: {
          created_at: string | null;
          is_verified: boolean;
          phone_number: string;
          push_platform: string | null;
          push_token: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          is_verified?: boolean;
          phone_number: string;
          push_platform?: string | null;
          push_token?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          is_verified?: boolean;
          phone_number?: string;
          push_platform?: string | null;
          push_token?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      user_entitlement: {
        Row: {
          entitled_until: string | null;
          tier: string | null;
          user_id: string | null;
        };
        Insert: {
          entitled_until?: never;
          tier?: string | null;
          user_id?: string | null;
        };
        Update: {
          entitled_until?: never;
          tier?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      apply_subscription_event: {
        Args: {
          p_app_user_id?: string;
          p_billing_issue: boolean;
          p_environment: string;
          p_event_at: string;
          p_event_id: string;
          p_event_type: string;
          p_expires_at?: string;
          p_grace_expires_at?: string;
          p_is_trial: boolean;
          p_payload: Json;
          p_period_type?: string;
          p_product_id?: string;
          p_store?: string;
          p_tier?: string;
          p_user_id: string;
          p_will_renew: boolean;
        };
        Returns: string;
      };
      clear_push_token: { Args: never; Returns: undefined };
      consume_ai_usage: {
        Args: {
          p_kind: string;
          p_plus_limit: number;
          p_pro_limit: number;
          p_user_id: string;
        };
        Returns: {
          allowed: boolean;
          period: string;
          quota: number;
          tier: string;
          used: number;
        }[];
      };
      get_expense_stats: {
        Args: { p_month?: number; p_user_id: string; p_year?: number };
        Returns: {
          balance: number;
          total_expenses: number;
          total_income: number;
        }[];
      };
      process_recurring_expenses: { Args: never; Returns: undefined };
      purge_free_user_expenses: { Args: never; Returns: number };
      set_push_token: {
        Args: { p_platform?: string; p_token: string };
        Returns: undefined;
      };
      transfer_subscription: {
        Args: {
          p_event_at: string;
          p_event_id: string;
          p_from: string[];
          p_payload: Json;
          p_to: string[];
        };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
