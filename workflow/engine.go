package workflow

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
)

var (
	ErrDeviceUnavailable  = errors.New("device_unavailable")
	ErrOutputInvalid      = errors.New("node_output_invalid")
	ErrUnsupportedContent = errors.New("unsupported_content_type")
	ErrAwaitingApproval   = errors.New("awaiting_approval")
	errBranchNotSelected  = errors.New("workflow_branch_not_selected")
)

type StepState string

const (
	StepRunning             StepState = "running"
	StepCooldown            StepState = "cooldown"
	StepCompleted           StepState = "completed"
	StepCompletedWithErrors StepState = "completed_with_errors"
	StepAwaitingApproval    StepState = "awaiting_approval"
	StepFailed              StepState = "failed"
)

type StepEvent struct {
	NodeID  string
	State   StepState
	Attempt int
	Input   json.RawMessage
	Output  json.RawMessage
	Error   error
}

type ExecutionRequest struct {
	RunID   string
	UserID  string
	SpaceID string
	Input   json.RawMessage
	// NodePrefix namespaces checkpoint and idempotency identities for bounded
	// child graphs without changing their published node IDs.
	NodePrefix string
	// Completed contains durable, schema-validated node outputs keyed by the
	// fully-prefixed checkpoint node id. Resumed coordinators skip these nodes.
	Completed map[string]json.RawMessage
}

type ExecutionResult struct {
	State   RunState
	Outputs map[string]json.RawMessage
	Errors  map[string]string
}

// Engine executes a validated acyclic workflow. Cooldown is delegated to the
// durable coordinator, which may persist the event and wait, or wake early
// after provider/device health is restored.
type Engine struct {
	Registry       *Registry
	Resolver       DependencyResolver
	Checkpoint     func(context.Context, StepEvent) error
	Cooldown       func(context.Context, StepEvent, int) error
	ItemCheckpoint func(context.Context, string, json.RawMessage, ExecutionResult, error) error
}

func (engine Engine) Execute(ctx context.Context, definition Definition, request ExecutionRequest) (ExecutionResult, error) {
	if err := Validate(definition, engine.Registry, engine.Resolver); err != nil {
		return ExecutionResult{State: RunFailed}, err
	}
	order := topologicalOrder(definition)
	outputs := map[string]json.RawMessage{}
	failures := map[string]string{}
	partials := map[string]bool{}
	skipped := map[string]bool{}
	for _, node := range order {
		executionNodeID := request.NodePrefix + node.ID
		if checkpointed, ok := request.Completed[executionNodeID]; ok {
			descriptor, registered := engine.Registry.Resolve(node.Kind, node.KindVersion)
			if !registered || validateOutput(descriptor.OutputSchema, checkpointed) != nil || validateOutput(node.OutputSchema, checkpointed) != nil {
				return ExecutionResult{State: RunFailed, Outputs: outputs, Errors: failures}, ErrOutputInvalid
			}
			outputs[node.ID] = checkpointed
			continue
		}
		input, err := resolveNodeInput(definition, node, request.Input, outputs, partials, skipped)
		if err != nil {
			if errors.Is(err, errBranchNotSelected) {
				skipped[node.ID] = true
				continue
			}
			failures[node.ID] = err.Error()
			if node.Errors.Mode != "continue" && node.Errors.Mode != "collect" {
				return ExecutionResult{State: RunFailed, Outputs: outputs, Errors: failures}, err
			}
			continue
		}
		descriptor, ok := engine.Registry.Resolve(node.Kind, node.KindVersion)
		if !ok {
			return ExecutionResult{State: RunFailed, Outputs: outputs, Errors: failures}, ErrProviderMissing
		}
		maxAttempts := node.Retry.MaxAttempts
		if maxAttempts == 0 {
			maxAttempts = 3
		}
		var output json.RawMessage
		completedAttempt := 0
		nodePartial := false
		for attempt := 1; attempt <= maxAttempts; attempt++ {
			output = nil
			if ctx.Err() != nil {
				_ = descriptor.Cancel(context.Background(), Invocation{RunID: request.RunID, NodeID: node.ID, Attempt: attempt, UserID: request.UserID, SpaceID: request.SpaceID})
				return ExecutionResult{State: RunCanceled, Outputs: outputs, Errors: failures}, ctx.Err()
			}
			event := StepEvent{NodeID: executionNodeID, State: StepRunning, Attempt: attempt, Input: input}
			if err := engine.checkpoint(ctx, event); err != nil {
				return ExecutionResult{State: RunFailed, Outputs: outputs, Errors: failures}, err
			}
			invocation := Invocation{RunID: request.RunID, NodeID: executionNodeID, Attempt: attempt, IdempotencyKey: idempotencyKey(request.RunID, executionNodeID), UserID: request.UserID, SpaceID: request.SpaceID, Config: node.Config, Input: input}
			err = validateOutput(descriptor.InputSchema, input)
			if err == nil {
				err = descriptor.HealthCheck(ctx)
			}
			if err == nil && descriptor.Risk != RiskRead && attempt > 1 && descriptor.SupportsReconcile && descriptor.Reconcile != nil {
				var reconciled bool
				output, reconciled, err = descriptor.Reconcile(ctx, invocation)
				if err == nil && reconciled {
					err = validateOutput(descriptor.OutputSchema, output)
					if err == nil {
						err = validateOutput(node.OutputSchema, output)
					}
					if err == nil {
						break
					}
				}
			}
			if err == nil && output == nil {
				switch node.Kind {
				case "call_workflow":
					output, err = engine.executeCallWorkflow(ctx, request, invocation)
				case "for_each":
					output, nodePartial, err = engine.executeForEach(ctx, request, invocation)
				default:
					output, err = descriptor.Execute(ctx, invocation)
				}
			}
			if err == nil {
				err = validateOutput(descriptor.OutputSchema, output)
				if err == nil {
					err = validateOutput(node.OutputSchema, output)
				}
			}
			if err == nil {
				completedAttempt = attempt
				break
			}
			if errors.Is(err, ErrAwaitingApproval) {
				_ = engine.checkpoint(ctx, StepEvent{NodeID: executionNodeID, State: StepAwaitingApproval, Attempt: attempt, Input: input, Error: err})
				return ExecutionResult{State: RunAwaitingApproval, Outputs: outputs, Errors: failures}, err
			}
			if attempt < maxAttempts {
				cooldown := StepEvent{NodeID: executionNodeID, State: StepCooldown, Attempt: attempt, Input: input, Error: err}
				if checkpointErr := engine.checkpoint(ctx, cooldown); checkpointErr != nil {
					return ExecutionResult{State: RunFailed, Outputs: outputs, Errors: failures}, checkpointErr
				}
				if engine.Cooldown != nil {
					if cooldownErr := engine.Cooldown(ctx, cooldown, node.Retry.CooldownSeconds); cooldownErr != nil {
						return ExecutionResult{State: RunFailed, Outputs: outputs, Errors: failures}, cooldownErr
					}
				}
			}
		}
		if err != nil {
			failures[node.ID] = err.Error()
			_ = engine.checkpoint(ctx, StepEvent{NodeID: executionNodeID, State: StepFailed, Attempt: maxAttempts, Input: input, Error: err})
			if node.Errors.Mode != "continue" && node.Errors.Mode != "collect" {
				return ExecutionResult{State: RunFailed, Outputs: outputs, Errors: failures}, err
			}
			continue
		}
		outputs[node.ID] = output
		stepState := StepCompleted
		if nodePartial {
			partials[node.ID] = true
			failures[node.ID] = "one or more items failed"
			stepState = StepCompletedWithErrors
		}
		if err := engine.checkpoint(ctx, StepEvent{NodeID: executionNodeID, State: stepState, Attempt: completedAttempt, Input: input, Output: output}); err != nil {
			return ExecutionResult{State: RunFailed, Outputs: outputs, Errors: failures}, err
		}
	}
	state := RunCompleted
	if len(failures) > 0 {
		state = RunCompletedWithErrors
	}
	return ExecutionResult{State: state, Outputs: outputs, Errors: failures}, nil
}

type forEachConfig struct {
	WorkflowVersionID string      `json:"workflowVersionId"`
	ChildGraph        *Definition `json:"childGraph"`
	Concurrency       int         `json:"concurrency"`
	MaximumItems      int         `json:"maximumItems"`
	Sequential        bool        `json:"sequential"`
	ErrorMode         string      `json:"errorMode"`
}

func (engine Engine) executeCallWorkflow(ctx context.Context, parent ExecutionRequest, invocation Invocation) (json.RawMessage, error) {
	var config struct {
		WorkflowVersionID string `json:"workflowVersionId"`
	}
	if json.Unmarshal(invocation.Config, &config) != nil || config.WorkflowVersionID == "" || engine.Resolver == nil {
		return nil, ErrInvalidDefinition
	}
	_, _, child, ok := engine.Resolver.ResolveWorkflowVersion(config.WorkflowVersionID)
	if !ok {
		return nil, ErrInvalidDefinition
	}
	result, err := engine.Execute(ctx, child, ExecutionRequest{RunID: parent.RunID, UserID: parent.UserID, SpaceID: parent.SpaceID, Input: invocation.Input, NodePrefix: invocation.NodeID + ".", Completed: parent.Completed})
	if err != nil {
		return nil, err
	}
	return marshalExecutionResult(result), nil
}

func (engine Engine) executeForEach(ctx context.Context, parent ExecutionRequest, invocation Invocation) (json.RawMessage, bool, error) {
	var config forEachConfig
	if json.Unmarshal(invocation.Config, &config) != nil {
		return nil, false, ErrInvalidDefinition
	}
	child, err := engine.childDefinition(config)
	if err != nil {
		return nil, false, err
	}
	items, err := workflowItems(invocation.Input)
	if err != nil {
		return nil, false, err
	}
	if config.MaximumItems == 0 {
		config.MaximumItems = 1000
	}
	if config.MaximumItems < 1 || config.MaximumItems > 10000 || len(items) > config.MaximumItems {
		return nil, false, ErrInvalidDefinition
	}
	if config.Sequential {
		config.Concurrency = 1
	}
	if config.Concurrency == 0 {
		config.Concurrency = 4
	}
	if config.Concurrency < 1 || config.Concurrency > 32 {
		return nil, false, ErrInvalidDefinition
	}
	if config.ErrorMode == "" {
		config.ErrorMode = "collect"
	}
	if config.ErrorMode != "collect" && config.ErrorMode != "continue" && config.ErrorMode != "fail_fast" {
		return nil, false, ErrInvalidDefinition
	}
	type itemResult struct {
		Index   int                        `json:"index"`
		Input   json.RawMessage            `json:"input"`
		Outputs map[string]json.RawMessage `json:"outputs,omitempty"`
		Errors  map[string]string          `json:"errors,omitempty"`
		Error   string                     `json:"error,omitempty"`
	}
	results := make([]itemResult, len(items))
	workCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	semaphore := make(chan struct{}, config.Concurrency)
	var wait sync.WaitGroup
	for index, item := range items {
		if workCtx.Err() != nil {
			break
		}
		wait.Add(1)
		go func(index int, item json.RawMessage) {
			defer wait.Done()
			select {
			case semaphore <- struct{}{}:
			case <-workCtx.Done():
				return
			}
			defer func() { <-semaphore }()
			result, executeErr := engine.Execute(workCtx, child, ExecutionRequest{RunID: parent.RunID, UserID: parent.UserID, SpaceID: parent.SpaceID, Input: item, NodePrefix: fmt.Sprintf("%s.item_%06d.", invocation.NodeID, index), Completed: parent.Completed})
			if engine.ItemCheckpoint != nil {
				if checkpointErr := engine.ItemCheckpoint(context.WithoutCancel(workCtx), invocation.NodeID, item, result, executeErr); checkpointErr != nil && executeErr == nil {
					executeErr = checkpointErr
				}
			}
			results[index] = itemResult{Index: index, Input: item, Outputs: result.Outputs, Errors: result.Errors}
			if executeErr != nil {
				results[index].Error = executeErr.Error()
			}
			if (executeErr != nil || result.State != RunCompleted) && config.ErrorMode == "fail_fast" {
				cancel()
			}
		}(index, item)
	}
	wait.Wait()
	partial := false
	errorsByItem := map[string]string{}
	for index := range results {
		if results[index].Error != "" || len(results[index].Errors) > 0 {
			partial = true
			errorsByItem[fmt.Sprintf("%d", index)] = results[index].Error
			if errorsByItem[fmt.Sprintf("%d", index)] == "" {
				errorsByItem[fmt.Sprintf("%d", index)] = "completed_with_errors"
			}
		}
	}
	output, _ := json.Marshal(map[string]any{"items": results, "errors": errorsByItem, "partial": partial})
	if partial && config.ErrorMode == "fail_fast" {
		return output, true, errors.New("for_each child failed")
	}
	return output, partial, nil
}

func (engine Engine) childDefinition(config forEachConfig) (Definition, error) {
	if config.ChildGraph != nil && config.WorkflowVersionID != "" {
		return Definition{}, ErrInvalidDefinition
	}
	if config.ChildGraph != nil {
		return *config.ChildGraph, nil
	}
	if config.WorkflowVersionID == "" || engine.Resolver == nil {
		return Definition{}, ErrInvalidDefinition
	}
	_, _, child, ok := engine.Resolver.ResolveWorkflowVersion(config.WorkflowVersionID)
	if !ok {
		return Definition{}, ErrInvalidDefinition
	}
	return child, nil
}

func workflowItems(raw json.RawMessage) ([]json.RawMessage, error) {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return nil, ErrOutputInvalid
	}
	var find func(any) []any
	find = func(current any) []any {
		switch item := current.(type) {
		case []any:
			return item
		case map[string]any:
			for _, key := range []string{"items", "events", "value"} {
				if found := find(item[key]); found != nil {
					return found
				}
			}
		}
		return nil
	}
	values := find(value)
	if values == nil {
		return nil, ErrOutputInvalid
	}
	out := make([]json.RawMessage, 0, len(values))
	for _, item := range values {
		rawItem, err := json.Marshal(item)
		if err != nil {
			return nil, ErrOutputInvalid
		}
		out = append(out, rawItem)
	}
	return out, nil
}

func marshalExecutionResult(result ExecutionResult) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{"state": result.State, "outputs": result.Outputs, "errors": result.Errors})
	return raw
}

func (engine Engine) checkpoint(ctx context.Context, event StepEvent) error {
	if engine.Checkpoint == nil {
		return nil
	}
	return engine.Checkpoint(ctx, event)
}

func topologicalOrder(definition Definition) []Node {
	byID, indegree, outgoing := map[string]Node{}, map[string]int{}, map[string][]string{}
	for _, node := range definition.Nodes {
		byID[node.ID], indegree[node.ID] = node, 0
	}
	for _, edge := range definition.Edges {
		indegree[edge.Target]++
		outgoing[edge.Source] = append(outgoing[edge.Source], edge.Target)
	}
	queue := []string{}
	for id, degree := range indegree {
		if degree == 0 {
			queue = append(queue, id)
		}
	}
	sort.Strings(queue)
	out := make([]Node, 0, len(byID))
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		out = append(out, byID[id])
		for _, target := range outgoing[id] {
			indegree[target]--
			if indegree[target] == 0 {
				queue = append(queue, target)
				sort.Strings(queue)
			}
		}
	}
	return out
}

func resolveNodeInput(definition Definition, node Node, runInput json.RawMessage, outputs map[string]json.RawMessage, partials, skipped map[string]bool) (json.RawMessage, error) {
	value := map[string]any{}
	for name, binding := range node.Inputs {
		switch {
		case binding.SourceNode != "":
			if skipped[binding.SourceNode] {
				return nil, errBranchNotSelected
			}
			if partials[binding.SourceNode] && !node.Errors.AcceptsPartial {
				return nil, fmt.Errorf("upstream output %s is partial", binding.SourceNode)
			}
			raw, ok := outputs[binding.SourceNode]
			if !ok {
				return nil, fmt.Errorf("missing upstream output %s", binding.SourceNode)
			}
			decoded, portErr := workflowPortValue(raw, binding.SourcePort)
			if portErr != nil && conditionalWorkflowNode(definition, binding.SourceNode) && binding.SourcePort != "output" {
				return nil, errBranchNotSelected
			}
			if portErr != nil {
				return nil, portErr
			}
			value[name] = decoded
		case binding.InputPath != "":
			var root any
			if json.Unmarshal(runInput, &root) != nil {
				return nil, ErrInvalidDefinition
			}
			resolved, ok := workflowPathValue(root, binding.InputPath)
			if !ok {
				return nil, fmt.Errorf("missing workflow input %s", binding.InputPath)
			}
			value[name] = resolved
		default:
			value[name] = binding.Literal
		}
	}
	for _, edge := range definition.Edges {
		if edge.Target != node.ID {
			continue
		}
		if skipped[edge.Source] {
			return nil, errBranchNotSelected
		}
		if partials[edge.Source] && !node.Errors.AcceptsPartial {
			return nil, fmt.Errorf("upstream output %s is partial", edge.Source)
		}
		raw, ok := outputs[edge.Source]
		if !ok {
			return nil, fmt.Errorf("missing upstream output %s", edge.Source)
		}
		decoded, portErr := workflowPortValue(raw, edge.SourcePort)
		if portErr != nil && conditionalWorkflowNode(definition, edge.Source) && edge.SourcePort != "output" {
			return nil, errBranchNotSelected
		}
		if portErr != nil {
			return nil, portErr
		}
		value[edge.TargetPort] = decoded
	}
	if len(value) == 0 {
		if len(runInput) == 0 {
			return json.RawMessage(`{}`), nil
		}
		return runInput, nil
	}
	raw, _ := json.Marshal(value)
	return raw, nil
}

func conditionalWorkflowNode(definition Definition, nodeID string) bool {
	for _, node := range definition.Nodes {
		if node.ID == nodeID {
			return node.Kind == "condition" || node.Kind == "switch"
		}
	}
	return false
}

func workflowPortValue(raw json.RawMessage, port string) (any, error) {
	var decoded any
	if json.Unmarshal(raw, &decoded) != nil {
		return nil, ErrOutputInvalid
	}
	if port == "" || port == "output" {
		return decoded, nil
	}
	value, ok := workflowPathValue(decoded, port)
	if !ok {
		return nil, fmt.Errorf("missing output port %s", port)
	}
	return value, nil
}

func workflowPathValue(root any, path string) (any, bool) {
	path = strings.Trim(strings.ReplaceAll(path, "/", "."), ".")
	if path == "" {
		return root, true
	}
	current := root
	for _, segment := range strings.Split(path, ".") {
		switch item := current.(type) {
		case map[string]any:
			var ok bool
			current, ok = item[segment]
			if !ok {
				return nil, false
			}
		case []any:
			index, err := strconv.Atoi(segment)
			if err != nil || index < 0 || index >= len(item) {
				return nil, false
			}
			current = item[index]
		default:
			return nil, false
		}
	}
	return current, true
}

func validateOutput(schema JSONSchema, output json.RawMessage) error {
	var value any
	if json.Unmarshal(output, &value) != nil {
		return ErrOutputInvalid
	}
	if !matchesSchema(schema, value) {
		return ErrOutputInvalid
	}
	return nil
}

// ValidateJSON is shared by coordinator-dispatched agent tool calls and normal
// graph continuation so both paths enforce the provider's published schema.
func ValidateJSON(schema JSONSchema, value json.RawMessage) error {
	return validateOutput(schema, value)
}

func matchesSchema(schema JSONSchema, value any) bool {
	if len(schema) == 0 {
		return true
	}
	if choices, ok := schemaValues(schema["enum"]); ok {
		matched := false
		for _, choice := range choices {
			left, _ := json.Marshal(choice)
			right, _ := json.Marshal(value)
			if string(left) == string(right) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	expected, _ := schema["type"].(string)
	switch expected {
	case "", "any":
		return true
	case "object":
		object, ok := value.(map[string]any)
		if !ok {
			return false
		}
		if required, ok := schemaStrings(schema["required"]); ok {
			for _, name := range required {
				if object[name] == nil {
					return false
				}
			}
		}
		properties, _ := schemaMap(schema["properties"])
		for name, property := range properties {
			child, exists := object[name]
			if !exists {
				continue
			}
			childSchema, ok := schemaMap(property)
			if !ok || !matchesSchema(childSchema, child) {
				return false
			}
		}
		if additional, ok := schema["additionalProperties"].(bool); ok && !additional {
			for name := range object {
				if _, declared := properties[name]; !declared {
					return false
				}
			}
		}
		return true
	case "array":
		items, ok := value.([]any)
		if !ok {
			return false
		}
		if minimum, ok := schemaNumber(schema["minItems"]); ok && float64(len(items)) < minimum {
			return false
		}
		if maximum, ok := schemaNumber(schema["maxItems"]); ok && float64(len(items)) > maximum {
			return false
		}
		if raw, ok := schemaMap(schema["items"]); ok {
			for _, item := range items {
				if !matchesSchema(raw, item) {
					return false
				}
			}
		}
		return true
	case "string":
		text, ok := value.(string)
		if !ok {
			return false
		}
		if minimum, ok := schemaNumber(schema["minLength"]); ok && float64(len([]rune(text))) < minimum {
			return false
		}
		if maximum, ok := schemaNumber(schema["maxLength"]); ok && float64(len([]rune(text))) > maximum {
			return false
		}
		return true
	case "number":
		_, ok := value.(float64)
		return ok
	case "integer":
		number, ok := value.(float64)
		return ok && number == float64(int64(number))
	case "boolean":
		_, ok := value.(bool)
		return ok
	case "null":
		return value == nil
	default:
		return false
	}
}

func schemaNumber(value any) (float64, bool) {
	switch number := value.(type) {
	case float64:
		return number, true
	case int:
		return float64(number), true
	case int64:
		return float64(number), true
	default:
		return 0, false
	}
}

func schemaMap(value any) (JSONSchema, bool) {
	switch object := value.(type) {
	case JSONSchema:
		return object, true
	case map[string]any:
		return JSONSchema(object), true
	default:
		return nil, false
	}
}

func schemaStrings(value any) ([]string, bool) {
	switch items := value.(type) {
	case []string:
		return items, true
	case []any:
		out := make([]string, 0, len(items))
		for _, item := range items {
			text, ok := item.(string)
			if !ok {
				return nil, false
			}
			out = append(out, text)
		}
		return out, true
	default:
		return nil, false
	}
}

func schemaValues(value any) ([]any, bool) {
	if values, ok := value.([]any); ok {
		return values, true
	}
	if values, ok := value.([]string); ok {
		out := make([]any, len(values))
		for index := range values {
			out[index] = values[index]
		}
		return out, true
	}
	return nil, false
}

func idempotencyKey(runID, nodeID string) string {
	digest := sha256.Sum256([]byte(runID + ":" + nodeID))
	return hex.EncodeToString(digest[:])
}
