export interface SpaceConversationMember {
  user_id: string;
  name: string;
  email: string;
  joined_at: string;
}

export interface SpaceConversation {
  id: string;
  space_id: string;
  title: string;
  created_by_user_id: string;
  members: SpaceConversationMember[];
  created_at: string;
  updated_at: string;
}
