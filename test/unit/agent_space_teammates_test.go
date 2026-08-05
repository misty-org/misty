package unit

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"strings"
	"testing"

	serveragent "github.com/kannachi323/misty/server/internal/agents"
	"github.com/kannachi323/misty/server/internal/agenttools"
	api "github.com/kannachi323/misty/server/internal/platform/httpapi"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

func TestValidateSpaceTaskAgentAssignmentAndTypedSources(t *testing.T) {
	valid := db.SpaceTask{
		Title: "Review brief", Status: "todo", Priority: "medium", DueTimezone: "UTC",
		AssigneeAgentID: "agent-a",
		SourceRefs:      json.RawMessage(`[{"kind":"library_item","resource_id":"item-a"},{"kind":"task_attachment","resource_id":"attachment-a"}]`),
	}
	if err := db.TestingValidateSpaceTask(&valid); err != nil {
		t.Fatalf("expected valid Agent task: %v", err)
	}
	both := valid
	both.AssigneeUserID = "user-a"
	if err := db.TestingValidateSpaceTask(&both); !errors.Is(err, db.ErrSpaceInvalid) {
		t.Fatalf("expected mixed assignee types to fail, got %v", err)
	}
	invalidRef := valid
	invalidRef.SourceRefs = json.RawMessage(`[{"kind":"note","resource_id":"note-a"}]`)
	if err := db.TestingValidateSpaceTask(&invalidRef); !errors.Is(err, db.ErrSpaceInvalid) {
		t.Fatalf("expected unsupported source ref to fail, got %v", err)
	}
}

func TestNormalizeAgentSpacePermissionsFailsClosed(t *testing.T) {
	permissions, err := db.TestingNormalizeAgentSpacePermissions(json.RawMessage(`{"messages.read":false,"messages.write":true,"tasks.view":false,"tasks.manage":true,"attached_files.read":true}`))
	if err != nil {
		t.Fatal(err)
	}
	var values map[string]bool
	if err := json.Unmarshal(permissions, &values); err != nil {
		t.Fatal(err)
	}
	if values[db.PermissionMessagesWrite] || values[db.PermissionTasksManage] {
		t.Fatalf("child permissions must be disabled with their read parents: %s", permissions)
	}
	if _, err := db.TestingNormalizeAgentSpacePermissions(json.RawMessage(`{"library.view":true}`)); !errors.Is(err, db.ErrSpaceInvalid) {
		t.Fatalf("expected broad Library permission to be rejected, got %v", err)
	}
}

func TestCompileAgentIntentOnlyGrantsExplicitTaskWrites(t *testing.T) {
	tests := []struct {
		prompt string
		want   []string
	}{
		{"What tasks are due?", []string{"tasks.query"}},
		{"Create a task called Review brief", []string{"tasks.query", "tasks.create"}},
		{"Can you create a task called Review brief?", []string{"tasks.query", "tasks.create"}},
		{"Can you help me create tasks inside this Space?", []string{"tasks.query"}},
		{"Update Task MST-42 to done", []string{"tasks.query", "tasks.update"}},
		{"Rename this Space to Launch Operations", []string{"tasks.query", "spaces.rename"}},
		{"Can you rename Spaces?", []string{"tasks.query"}},
		{"Do not rename this Space to Launch Operations", []string{"tasks.query"}},
		{"Ask the Agent to summarize the launch risks", []string{"tasks.query", "agents.delegate"}},
		{"Ask Researcher to summarize the launch risks", []string{"tasks.query", "agents.delegate"}},
		{"Delegate this launch summary to Researcher", []string{"tasks.query", "agents.delegate"}},
		{"Can you delegate work to Agents?", []string{"tasks.query"}},
		{"Do not delegate this to the Agent", []string{"tasks.query"}},
		{"Create a note", []string{"tasks.query"}},
		{"Recreate the summary of this task", []string{"tasks.query"}},
		{"Do not create a task", []string{"tasks.query"}},
	}
	for _, test := range tests {
		if got := api.TestingCompileAgentIntent(test.prompt); !reflect.DeepEqual(got, test.want) {
			t.Fatalf("%q: got %v, want %v", test.prompt, got, test.want)
		}
	}
}

func TestPrivateSpaceConversationReceivesServerOwnedTaskTools(t *testing.T) {
	got := api.TestingSpaceConversationToolNames("Can you help me create tasks inside this Space?")
	want := []string{"messages.search", "library.search", "tasks.query"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Space conversation tools = %v, want %v", got, want)
	}

	got = api.TestingSpaceConversationToolNames("What can you tell me about our tasks?")
	want = []string{"messages.search", "library.search", "tasks.query"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("read-only Space conversation tools = %v, want %v", got, want)
	}
}

func TestMistyAgentPersonaExplainsTheAppAndDoesNotDefaultToFiles(t *testing.T) {
	persona := serveragent.TestingAgentPersona()
	for _, want := range []string{"collaborative workspace app", "Planner tasks", "Library", "membership and roles", "Agent lobby", "Do not describe yourself as primarily a file organizer"} {
		if !strings.Contains(persona, want) {
			t.Fatalf("Misty Agent product context is missing %q:\n%s", want, persona)
		}
	}
}

func TestPersonalSpaceAgentPromptCarriesMembersContextAndConfiguredActions(t *testing.T) {
	policy := json.RawMessage(`{"grants":[{"capability":"tasks.query","risk":"read"},{"capability":"tasks.create","risk":"write"}]}`)
	manifest := serveragent.ToolManifest{Tools: []serveragent.ToolDefinition{{Name: "tasks.query", Description: "Query Tasks"}}}
	prompt := api.TestingBuildPersonalSpaceAgentPrompt(&db.SpaceAgentMembership{
		Name: "Launch Agent", Instructions: "Be concise.", SpaceInstructions: "Prefer launch work.",
	}, policy, manifest, "Space: Launch\n\nMembers: Alex, Sam\n\nLibrary:\n- Brief.pdf", "Earlier decision", "Who is here and can you create tasks?")
	for _, want := range []string{"Members: Alex, Sam", "Brief.pdf", "tasks.create", "Internal execution candidates for this specific request", "Do not describe the Agent as chat-only", "Earlier decision", "Who is here"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("personal Space prompt is missing %q:\n%s", want, prompt)
		}
	}
}

func TestGlobalAgentIntentExposesCrossSpaceTaskActionsOnlyForConcreteWrites(t *testing.T) {
	capabilityQuestion := api.TestingCompileGlobalAgentIntent("Can you help me create tasks inside Design Space?")
	if !slices.Contains(capabilityQuestion, "spaces.list_accessible") || !slices.Contains(capabilityQuestion, "tasks.query") || slices.Contains(capabilityQuestion, "tasks.create") {
		t.Fatalf("capability question actions = %v", capabilityQuestion)
	}
	concrete := api.TestingCompileGlobalAgentIntent("Create a task called Review brief inside Design Space")
	if !slices.Contains(concrete, "tasks.create") {
		t.Fatalf("concrete cross-Space Task action missing: %v", concrete)
	}
	for _, descriptor := range api.TestingPersonalAgentToolboxDescriptors() {
		if descriptor.Name != "tasks.query" {
			continue
		}
		var schema struct {
			Required []string `json:"required"`
		}
		if json.Unmarshal(descriptor.InputSchema, &schema) != nil || !slices.Contains(schema.Required, "space_id") {
			t.Fatalf("global tasks.query must require an explicit Space target: %s", descriptor.InputSchema)
		}
		return
	}
	t.Fatal("personal Agent Toolbox is missing tasks.query")
}

func TestGlobalPersonalAgentPromptNamesAccessibleSpacesAndMistySurfaces(t *testing.T) {
	personal := &db.PersonalAgent{
		Name: "Operator", Instructions: "Help run launches.",
		ToolPermissions: json.RawMessage(`{"grants":[{"capability":"spaces.list_accessible","risk":"read"},{"capability":"tasks.create","risk":"write"}]}`),
	}
	manifest := serveragent.ToolManifest{Tools: []serveragent.ToolDefinition{{Name: "spaces.list_accessible", Description: "List or inspect Spaces"}}}
	prompt := api.TestingBuildGlobalPersonalAgentPrompt(personal, manifest, []db.PersonalAgentAccessibleSpace{{ID: "space-design", Name: "Design Space", CanSend: true}}, "Member: We are launching Tuesday.\nAgent: I will remember that.", "When are we launching?")
	for _, want := range []string{"account-level Misty Agent chat", "Planner Tasks", "Library", "Members", "Design Space", "tasks.create", "inspect that Space", "We are launching Tuesday", "When are we launching?"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("global Agent prompt is missing %q:\n%s", want, prompt)
		}
	}
}

func TestDelegatedAgentConversationHistoryIsChronologicalAndRoleLabelled(t *testing.T) {
	history := api.TestingRenderRecentAgentConversation([]serveragent.Message{
		{Role: serveragent.RoleUser, Content: "The launch is Tuesday."},
		{Role: serveragent.RoleAgent, Content: "I understand."},
		{Role: serveragent.RoleUser, Content: "What day is it?"},
	})
	want := "Member: The launch is Tuesday.\nAgent: I understand.\nMember: What day is it?"
	if history != want {
		t.Fatalf("conversation history = %q, want %q", history, want)
	}
}

func TestPrivateSpaceToolboxRegistrationsAreCompleteAndGuardWrites(t *testing.T) {
	descriptors := api.TestingSpaceAgentToolboxDescriptors()
	names := make([]string, 0, len(descriptors))
	for _, descriptor := range descriptors {
		names = append(names, descriptor.Name)
		if descriptor.Version < 1 || descriptor.Description == "" || descriptor.Locality == "" {
			t.Fatalf("incomplete descriptor: %#v", descriptor)
		}
		if descriptor.Risk != "read" && (descriptor.Approval == "none" || descriptor.AuditEvent == "") {
			t.Fatalf("write tool lacks approval or audit policy: %#v", descriptor)
		}
	}
	want := []string{"messages.search", "messages.send", "library.search", "tasks.query", "tasks.create", "tasks.update", "agents.delegate", "spaces.rename"}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("Toolbox tools = %v, want %v", names, want)
	}
}

func TestCanonicalAndProviderActionsUseToolboxDescriptors(t *testing.T) {
	descriptors := api.TestingCanonicalAgentToolboxDescriptors("slack", "notion", "google")
	names := make([]string, 0, len(descriptors))
	for _, descriptor := range descriptors {
		names = append(names, descriptor.Name)
		if descriptor.Description == "" || descriptor.Version < 1 {
			t.Fatalf("incomplete canonical descriptor: %#v", descriptor)
		}
		if descriptor.Name == "messages.send" || descriptor.Name == "tasks.create" || descriptor.Name == "tasks.update" {
			if descriptor.ApprovalBySource["canonical_run"] != "interactive" || descriptor.AuditEvent == "" {
				t.Fatalf("canonical Task write lost durable approval metadata: %#v", descriptor)
			}
		}
		if descriptor.Name == "provider.slack.write" && (descriptor.Approval != "interactive" || descriptor.Locality != "provider" || descriptor.AuditEvent == "") {
			t.Fatalf("provider write policy = %#v", descriptor)
		}
	}
	want := []string{
		"messages.search", "messages.send", "library.search", "tasks.query", "calendar.query", "tasks.create", "tasks.update",
		"provider.slack.query", "provider.slack.write", "provider.notion.query", "provider.google.query",
	}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("canonical Toolbox tools = %v, want %v", names, want)
	}
}

func TestPersonalAgentToolPolicyEnforcesReadAndWriteSeparately(t *testing.T) {
	policy := json.RawMessage(`{"read":true,"write":false,"integrations":[]}`)
	if !api.TestingPersonalAgentToolPolicyAllows(policy, "read") {
		t.Fatal("read policy should allow read tools")
	}
	if api.TestingPersonalAgentToolPolicyAllows(policy, "write") {
		t.Fatal("write policy must deny write tools")
	}
	if api.TestingPersonalAgentToolPolicyAllows(json.RawMessage(`{}`), "read") {
		t.Fatal("missing policy fields must fail closed")
	}
	if api.TestingPersonalAgentToolPolicyAllows(json.RawMessage(`{"read":false,"write":true}`), "write") {
		t.Fatal("write access must not bypass a revoked parent read grant")
	}
}

func TestPersonalAgentToolPolicyUsesExactRiskBoundGrantsWhenPresent(t *testing.T) {
	policy := json.RawMessage(`{"read":true,"write":true,"grants":[{"capability":"tasks.query","risk":"read"}]}`)
	if !api.TestingPersonalAgentCapabilityAllowed(policy, "tasks.query", "read") {
		t.Fatal("exact Task query grant was denied")
	}
	if api.TestingPersonalAgentCapabilityAllowed(policy, "tasks.query", "write") {
		t.Fatal("a read grant must not authorize the same capability at write risk")
	}
	if api.TestingPersonalAgentCapabilityAllowed(policy, "tasks.update", "write") {
		t.Fatal("legacy write=true must not bypass a present exact grant list")
	}
	if api.TestingPersonalAgentCapabilityAllowed(json.RawMessage(`{"read":true,"write":true,"grants":[]}`), "tasks.query", "read") {
		t.Fatal("an explicit empty grant list must fail closed")
	}
}

func TestProductionAgentToolboxDescriptorsDeclareSchemasAndWriteAudits(t *testing.T) {
	descriptors := append([]agenttools.Descriptor{}, api.TestingSpaceAgentToolboxDescriptors()...)
	descriptors = append(descriptors, api.TestingCanonicalAgentToolboxDescriptors("discord", "google", "notion", "slack")...)
	descriptors = append(descriptors, api.TestingDeviceAgentToolboxDescriptors()...)
	descriptors = append(descriptors, api.TestingPersonalAgentToolboxDescriptors()...)
	for _, descriptor := range descriptors {
		if len(descriptor.InputSchema) == 0 || len(descriptor.OutputSchema) == 0 {
			t.Errorf("%s is missing a declared input or output schema", descriptor.Name)
		}
		if descriptor.Risk != "read" && descriptor.AuditEvent == "" {
			t.Errorf("%s is a write without an audit event", descriptor.Name)
		}
	}
}

func TestAgentInstanceCapabilityGrantsAreExactAndRiskBound(t *testing.T) {
	raw, err := db.TestingNormalizeAgentCapabilityGrants(json.RawMessage(`[
		{"capability":"tasks.update","risk":"write"},
		{"capability":"tasks.query","risk":"read"}
	]`))
	if err != nil {
		t.Fatal(err)
	}
	if !db.AgentCapabilityGranted(raw, "tasks.update", "write") || !db.AgentCapabilityGranted(raw, "tasks.query", "read") {
		t.Fatalf("expected exact grants in %s", raw)
	}
	if db.AgentCapabilityGranted(raw, "tasks.update", "read") || db.AgentCapabilityGranted(raw, "tasks.create", "write") {
		t.Fatal("a grant must not change risk or authorize a sibling action")
	}
	if _, err := db.TestingNormalizeAgentCapabilityGrants(json.RawMessage(`[{"capability":"tasks.query","risk":"read"},{"capability":"tasks.query","risk":"read"}]`)); !errors.Is(err, db.ErrSpaceInvalid) {
		t.Fatalf("duplicate capability error = %v", err)
	}
}

func TestDeviceActionsAreDeclaredInTheAgentToolbox(t *testing.T) {
	descriptors := api.TestingDeviceAgentToolboxDescriptors()
	names := make([]string, 0, len(descriptors))
	for _, descriptor := range descriptors {
		names = append(names, descriptor.Name)
		if descriptor.Locality != "device" || descriptor.Description == "" || descriptor.InputSchema == nil {
			t.Fatalf("incomplete device descriptor: %#v", descriptor)
		}
		if descriptor.Name == "apply_file_plan" && (descriptor.Approval != "interactive" || descriptor.AuditEvent == "") {
			t.Fatalf("file-plan write policy = %#v", descriptor)
		}
	}
	want := []string{"list_directory", "search_files", "preview_file", "validate_file_plan", "apply_file_plan"}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("device Toolbox tools = %v, want %v", names, want)
	}
}

func TestDeviceManifestIsDerivedFromServerScope(t *testing.T) {
	t.Setenv("MISTY_AGENT_DOCUMENTS_ENABLED", "false")
	tests := []struct {
		scope string
		want  []string
	}{
		{"", []string{}},
		{"files", []string{"list_directory", "validate_file_plan", "apply_file_plan"}},
		{"cleanup", []string{"list_directory", "search_files", "validate_file_plan"}},
		{"search", []string{"list_directory", "search_files"}},
	}
	for _, test := range tests {
		root := "scope_device_123"
		if test.scope == "" {
			root = ""
		}
		got, err := api.TestingDeviceAgentToolNames(context.Background(), test.scope, root)
		if err != nil || !reflect.DeepEqual(got, test.want) {
			t.Fatalf("scope %q tools = %v, %v; want %v", test.scope, got, err, test.want)
		}
	}
	if _, err := api.TestingDeviceAgentToolNames(context.Background(), "files", ""); err == nil {
		t.Fatal("device tools without an opaque active scope must fail")
	}
	if _, err := api.TestingDeviceAgentToolNames(context.Background(), "admin", "scope_device_123"); err == nil {
		t.Fatal("unknown device tool scope must fail")
	}
}

func TestCompileGlobalAgentIntentUnderstandsNaturalMessageRequests(t *testing.T) {
	tests := []struct {
		prompt  string
		canSend bool
	}{
		{"check which Spaces you can access again", false},
		{"Text the launch is today in Design Space", true},
		{"Tell Design Space that the launch is today", true},
		{"Can you post launch is today in Design Space?", true},
		{"Let Design Space know the launch is today", true},
		{"How do I send a message to a Space?", false},
		{"Do not post anything in Design Space", false},
	}
	for _, test := range tests {
		got := api.TestingCompileGlobalAgentIntent(test.prompt)
		canSend := slices.Contains(got, "messages.send")
		if got[0] != "spaces.list_accessible" || canSend != test.canSend {
			t.Fatalf("%q: got %v, canSend=%v", test.prompt, got, canSend)
		}
	}
}

func TestCompileSpaceAgentIntentExposesOnlyGroundedMessageWrites(t *testing.T) {
	tests := []struct {
		prompt  string
		canSend bool
	}{
		{"Tell everyone Stone is off for today", true},
		{"yooo can you let stone know im sick today", true},
		{"Post launch is today in this Space", true},
		{"Can you chat in this Space?", false},
		{"How do I send a message?", false},
		{"Do not post anything", false},
	}
	for _, test := range tests {
		got := api.TestingCompileAgentIntent(test.prompt)
		if canSend := slices.Contains(got, "messages.send"); canSend != test.canSend {
			t.Fatalf("%q: actions=%v, canSend=%v", test.prompt, got, canSend)
		}
	}
	if !api.TestingSpaceAgentSendIsGrounded(
		"Tell everyone Stone is off for today", "Stone is off for today",
	) {
		t.Fatal("exact member-provided message should be grounded")
	}
	if api.TestingSpaceAgentSendIsGrounded(
		"Tell everyone Stone is off for today", "Stone will be back tomorrow",
	) {
		t.Fatal("an invented message must not be grounded")
	}
}

func TestLegacyFilesBoundaryCannotDisableSpaceAgentToolbox(t *testing.T) {
	prompt := "yooo can you let stone know im sick today"
	legacy := prompt + "\n\nPermission boundary: No capability scope is active. Respond conversationally without using tools or modifying data."
	stripped := api.TestingStripLegacyClientAgentPermissionBoundary(legacy)
	if stripped != prompt {
		t.Fatalf("stripped prompt = %q, want %q", stripped, prompt)
	}
	if got := api.TestingCompileAgentIntent(stripped); !slices.Contains(got, "messages.send") {
		t.Fatalf("send intent missing after legacy boundary stripping: %v", got)
	}
}

func TestSpaceActionPlanningTurnCannotExecuteWrites(t *testing.T) {
	got := api.TestingSpaceConversationPlanningToolNames("Tell everyone Stone is off for today")
	if slices.Contains(got, "messages.send") || slices.Contains(got, "tasks.create") || slices.Contains(got, "tasks.update") {
		t.Fatalf("planning turn exposed write actions: %v", got)
	}
	if !slices.Contains(got, "messages.search") || !slices.Contains(got, "library.search") {
		t.Fatalf("planning turn lost safe context actions: %v", got)
	}
}

func TestGlobalAgentSendMustBeGroundedInOriginalRequest(t *testing.T) {
	prompt := `Tell Design Space that the launch is today.`
	if !api.TestingGlobalAgentSendIsGrounded(prompt, "space-design", "Design Space", "the launch is today") {
		t.Fatal("expected naturally phrased exact message to be grounded")
	}
	if api.TestingGlobalAgentSendIsGrounded(prompt, "space-sales", "Sales Space", "the launch is today") {
		t.Fatal("model must not redirect a message to an unmentioned Space")
	}
	if api.TestingGlobalAgentSendIsGrounded(prompt, "space-design", "Design Space", "the launch is delayed") {
		t.Fatal("model must not invent or paraphrase message content")
	}
	if api.TestingGlobalAgentSendIsGrounded(prompt, "space-a", "A", "the launch is today") {
		t.Fatal("a short Space name must match a whole phrase, not a letter in the request")
	}
}

func TestExtractDOCXTextIsDeterministic(t *testing.T) {
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	part, err := archive.Create("word/document.xml")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte(`<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:tab/><w:t>Agent</w:t></w:r></w:p><w:p><w:r><w:t>Context</w:t></w:r></w:p></w:body></w:document>`)); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	text, err := api.TestingExtractDOCXText(buffer.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if text != "HelloAgent\nContext" {
		t.Fatalf("unexpected extraction: %q", text)
	}
}
