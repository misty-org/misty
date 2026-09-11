export interface SpaceIntegration {
  id: string;
  space_id: string;
  provider: string;
  display_name: string;
  credential_reference?: string;
  granted_permissions: string[];
  status: string;
  connected_by_user_id: string;
  created_at: string;
  updated_at: string;
}
export interface ProviderConnectionAvailability {
  provider: string;
  configured: boolean;
}
