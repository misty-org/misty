-- +goose Up
CREATE TABLE space_personal_item_state (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id text NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  item_key text NOT NULL CHECK (length(item_key) BETWEEN 3 AND 160),
  favorite boolean NOT NULL DEFAULT false,
  opened_at timestamptz,
  PRIMARY KEY (user_id, space_id, item_key)
);
ALTER TABLE space_personal_item_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_personal_item_state FORCE ROW LEVEL SECURITY;
CREATE POLICY space_personal_item_state_owner ON space_personal_item_state
  USING (misty_rls_is_service() OR (user_id = misty_rls_user_id() AND misty_is_space_member(space_id)))
  WITH CHECK (misty_rls_is_service() OR (user_id = misty_rls_user_id() AND misty_is_space_member(space_id)));
GRANT SELECT, INSERT, UPDATE, DELETE ON space_personal_item_state TO misty_app;

CREATE TRIGGER space_personal_item_account_notify AFTER INSERT OR UPDATE OR DELETE ON space_personal_item_state
FOR EACH ROW EXECUTE FUNCTION misty_notify_account_change('space-personal-items','user_id');

-- +goose Down
DROP TABLE space_personal_item_state;
