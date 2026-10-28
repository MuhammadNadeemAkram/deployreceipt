// Schema contract for supabase/migrations. Regenerate with Supabase CLI after schema changes.
export type Project = {
  id: string;
  owner_id: string;
  name: string;
  website_url: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};
type Profile = {
  id: string;
  full_name: string | null;
  created_at: string;
  updated_at: string;
};
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: { id: string; full_name?: string | null };
        Update: { full_name?: string | null };
        Relationships: [];
      };
      projects: {
        Row: Project;
        Insert: {
          name: string;
          website_url: string;
          description?: string | null;
        };
        Update: {
          name?: string;
          website_url?: string;
          description?: string | null;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
