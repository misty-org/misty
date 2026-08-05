package db

import (
	"context"
	"errors"
	"testing"
	"time"

	. "github.com/kannachi323/misty/server/internal/platform/postgres"
)

func TestSpaceRoadmapGraphAndAgendaContracts(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Roadmap Owner", "roadmap-owner@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	outsider, err := database.CreateUser("Roadmap Outsider", "roadmap-outsider@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	space := createTestSpace(t, database, ctx, owner.ID, "Roadmap test")
	otherSpace := createTestSpace(t, database, ctx, owner.ID, "Other roadmap test")

	graph, err := database.CreateSpaceRoadmap(ctx, owner.ID, space.ID, "Beta launch", "Ship the beta")
	if err != nil {
		t.Fatal(err)
	}
	if len(graph.Milestones) != 1 {
		t.Fatalf("default milestones = %d, want 1", len(graph.Milestones))
	}
	if _, err := database.SpaceRoadmap(ctx, outsider.ID, space.ID, graph.Roadmap.ID); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("outsider load error = %v, want ErrSpaceForbidden", err)
	}

	target := time.Now().UTC().Add(48 * time.Hour).Truncate(24 * time.Hour)
	milestone := graph.Milestones[0]
	milestone.TargetDate = &target
	savedMilestone, version, err := database.UpdateSpaceRoadmapMilestone(ctx, owner.ID, space.ID, graph.Roadmap.ID, milestone.ID, milestone, graph.Roadmap.GraphVersion)
	if err != nil {
		t.Fatal(err)
	}
	goalA, version, err := database.CreateSpaceRoadmapGoal(ctx, owner.ID, space.ID, graph.Roadmap.ID, SpaceRoadmapGoal{MilestoneID: savedMilestone.ID, Title: "Goal A", TargetDate: &target, PositionX: 24, PositionY: 72}, version)
	if err != nil {
		t.Fatal(err)
	}
	goalB, version, err := database.CreateSpaceRoadmapGoal(ctx, owner.ID, space.ID, graph.Roadmap.ID, SpaceRoadmapGoal{MilestoneID: savedMilestone.ID, Title: "Goal B", PositionX: 240, PositionY: 72}, version)
	if err != nil {
		t.Fatal(err)
	}
	_, version, err = database.SaveSpaceRoadmapEdge(ctx, owner.ID, space.ID, graph.Roadmap.ID, SpaceRoadmapEdge{SourceGoalID: goalA.ID, TargetGoalID: goalB.ID, EdgeType: "dependency"}, version)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := database.SaveSpaceRoadmapEdge(ctx, owner.ID, space.ID, graph.Roadmap.ID, SpaceRoadmapEdge{SourceGoalID: goalB.ID, TargetGoalID: goalA.ID, EdgeType: "dependency"}, version); !errors.Is(err, ErrSpaceInvalid) {
		t.Fatalf("dependency cycle error = %v, want ErrSpaceInvalid", err)
	}
	if _, version, err = database.SaveSpaceRoadmapEdge(ctx, owner.ID, space.ID, graph.Roadmap.ID, SpaceRoadmapEdge{SourceGoalID: goalB.ID, TargetGoalID: goalA.ID, EdgeType: "related", Label: "supports"}, version); err != nil {
		t.Fatalf("related cycle: %v", err)
	}

	due := target.Add(10 * time.Hour)
	task, err := database.CreateSpaceTask(ctx, owner.ID, SpaceTask{SpaceID: space.ID, Title: "Launch task", Status: "todo", Priority: "high", DueAt: &due})
	if err != nil {
		t.Fatal(err)
	}
	otherTask, err := database.CreateSpaceTask(ctx, owner.ID, SpaceTask{SpaceID: otherSpace.ID, Title: "Other task", Status: "todo", Priority: "low"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.ReplaceSpaceRoadmapGoalTasks(ctx, owner.ID, space.ID, graph.Roadmap.ID, goalA.ID, []string{otherTask.ID}, version); !errors.Is(err, ErrSpaceInvalid) {
		t.Fatalf("cross-Space task link error = %v, want ErrSpaceInvalid", err)
	}
	version, err = database.ReplaceSpaceRoadmapGoalTasks(ctx, owner.ID, space.ID, graph.Roadmap.ID, goalA.ID, []string{task.ID}, version)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := database.UpdateSpaceRoadmapGoal(ctx, owner.ID, space.ID, graph.Roadmap.ID, goalA.ID, *goalA, nil, version-1); !errors.Is(err, ErrSpaceConflict) {
		t.Fatalf("stale graph write error = %v, want ErrSpaceConflict", err)
	}

	agenda, err := database.SpaceAgenda(ctx, owner.ID, space.ID, target.Add(-24*time.Hour), target.Add(72*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]bool{}
	for _, entry := range agenda.Entries {
		kinds[entry.Kind] = true
	}
	if !kinds["task"] || !kinds["goal"] || !kinds["milestone"] {
		t.Fatalf("agenda kinds = %#v", kinds)
	}
}
