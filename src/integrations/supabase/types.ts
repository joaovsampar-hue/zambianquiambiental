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
      analyses: {
        Row: {
          alerts: Json | null
          created_at: string
          created_by: string
          extracted_data: Json | null
          id: string
          pdf_path: string | null
          process_id: string | null
          property_id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          alerts?: Json | null
          created_at?: string
          created_by: string
          extracted_data?: Json | null
          id?: string
          pdf_path?: string | null
          process_id?: string | null
          property_id: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          alerts?: Json | null
          created_at?: string
          created_by?: string
          extracted_data?: Json | null
          id?: string
          pdf_path?: string | null
          process_id?: string | null
          property_id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "analyses_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyses_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          cpf_cnpj: string | null
          created_at: string
          created_by: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          cpf_cnpj?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          cpf_cnpj?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      process_geometry: {
        Row: {
          coordinates_text: string | null
          created_at: string
          created_by: string
          geojson: Json | null
          id: string
          kml_raw: string | null
          process_id: string
          reference_lat: number | null
          reference_lng: number | null
          source: string | null
          updated_at: string
        }
        Insert: {
          coordinates_text?: string | null
          created_at?: string
          created_by: string
          geojson?: Json | null
          id?: string
          kml_raw?: string | null
          process_id: string
          reference_lat?: number | null
          reference_lng?: number | null
          source?: string | null
          updated_at?: string
        }
        Update: {
          coordinates_text?: string | null
          created_at?: string
          created_by?: string
          geojson?: Json | null
          id?: string
          kml_raw?: string | null
          process_id?: string
          reference_lat?: number | null
          reference_lng?: number | null
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "process_geometry_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: true
            referencedRelation: "processes"
            referencedColumns: ["id"]
          },
        ]
      }
      process_neighbors: {
        Row: {
          address: string | null
          birth_date: string | null
          car_number: string | null
          ccir_number: string | null
          consent_status: string
          converted_client_id: string | null
          cpf_cnpj: string | null
          created_at: string
          created_by: string
          email: string | null
          extracted_data: Json
          follow_up_at: string | null
          full_name: string | null
          id: string
          last_contact_at: string | null
          marital_status: string | null
          marriage_regime: string | null
          needs_title_check: boolean
          neighbor_type: string
          notes: string | null
          pdfs: Json
          phones: Json
          positions: string[]
          process_id: string
          property_denomination: string | null
          registration_number: string | null
          registry_office: string | null
          rg: string | null
          rg_issuer: string | null
          spouse_cpf: string | null
          spouse_name: string | null
          spouse_rg: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          birth_date?: string | null
          car_number?: string | null
          ccir_number?: string | null
          consent_status?: string
          converted_client_id?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          extracted_data?: Json
          follow_up_at?: string | null
          full_name?: string | null
          id?: string
          last_contact_at?: string | null
          marital_status?: string | null
          marriage_regime?: string | null
          needs_title_check?: boolean
          neighbor_type?: string
          notes?: string | null
          pdfs?: Json
          phones?: Json
          positions?: string[]
          process_id: string
          property_denomination?: string | null
          registration_number?: string | null
          registry_office?: string | null
          rg?: string | null
          rg_issuer?: string | null
          spouse_cpf?: string | null
          spouse_name?: string | null
          spouse_rg?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          birth_date?: string | null
          car_number?: string | null
          ccir_number?: string | null
          consent_status?: string
          converted_client_id?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          extracted_data?: Json
          follow_up_at?: string | null
          full_name?: string | null
          id?: string
          last_contact_at?: string | null
          marital_status?: string | null
          marriage_regime?: string | null
          needs_title_check?: boolean
          neighbor_type?: string
          notes?: string | null
          pdfs?: Json
          phones?: Json
          positions?: string[]
          process_id?: string
          property_denomination?: string | null
          registration_number?: string | null
          registry_office?: string | null
          rg?: string | null
          rg_issuer?: string | null
          spouse_cpf?: string | null
          spouse_name?: string | null
          spouse_rg?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "process_neighbors_converted_client_id_fkey"
            columns: ["converted_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_neighbors_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "processes"
            referencedColumns: ["id"]
          },
        ]
      }
      processes: {
        Row: {
          car_number: string | null
          client_id: string
          created_at: string
          created_by: string
          current_stage: string
          id: string
          last_activity_at: string
          notes: string | null
          process_number: string
          property_id: string | null
          service_type: string
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          car_number?: string | null
          client_id: string
          created_at?: string
          created_by: string
          current_stage?: string
          id?: string
          last_activity_at?: string
          notes?: string | null
          process_number: string
          property_id?: string | null
          service_type?: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          car_number?: string | null
          client_id?: string
          created_at?: string
          created_by?: string
          current_stage?: string
          id?: string
          last_activity_at?: string
          notes?: string | null
          process_number?: string
          property_id?: string | null
          service_type?: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "processes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          denomination: string
          id: string
          municipality: string | null
          notes: string | null
          registration_number: string | null
          state: string | null
          total_area_ha: number | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by: string
          denomination: string
          id?: string
          municipality?: string | null
          notes?: string | null
          registration_number?: string | null
          state?: string | null
          total_area_ha?: number | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          denomination?: string
          id?: string
          municipality?: string | null
          notes?: string | null
          registration_number?: string | null
          state?: string | null
          total_area_ha?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
