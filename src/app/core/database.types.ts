// =============================================================
// EntrenoLab — Tipos de la base de datos (Supabase)
//
// ⚠️ FUENTE AUTORADA A MANO (no ejecutada con `supabase gen types`).
// Este archivo refleja EXACTAMENTE las columnas de las 7 migraciones aplicadas
// (docs/06-supabase-autoritativo.md + cambios en supabase/migrations). Cada
// tabla lleva `Relationships: []` (sin relaciones embebidas) y cada fila/insert/
// update se declara como ALIAS DE TIPO (no `interface`): TypeScript 6 exige
// que sean asignables a `Record<string, unknown>` para satisfacer la restricción
// genérica de `SupabaseClient<Database>`, y los `interface` NO tienen índice
// implícito mientras que los aliases de tipo literal sí.
//
// LAS RPC PÚBLICAS (superficie tipada de `rpc(...)`):
//   · public.save_session_with_tasks (nueva, migración 20260829000000).
//   · invite_team_member / accept_team_invitation / admin_set_profile_status /
//     is_platform_admin / revoke_team_member / cancel_team_invitation /
//     list_team_members / my_team_invitations / admin_list_profiles /
//     create_my_team (migraciones 00000..00005).
//   · decline_team_invitation (migración 20260910000000): rechazo de la invitación
//     POR EL INVITADO. Declarada aquí porque `rpc()` está tipado: sin esta entrada
//     el cliente no compila. Catálogo remoto comprobado (la función no existe todavía);
//     MIGRACIÓN AÚN NO APLICADA, así que el remoto no la sirve hasta que se aplique.
//
// Verificado contra el catálogo remoto de vgwfjkhvzprsoixpzruq el 2026-08-28.
// La generación oficial de tipos confirmó tablas, relaciones y las firmas de
// save_session_with_tasks e import_team_dataset; estos aliases conservan los
// nombres que consume la aplicación.
// =============================================================

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// ---------- Helpers genéricos ----------

/** Fila base con los campos comunes de auditoría. */
export interface BaseRow {
  created_at: string;
  updated_at: string;
}

// ---------- profiles ----------

export type ProfilesRow = {
  user_id: string;
  display_name: string;
  email_normalized: string;
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ProfilesInsert = {
  user_id: string;
  display_name?: string;
  email_normalized: string;
  status?: 'pending' | 'approved' | 'rejected' | 'suspended';
  approved_at?: string | null;
  approved_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ProfilesUpdate = {
  display_name?: string;
  email_normalized?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'suspended';
  approved_at?: string | null;
  approved_by?: string | null;
  updated_at?: string;
};

// ---------- teams ----------

export type TeamsRow = {
  id: string;
  owner_user_id: string;
  name: string;
  accent_color: string;
  created_at: string;
  updated_at: string;
};

export type TeamsInsert = {
  id?: string;
  owner_user_id: string;
  name: string;
  accent_color?: string;
  created_at?: string;
  updated_at?: string;
};

export type TeamsUpdate = {
  name?: string;
  accent_color?: string;
  updated_at?: string;
};

// ---------- team_members ----------

export type TeamMembersRow = {
  team_id: string;
  user_id: string;
  role: 'owner' | 'editor';
  status: 'pending_approval' | 'active' | 'revoked';
  invited_by: string | null;
  accepted_at: string | null;
  created_at: string;
};

export type TeamMembersInsert = {
  team_id: string;
  user_id: string;
  role?: 'owner' | 'editor';
  status?: 'pending_approval' | 'active' | 'revoked';
  invited_by?: string | null;
  accepted_at?: string | null;
  created_at?: string;
};

export type TeamMembersUpdate = {
  role?: 'owner' | 'editor';
  status?: 'pending_approval' | 'active' | 'revoked';
  invited_by?: string | null;
  accepted_at?: string | null;
};

// ---------- team_invitations ----------

export type TeamInvitationsRow = {
  id: string;
  team_id: string;
  email_normalized: string;
  invited_user_id: string | null;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invited_by: string | null;
  expires_at: string;
  created_at: string;
  // Estado del CORREO de invitación (migración 20260922000000). Es distinto de
  // `status`: `provider_accepted` significa que el proveedor ACEPTÓ el envío, no que
  // se haya entregado; `status = 'accepted'` significa que la persona la aceptó.
  email_status: 'created' | 'send_pending' | 'provider_accepted' | 'send_error';
  email_attempts: number;
  last_email_at: string | null;
  last_email_error: string | null;
  provider_message_id: string | null;
};

export type TeamInvitationsInsert = {
  id?: string;
  team_id: string;
  email_normalized: string;
  invited_user_id?: string | null;
  status?: 'pending' | 'accepted' | 'revoked' | 'expired';
  invited_by?: string | null;
  expires_at?: string;
  created_at?: string;
};

export type TeamInvitationsUpdate = {
  invited_user_id?: string | null;
  status?: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at?: string;
  email_status?: 'created' | 'send_pending' | 'provider_accepted' | 'send_error';
  email_attempts?: number;
  last_email_at?: string | null;
  last_email_error?: string | null;
  provider_message_id?: string | null;
};

// ---------- team_requests (solicitud de equipo) ----------

export type TeamRequestsRow = {
  id: string;
  user_id: string;
  name: string;
  accent_color: string;
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  created_team_id: string | null;
  requested_at: string;
  updated_at: string;
  decided_at: string | null;
  decided_by: string | null;
  revision: number;
};

/** El cliente NUNCA escribe esta tabla directamente (no tiene GRANT ni política de
 *  escritura): la inserta la RPC `request_team_creation`. El tipo existe para que el
 *  contrato quede completo y para el día en que haya una ruta de servidor que la use. */
export type TeamRequestsInsert = {
  id?: string;
  user_id: string;
  name: string;
  accent_color?: string;
  note?: string | null;
};

export type TeamRequestsUpdate = {
  name?: string;
  accent_color?: string;
  note?: string | null;
  revision?: number;
};

// ---------- account_deletions (auditoría de bajas de cuenta, migración 20260923000000) ----------

/** Registro de una baja de cuenta. NO tiene clave foránea al perfil a propósito: la fila
 *  sobrevive al borrado del usuario. Solo la lee un administrador de plataforma. */
export type AccountDeletionsRow = {
  id: string;
  deleted_user_id: string;
  email_normalized: string;
  display_name: string;
  status_before: string | null;
  reason: string | null;
  deleted_by: string | null;
  deleted_at: string;
};

// ---------- players ----------

export type PlayersRow = {
  id: string;
  team_id: string;
  name: string;
  number: number | null;
  position: string;
  color: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type PlayersInsert = {
  id?: string;
  team_id: string;
  name: string;
  number?: number | null;
  position?: string;
  color?: string;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type PlayersUpdate = {
  name?: string;
  number?: number | null;
  position?: string;
  color?: string;
  active?: boolean;
  updated_at?: string;
};

// ---------- exercise_folders ----------

export type ExerciseFoldersRow = {
  id: string;
  team_id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
};

export type ExerciseFoldersInsert = {
  id?: string;
  team_id: string;
  parent_id?: string | null;
  name: string;
  created_at?: string;
};

export type ExerciseFoldersUpdate = {
  parent_id?: string | null;
  name?: string;
};

// ---------- exercises ----------

export type ExercisesRow = {
  id: string;
  team_id: string;
  folder_id: string | null;
  title: string;
  description: string;
  explanation: string;
  category: string;
  objectives: string[];
  materials: string[];
  duration_minutes: number | null;
  min_players: number | null;
  max_players: number | null;
  load_mode: 'fixed' | 'interval';
  series_count: number | null;
  repetitions_count: number | null;
  work_seconds: number | null;
  rest_seconds: number | null;
  is_template: boolean;
  canvas_data: Json | null;
  thumbnail: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type ExercisesInsert = {
  id?: string;
  team_id: string;
  folder_id?: string | null;
  title: string;
  description?: string;
  explanation?: string;
  category?: string;
  objectives?: string[];
  materials?: string[];
  duration_minutes?: number | null;
  min_players?: number | null;
  max_players?: number | null;
  load_mode?: 'fixed' | 'interval';
  series_count?: number | null;
  repetitions_count?: number | null;
  work_seconds?: number | null;
  rest_seconds?: number | null;
  is_template?: boolean;
  canvas_data?: Json | null;
  thumbnail?: string | null;
  revision?: number;
  created_at?: string;
  updated_at?: string;
};

export type ExercisesUpdate = {
  folder_id?: string | null;
  title?: string;
  description?: string;
  explanation?: string;
  category?: string;
  objectives?: string[];
  materials?: string[];
  duration_minutes?: number | null;
  min_players?: number | null;
  max_players?: number | null;
  load_mode?: 'fixed' | 'interval';
  series_count?: number | null;
  repetitions_count?: number | null;
  work_seconds?: number | null;
  rest_seconds?: number | null;
  is_template?: boolean;
  canvas_data?: Json | null;
  thumbnail?: string | null;
  updated_at?: string;
};

// ---------- sessions ----------

export type SessionsRow = {
  id: string;
  team_id: string;
  title: string;
  date: string | null;
  duration_minutes: number | null;
  notes: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type SessionsInsert = {
  id?: string;
  team_id: string;
  title: string;
  date?: string | null;
  duration_minutes?: number | null;
  notes?: string;
  revision?: number;
  created_at?: string;
  updated_at?: string;
};

export type SessionsUpdate = {
  title?: string;
  date?: string | null;
  duration_minutes?: number | null;
  notes?: string;
  updated_at?: string;
};

// ---------- session_exercises ----------

export type SessionExercisesRow = {
  id: string;
  team_id: string;
  session_id: string;
  exercise_id: string | null;
  title: string;
  duration_minutes: number | null;
  material: string;
  sort_order: number;
  created_at: string;
};

export type SessionExercisesInsert = {
  id?: string;
  team_id: string;
  session_id: string;
  exercise_id?: string | null;
  title: string;
  duration_minutes?: number | null;
  material?: string;
  sort_order?: number;
  created_at?: string;
};

export type SessionExercisesUpdate = {
  exercise_id?: string | null;
  title?: string;
  duration_minutes?: number | null;
  material?: string;
  sort_order?: number;
};

// ---------- Database (objeto principal para el cliente tipado) ----------

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfilesRow;
        Insert: ProfilesInsert;
        Update: ProfilesUpdate;
        Relationships: [];
      };
      teams: {
        Row: TeamsRow;
        Insert: TeamsInsert;
        Update: TeamsUpdate;
        Relationships: [];
      };
      team_members: {
        Row: TeamMembersRow;
        Insert: TeamMembersInsert;
        Update: TeamMembersUpdate;
        Relationships: [];
      };
      team_invitations: {
        Row: TeamInvitationsRow;
        Insert: TeamInvitationsInsert;
        Update: TeamInvitationsUpdate;
        Relationships: [];
      };
      team_requests: {
        Row: TeamRequestsRow;
        Insert: TeamRequestsInsert;
        Update: TeamRequestsUpdate;
        Relationships: [];
      };
      account_deletions: {
        Row: AccountDeletionsRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      players: {
        Row: PlayersRow;
        Insert: PlayersInsert;
        Update: PlayersUpdate;
        Relationships: [];
      };
      exercise_folders: {
        Row: ExerciseFoldersRow;
        Insert: ExerciseFoldersInsert;
        Update: ExerciseFoldersUpdate;
        Relationships: [];
      };
      exercises: {
        Row: ExercisesRow;
        Insert: ExercisesInsert;
        Update: ExercisesUpdate;
        Relationships: [];
      };
      sessions: {
        Row: SessionsRow;
        Insert: SessionsInsert;
        Update: SessionsUpdate;
        Relationships: [];
      };
      session_exercises: {
        Row: SessionExercisesRow;
        Insert: SessionExercisesInsert;
        Update: SessionExercisesUpdate;
        Relationships: [];
      };
    };
    Views: {};
    Functions: {
      accept_team_invitation: { Args: { p_invitation_id: string }; Returns: string };
      admin_list_profiles: {
        Args: { p_search?: string };
        Returns: Array<{
          approved_at: string | null;
          display_name: string;
          email_normalized: string;
          status: string;
          user_id: string;
        }>;
      };
      admin_set_profile_status: {
        Args: { p_status: string; p_user_id: string };
        Returns: undefined;
      };
      admin_list_team_requests: {
        Args: { p_search?: string };
        Returns: Array<{
          accent_color: string;
          created_team_id: string | null;
          decided_at: string | null;
          decided_by: string | null;
          display_name: string;
          email_normalized: string;
          id: string;
          name: string;
          note: string | null;
          requested_at: string;
          status: string;
          user_id: string;
        }>;
      };
      admin_decide_team_request: {
        Args: { p_approve: boolean; p_note?: string | null; p_request_id: string };
        Returns: string;
      };
      request_team_creation: {
        Args: { p_accent_color?: string; p_name: string };
        Returns: string;
      };
      // Gestión de cuentas y pertenencia (migración 20260923000000).
      admin_deletion_preview: { Args: { p_user_id: string }; Returns: Json };
      admin_delete_account: {
        Args: { p_reason?: string | null; p_user_id: string };
        Returns: Json;
      };
      leave_team: { Args: { p_team_id: string }; Returns: undefined };
      transfer_team_ownership: {
        Args: { p_new_owner_user_id: string; p_team_id: string };
        Returns: undefined;
      };
      prepare_invitation_email: {
        Args: { p_invitation_id: string };
        Returns: Json;
      };
      record_invitation_email_result: {
        Args: {
          p_error?: string | null;
          p_invitation_id: string;
          p_provider_message_id?: string | null;
          p_status: string;
        };
        Returns: undefined;
      };
      cancel_team_invitation: { Args: { p_invitation_id: string }; Returns: undefined };
      // Se conserva el tipo aunque la aplicación YA NO la llame: existe en la base y
      // ahora responde `team_creation_requires_approval` a quien no es administrador.
      create_my_team: { Args: { p_accent_color?: string; p_name: string }; Returns: string };
      decline_team_invitation: { Args: { p_invitation_id: string }; Returns: undefined };
      delete_folder_tree: { Args: { p_folder_id: string }; Returns: undefined };
      duplicate_folder_tree: { Args: { p_folder_id: string }; Returns: string };
      import_team_dataset: { Args: { p_payload: Json; p_team_id: string }; Returns: Json };
      invite_team_member: { Args: { p_email: string; p_team_id: string }; Returns: string };
      is_platform_admin: { Args: never; Returns: boolean };
      list_team_members: {
        Args: { p_team_id: string };
        Returns: Array<{
          accepted_at: string | null;
          display_name: string;
          email_normalized: string;
          invited_by: string | null;
          role: string;
          status: string;
          user_id: string;
        }>;
      };
      my_team_invitations: {
        Args: never;
        Returns: Array<{
          created_at: string;
          email_normalized: string;
          expires_at: string;
          id: string;
          status: string;
          team_id: string;
          team_name: string;
        }>;
      };
      revoke_team_member: { Args: { p_team_id: string; p_user_id: string }; Returns: undefined };
      save_session_with_tasks: {
        Args: { p_revision: number | null; p_session: Json; p_tasks?: Json };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
  };
}
