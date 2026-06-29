package agent

import "testing"

func TestPermissionPolicyModes(t *testing.T) {
	policy := PermissionPolicy{}
	requests := []ToolRequest{
		{Name: ToolListDirectory, Risk: RiskRead},
		{Name: ToolApplyFilePlan, Risk: RiskWrite},
		{Name: "shell", Risk: RiskDangerous},
	}

	ask := policy.Apply(ModeAsk, cloneRequests(requests))
	if !ask[0].ApprovalRequired || !ask[1].ApprovalRequired || !ask[2].ApprovalRequired {
		t.Fatalf("ask mode should require all approvals: %#v", ask)
	}

	auto := policy.Apply(ModeAuto, cloneRequests(requests))
	if auto[0].ApprovalRequired || auto[1].ApprovalRequired || !auto[2].ApprovalRequired {
		t.Fatalf("auto mode approval mismatch: %#v", auto)
	}

	full := policy.Apply(ModeFull, cloneRequests(requests))
	if full[0].ApprovalRequired || full[1].ApprovalRequired || full[2].ApprovalRequired {
		t.Fatalf("full mode should not require approvals: %#v", full)
	}
}

func cloneRequests(requests []ToolRequest) []ToolRequest {
	return append([]ToolRequest(nil), requests...)
}
