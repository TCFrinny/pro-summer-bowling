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
      historical_match_results: {
        Row: {
          created_at: string
          derived: Json | null
          detail_mode: string
          game_scores_a: number[] | null
          game_scores_b: number[] | null
          id: string
          linescore_a: Json | null
          linescore_b: Json | null
          point_override: Json | null
          points_a: number
          points_b: number
          season_id: string
          side_a: Json
          side_b: Json
          slot_id: string
          updated_at: string
          week_id: string
        }
        Insert: {
          created_at?: string
          derived?: Json | null
          detail_mode: string
          game_scores_a?: number[] | null
          game_scores_b?: number[] | null
          id?: string
          linescore_a?: Json | null
          linescore_b?: Json | null
          point_override?: Json | null
          points_a?: number
          points_b?: number
          season_id: string
          side_a: Json
          side_b: Json
          slot_id: string
          updated_at?: string
          week_id: string
        }
        Update: {
          created_at?: string
          derived?: Json | null
          detail_mode?: string
          game_scores_a?: number[] | null
          game_scores_b?: number[] | null
          id?: string
          linescore_a?: Json | null
          linescore_b?: Json | null
          point_override?: Json | null
          points_a?: number
          points_b?: number
          season_id?: string
          side_a?: Json
          side_b?: Json
          slot_id?: string
          updated_at?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "historical_match_results_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_match_results_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: true
            referencedRelation: "historical_schedule_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_match_results_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "historical_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_schedule_slots: {
        Row: {
          bowler_a_ref: string
          bowler_b_ref: string
          bowler_number_a: string | null
          bowler_number_b: string | null
          created_at: string
          id: string
          lane_pair: string
          name_a: string | null
          name_b: string | null
          season_id: string
          slot: number
          updated_at: string
          week_id: string
        }
        Insert: {
          bowler_a_ref: string
          bowler_b_ref: string
          bowler_number_a?: string | null
          bowler_number_b?: string | null
          created_at?: string
          id?: string
          lane_pair: string
          name_a?: string | null
          name_b?: string | null
          season_id: string
          slot: number
          updated_at?: string
          week_id: string
        }
        Update: {
          bowler_a_ref?: string
          bowler_b_ref?: string
          bowler_number_a?: string | null
          bowler_number_b?: string | null
          created_at?: string
          id?: string
          lane_pair?: string
          name_a?: string | null
          name_b?: string | null
          season_id?: string
          slot?: number
          updated_at?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "historical_schedule_slots_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_schedule_slots_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "historical_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_season_snapshots: {
        Row: {
          built_at: string
          season_id: string
          snapshot: Json
        }
        Insert: {
          built_at?: string
          season_id: string
          snapshot: Json
        }
        Update: {
          built_at?: string
          season_id?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "historical_season_snapshots_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: true
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_season_summary_records: {
        Row: {
          average: number | null
          bowler_number: string | null
          created_at: string
          display_name: string
          final_finish: number | null
          games: number | null
          high_game: number | null
          high_set: number | null
          id: string
          is_champion: boolean
          notes: string | null
          participant_ref: string
          person_id: string | null
          points: number | null
          points_lost: number | null
          role: string
          scratch_pinfall: number | null
          season_id: string
          updated_at: string
        }
        Insert: {
          average?: number | null
          bowler_number?: string | null
          created_at?: string
          display_name: string
          final_finish?: number | null
          games?: number | null
          high_game?: number | null
          high_set?: number | null
          id?: string
          is_champion?: boolean
          notes?: string | null
          participant_ref: string
          person_id?: string | null
          points?: number | null
          points_lost?: number | null
          role: string
          scratch_pinfall?: number | null
          season_id: string
          updated_at?: string
        }
        Update: {
          average?: number | null
          bowler_number?: string | null
          created_at?: string
          display_name?: string
          final_finish?: number | null
          games?: number | null
          high_game?: number | null
          high_set?: number | null
          id?: string
          is_champion?: boolean
          notes?: string | null
          participant_ref?: string
          person_id?: string | null
          points?: number | null
          points_lost?: number | null
          role?: string
          scratch_pinfall?: number | null
          season_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "historical_season_summary_records_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_season_summary_records_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_weeks: {
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
            foreignKeyName: "historical_weeks_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      live_match_results: {
        Row: {
          a_game1: number | null
          a_game2: number | null
          a_game3: number | null
          b_game1: number | null
          b_game2: number | null
          b_game3: number | null
          created_at: string
          entered_by: string | null
          id: string
          schedule_slot_id: string
          season_id: string
          side_a: Json
          side_b: Json
          updated_at: string
          week_id: string
        }
        Insert: {
          a_game1?: number | null
          a_game2?: number | null
          a_game3?: number | null
          b_game1?: number | null
          b_game2?: number | null
          b_game3?: number | null
          created_at?: string
          entered_by?: string | null
          id?: string
          schedule_slot_id: string
          season_id: string
          side_a: Json
          side_b: Json
          updated_at?: string
          week_id: string
        }
        Update: {
          a_game1?: number | null
          a_game2?: number | null
          a_game3?: number | null
          b_game1?: number | null
          b_game2?: number | null
          b_game3?: number | null
          created_at?: string
          entered_by?: string | null
          id?: string
          schedule_slot_id?: string
          season_id?: string
          side_a?: Json
          side_b?: Json
          updated_at?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_match_results_schedule_slot_id_fkey"
            columns: ["schedule_slot_id"]
            isOneToOne: true
            referencedRelation: "schedule_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_match_results_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_match_results_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
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
      people: {
        Row: {
          created_at: string
          display_name: string
          id: string
          normalized_name: string | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          normalized_name?: string | null
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          normalized_name?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      person_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          normalized_alias: string
          person_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          normalized_alias: string
          person_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          normalized_alias?: string
          person_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
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
          person_id: string | null
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
          person_id?: string | null
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
          person_id?: string | null
          season_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rostered_bowlers_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
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
      season_lane_pairs: {
        Row: {
          active: boolean
          created_at: string
          display_order: number
          id: string
          label: string
          matchup_capacity: number
          season_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_order?: number
          id?: string
          label: string
          matchup_capacity: number
          season_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_order?: number
          id?: string
          label?: string
          matchup_capacity?: number
          season_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_lane_pairs_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          champion_person_id: string | null
          created_at: string
          description: string | null
          end_date: string | null
          handicap_base: number | null
          handicap_percent: number | null
          id: string
          is_current: boolean
          label: string
          point_system: number | null
          public_visible: boolean
          start_date: string | null
          status: string
          total_weeks: number | null
          updated_at: string
        }
        Insert: {
          champion_person_id?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          handicap_base?: number | null
          handicap_percent?: number | null
          id?: string
          is_current?: boolean
          label: string
          point_system?: number | null
          public_visible?: boolean
          start_date?: string | null
          status?: string
          total_weeks?: number | null
          updated_at?: string
        }
        Update: {
          champion_person_id?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          handicap_base?: number | null
          handicap_percent?: number | null
          id?: string
          is_current?: boolean
          label?: string
          point_system?: number | null
          public_visible?: boolean
          start_date?: string | null
          status?: string
          total_weeks?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seasons_champion_person_id_fkey"
            columns: ["champion_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
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
          person_id: string | null
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
          person_id?: string | null
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
          person_id?: string | null
          season_id?: string
          starting_average?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "substitutes_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
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
      merge_people: {
        Args: { _confirm: boolean; _keep: string; _remove: string }
        Returns: Json
      }
      season_is_historical_writable: {
        Args: { _season_id: string }
        Returns: boolean
      }
      season_is_public_archive: {
        Args: { _season_id: string }
        Returns: boolean
      }
      substitute_referenced: { Args: { _sub_id: string }; Returns: boolean }
      switch_current_season: {
        Args: { _confirm: boolean; _season_id: string }
        Returns: undefined
      }
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
