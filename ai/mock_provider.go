package ai

import (
	"encoding/json"
	"path"
	"sort"
	"strings"

	"github.com/google/uuid"
)

type MockProvider struct{}

func (MockProvider) Next(request ModelRequest) (ModelResponse, error) {
	lastUser := ""
	for index := len(request.Messages) - 1; index >= 0; index-- {
		if request.Messages[index].Role == "user" {
			lastUser = strings.ToLower(request.Messages[index].Content)
			break
		}
	}
	if len(request.ToolResults) == 0 && mockShouldInspect(lastUser) && hasTool(request.Capabilities, ToolListDirectory) {
		args, _ := json.Marshal(map[string]any{
			"path": request.ActiveRoot,
		})
		return ModelResponse{
			Text: "I will inspect the selected folder before proposing changes.",
			ToolRequests: []ToolRequest{{
				ID:        uuid.NewString(),
				Name:      ToolListDirectory,
				Risk:      RiskRead,
				Arguments: args,
			}},
		}, nil
	}
	if len(request.ToolResults) > 0 && mockShouldInspect(lastUser) {
		plan := organizePlanFromKnownPaths(request.KnownPaths)
		return ModelResponse{
			Text:     "I prepared an organization plan for review.",
			FilePlan: &plan,
		}, nil
	}
	return ModelResponse{Text: "MistyAI is connected. Ask me to organize a folder or inspect files."}, nil
}

func mockShouldInspect(message string) bool {
	if strings.TrimSpace(message) == "" {
		return false
	}
	for _, keyword := range []string{
		"organize",
		"organise",
		"sort",
		"clean",
		"declutter",
		"desktop",
		"downloads",
		"folder",
		"directory",
		"files",
	} {
		if strings.Contains(message, keyword) {
			return true
		}
	}
	return false
}

func hasTool(manifest ToolManifest, name string) bool {
	for _, tool := range manifest.Tools {
		if tool.Name == name {
			return true
		}
	}
	return false
}

func organizePlanFromKnownPaths(paths []string) FileOperationPlan {
	sort.Strings(paths)
	operations := []FileOperation{
		{Type: "mkdir", Path: "Documents", Reason: "Group documents and PDFs."},
		{Type: "mkdir", Path: "Images", Reason: "Group image files."},
		{Type: "mkdir", Path: "Archives", Reason: "Group archive files."},
	}
	used := make(map[string]struct{})
	for _, candidate := range paths {
		if strings.Contains(candidate, "/") {
			continue
		}
		targetDir := mockCategoryFor(candidate)
		if targetDir == "" {
			continue
		}
		target := path.Join(targetDir, candidate)
		if _, exists := used[target]; exists {
			continue
		}
		used[target] = struct{}{}
		confidence := 0.8
		operations = append(operations, FileOperation{
			Type:       "move",
			From:       candidate,
			To:         target,
			Reason:     "Categorized by extension.",
			Confidence: &confidence,
		})
	}
	return FileOperationPlan{
		Summary:    "Organized loose files into broad document, image, and archive folders.",
		Operations: operations,
		Warnings:   []string{},
	}
}

func mockCategoryFor(name string) string {
	extension := strings.ToLower(path.Ext(name))
	switch extension {
	case ".pdf", ".doc", ".docx", ".txt", ".md", ".rtf":
		return "Documents"
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".svg":
		return "Images"
	case ".zip", ".tar", ".gz", ".rar", ".7z":
		return "Archives"
	default:
		return ""
	}
}
