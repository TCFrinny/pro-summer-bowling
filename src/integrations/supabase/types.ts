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
      match_results: {
        Row: {
          created_at: string
          derived: Json
          entered_by: string | null
          id: string
          linescore_a: Json | null
          linescore_b: Json | null
          override: Json | null
          schedule_slot_id: string
          season_id: string
          side_a: Json
          side_b: Json
          updated_at: string
          week_id: string
        }
        Insert: {
          created_at?: string
          derived: Json
          entered_by?: string | null
          id?: string
          linescore_a?: Json | null
          linescore_b?: Json | null
          override?: Json | null
          schedule_slot_id: string
          season_id: string
          side_a: Json
          side_b: Json
          updated_at?: string
          week_id: string
        }
        Update: {
          created_at?: string
          derived?: Json
          entered_by?: string | null
          id?: string
          linescore_a?: Json | null
          linescore_b?: Json | null
          override?: Json | null
          schedule_slot_id?: string
          season_id?: string
          side_a?: Json
          side_b?: Json
          updated_at?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_results_schedule_slot_id_fkey"
            columns: ["schedule_slot_id"]
            isOneToOne: true
            referencedRelation: "schedule_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_results_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_results_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      public_snapshots: {
        Row: {
          season_id: string
          snapshot: Json
          updated_at: string
        }
        Insert: {
          season_id: string
          snapshot: Json
          updated_at?: string
        }
        Update: {
          season_id?: string
          snapshot?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_snapshots_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: true
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      rostered_bowlers: {
        Row: {
          active: boolean
          archived: boolean
          bowler_number: string | null
          created_at: string
          entry_average: number
          handicap: number
          id: string
          name: string
          season_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          archived?: boolean
          bowler_number?: string | null
          created_at?: string
          entry_average: number
          handicap: number
          id: string
          name: string
          season_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          archived?: boolean
          bowler_number?: string | null
          created_at?: string
          entry_average?: number
          handicap?: number
          id?: string
          name?: string
          season_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rostered_bowlers_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_slots: {
        Row: {
          bowler_a_id: string | null
          bowler_b_id: string | null
          bowler_number_a: string | null
          bowler_number_b: string | null
          created_at: string
          id: string
          lane_pair: string
          name_a: string | null
          name_b: string | null
          slot: number
          updated_at: string
          week_id: string
        }
        Insert: {
          bowler_a_id?: string | null
          bowler_b_id?: string | null
          bowler_number_a?: string | null
          bowler_number_b?: string | null
          created_at?: string
          id?: string
          lane_pair: string
          name_a?: string | null
          name_b?: string | null
          slot: number
          updated_at?: string
          week_id: string
        }
        Update: {
          bowler_a_id?: string | null
          bowler_b_id?: string | null
          bowler_number_a?: string | null
          bowler_number_b?: string | null
          created_at?: string
          id?: string
          lane_pair?: string
          name_a?: string | null
          name_b?: string | null
          slot?: number
          updated_at?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_slots_bowler_a_id_fkey"
            columns: ["bowler_a_id"]
            isOneToOne: false
            referencedRelation: "rostered_bowlers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_slots_bowler_b_id_fkey"
            columns: ["bowler_b_id"]
            isOneToOne: false
            referencedRelation: "rostered_bowlers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_slots_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string
          id: string
          is_current: boolean
          label: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_current?: boolean
          label: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_current?: boolean
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      substitutes: {
        Row: {
          active: boolean
          archived: boolean
          bowler_number: string | null
          created_at: string
          handicap: number | null
          id: string
          name: string
          season_id: string
          starting_average: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          archived?: boolean
          bowler_number?: string | null
          created_at?: string
          handicap?: number | null
          id: string
          name: string
          season_id: string
          starting_average?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          archived?: boolean
          bowler_number?: string | null
          created_at?: string
          handicap?: number | null
          id?: string
          name?: string
          season_id?: string
          starting_average?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "substitutes_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
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
      weeks: {
        Row: {
          completed: boolean
          created_at: string
          date: string | null
          id: string
          published: boolean
          season_id: string
          updated_at: string
          week_number: number
        }
        Insert: {
          completed?: boolean
          created_at?: string
          date?: string | null
          id?: string
          published?: boolean
          season_id: string
          updated_at?: string
          week_number: number
        }
        Update: {
          completed?: boolean
          created_at?: string
          date?: string | null
          id?: string
          published?: boolean
          season_id?: string
          updated_at?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "weeks_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_is_admin: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      substitute_referenced: { Args: { _sub_id: string }; Returns: boolean }
      week_published: { Args: { _week_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin"
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
      app_role: ["admin"],
    },
  },
} as const
