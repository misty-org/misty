package api

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"errors"
	"fmt"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"strings"

	"github.com/kannachi323/misty/server/internal/aimodels"
	envconfig "github.com/kannachi323/misty/server/internal/platform/config"
)

// The companion's voice and teaching rules, and the closing line of a
// tool-free teaching turn. The pointing eval
// (server/apps/agent-runtime/evals/pointing) reads the same files, so it scores
// the words production sends.
var (
	//go:embed companion_teach_prompt.txt
	companionTeachPrompt string
	//go:embed companion_teach_turn.txt
	companionTeachTurn string
)

// companionTeaches reports a turn that only explains and points at the
// attached screens: no tools, no general work instructions.
func companionTeaches(body aiInvocationInput) bool {
	return body.Mode == "companion" && body.CompanionIntent == "teach"
}

// companionTeachReasoning is the effort for a teaching turn. Low keeps the
// answer quick; MISTY_COMPANION_TEACH_REASONING lets the pointing eval's
// winner replace it without a release.
func companionTeachReasoning() string {
	effort := strings.ToLower(strings.TrimSpace(envconfig.Getenv("MISTY_COMPANION_TEACH_REASONING")))
	if effort == "" || !aimodels.ValidReasoning(effort) {
		return "low"
	}
	return effort
}

// companionAdmissionReasoning keeps a teaching turn quick. It applies after
// the account's Thinking choice is validated: the catalog lists only those
// user-facing presets, while every model call accepts the teaching effort.
// The conversation's saved Thinking choice is left as it was.
func companionAdmissionReasoning(body aiInvocationInput, reasoning string) string {
	if companionTeaches(body) {
		return companionTeachReasoning()
	}
	return reasoning
}

func validateCompanionInput(body *aiInvocationInput) error {
	if body.Mode != "companion" {
		if body.CompanionMode != "" || body.CompanionModel != "" || body.CompanionIntent != "" || len(body.DisplayCaptures) > 0 {
			return errors.New("companion options require companion mode")
		}
		return nil
	}
	if body.CompanionIntent != "" && body.CompanionIntent != "teach" {
		return errors.New("invalid companion intent")
	}
	if body.CompanionIntent == "teach" && len(body.DisplayCaptures) == 0 {
		return errors.New("teaching needs the screens it explains")
	}
	// Retain old wire values for saved clients; all use the same natural task policy.
	if body.CompanionMode == "" {
		body.CompanionMode = "auto"
	}
	if body.CompanionMode != "team" && body.CompanionMode != "auto" {
		return errors.New("invalid companion mode")
	}
	if len(body.DisplayCaptures) > 16 {
		return errors.New("too many display captures")
	}
	seen := map[string]bool{}
	primary := 0
	for i := range body.DisplayCaptures {
		capture := &body.DisplayCaptures[i]
		if capture.Screen != fmt.Sprintf("screen%d", i+1) || seen[capture.Screen] {
			return errors.New("display labels must be unique and ordered")
		}
		seen[capture.Screen] = true
		if capture.Primary {
			primary++
		}
		if err := validateAICapture(&capture.aiCaptureAttachment); err != nil {
			return err
		}
		if err := validateCompanionPixels(capture.aiCaptureAttachment); err != nil {
			return err
		}
	}
	if len(body.DisplayCaptures) > 0 && primary != 1 {
		return errors.New("one cursor display must be primary")
	}
	return nil
}
// companionSystemPrompt is the companion's part of a run's system prompt;
// tools is the run's catalog, which decides how a screen question without
// captures is answered.
func companionSystemPrompt(body aiInvocationInput, tools []string) string {
	prompt := "\n" + companionTeachPrompt
	if companionTeaches(body) {
		return prompt + companionTeachTurn
	}
	prompt += `
For visual questions (what is this, explain this problem, what is on my screen), answer directly from the supplied fresh images and point. Do not inspect, navigate, search, or click merely to explain visible content. If the image does not show the needed detail, say what is unavailable and ask for a fresh view.
When the user asks you to do something, use the tools listed for this run; you do not need per-action approval. The capability notes below say which browser or screen is attached. Use the attached control surface for requested screen actions. Open reference links only from user-provided URLs or actual search/tool source URLs. Never invent citations. Never claim an action succeeded without confirmed tool results. Capture the attached control surface again after every action before reporting completion; if the display screenshot is no longer current or you only have a page crop, use [POINT:none], not stale display coordinates. Pause and explain when sign-in or other user participation is needed. Completed actions remain in history.
There are no Team/Auto interaction modes. Decide from the request whether to teach, answer, use tools, or take desktop control. Desktop control begins through the visual tool; if Ask is enabled the native app obtains human confirmation first. Never dismiss, accept, or work around that confirmation or the user’s Stop controls.
`
	switch {
	case len(body.DisplayCaptures) > 0:
	case agentToolNameAllowed(tools, screenLookTool):
		prompt += "No display captures accompany this turn yet. For a question about what is on the user's screen, such as where something is or how to do something there, call screen_look first; Misty captures the screens and continues with them attached, so you can answer and point. Do not guess from old history or treat DOM as desktop pixels.\n"
	default:
		prompt += "No fresh desktop display captures accompany this turn. For a question about the current screen, explain that desktop context is unavailable and ask the user to use the main desktop companion or attach an image. Do not guess from old history or treat DOM as desktop pixels. Use [POINT:none].\n"
	}
	return prompt + "When the user asks for work, carry it through multiple steps, keep the user informed, verify results, and report completion or the precise blocker. Do not start unrelated work.\n"
}
func companionConversationHistory(turns []db.AIConversationTurnRecord, current string) string {
	retained := make([]db.AIConversationTurnRecord, 0, len(turns))
	for _, turn := range turns {
		if turn.InvocationID == current || strings.TrimSpace(turn.Prompt) == "" {
			continue
		}
		turn.Reply = agentSpeechPoint.ReplaceAllString(turn.Reply, "")
		if turn.State == "failed" {
			if strings.TrimSpace(turn.Reply) == "" {
				turn.Reply = strings.TrimSpace(turn.Failure)
			}
			if turn.Reply == "" {
				turn.Reply = "The request failed before producing a reply."
			}
			turn.Reply = "Failed attempt (not evidence of a completed action): " + turn.Reply
		}
		retained = append(retained, turn)
	}
	if len(retained) > 10 {
		retained = retained[len(retained)-10:]
	}
	return boundedAIConversationHistory(retained, current)
}

// Validate the image actually sent to the model, rather than trusting its envelope.
func validateCompanionPixels(capture aiCaptureAttachment) error {
	encoded := strings.SplitN(capture.DataURL, ",", 2)
	if len(encoded) != 2 {
		return errors.New("capture data is invalid")
	}
	data, err := base64.StdEncoding.DecodeString(encoded[1])
	if err != nil {
		return errors.New("capture data is invalid")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width != capture.Width || config.Height != capture.Height || "image/"+format != capture.MimeType {
		return errors.New("capture pixels do not match dimensions or media type")
	}
	if _, _, err = image.Decode(bytes.NewReader(data)); err != nil {
		return errors.New("capture image is incomplete")
	}
	if fmt.Sprintf("%x", sha256.Sum256(data)) != capture.ContentHash {
		return errors.New("capture checksum does not match pixels")
	}
	return nil
}
