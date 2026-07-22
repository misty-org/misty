package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/kannachi323/misty/server/db"
)

func testDiscordMessage() discordMessage {
	message := discordMessage{ID: "1200000000000000002", ChannelID: "channel-1", Content: "ship it", Type: 0}
	message.Author.ID = "980000000000000001"
	message.Author.Username = "rey"
	message.Author.GlobalName = "Rey"
	return message
}

func TestShouldMirrorDiscordMessage(t *testing.T) {
	link := &db.SpaceDiscordLink{Direction: "two_way", BotUserID: "misty-bot"}

	if !shouldMirrorDiscordMessage(testDiscordMessage(), link) {
		t.Fatal("an ordinary message should mirror")
	}

	reply := testDiscordMessage()
	reply.Type = 19
	if !shouldMirrorDiscordMessage(reply, link) {
		t.Fatal("an inline reply should mirror")
	}

	// The bot-echo rule is what stops an infinite mirror loop.
	echo := testDiscordMessage()
	echo.Author.ID = "misty-bot"
	if shouldMirrorDiscordMessage(echo, link) {
		t.Fatal("the bot's own message must not mirror back into Misty")
	}

	webhook := testDiscordMessage()
	webhook.WebhookID = "hook-1"
	if shouldMirrorDiscordMessage(webhook, link) {
		t.Fatal("a webhook post is how Misty publishes, so it must not mirror back")
	}

	joinNotice := testDiscordMessage()
	joinNotice.Type = 7
	if shouldMirrorDiscordMessage(joinNotice, link) {
		t.Fatal("system notices must not mirror")
	}

	empty := testDiscordMessage()
	empty.Content = "   "
	if shouldMirrorDiscordMessage(empty, link) {
		t.Fatal("an empty message carries nothing to mirror")
	}

	attachmentOnly := testDiscordMessage()
	attachmentOnly.Content = ""
	attachmentOnly.Attachments = append(attachmentOnly.Attachments, struct {
		ID       string `json:"id"`
		Filename string `json:"filename"`
		URL      string `json:"url"`
	}{ID: "a1", Filename: "spec.pdf", URL: "https://cdn.discord/spec.pdf"})
	if !shouldMirrorDiscordMessage(attachmentOnly, link) {
		t.Fatal("an attachment-only message should still mirror")
	}

	if shouldMirrorDiscordMessage(testDiscordMessage(), &db.SpaceDiscordLink{Direction: "outbound"}) {
		t.Fatal("an outbound-only link must refuse inbound traffic")
	}
}

func TestDiscordContentToSpansRewritesMentions(t *testing.T) {
	message := testDiscordMessage()
	message.Content = "ping <@980000000000000009> in <#12345>"
	labels := map[string]string{"980000000000000009": "Poe", "12345": "general"}

	spans := discordContentToSpans(message, labels)
	text := spansToPlainText(spans)
	if text != "ping @Poe in #general" {
		t.Fatalf("mention rewrite = %q, want readable names", text)
	}
}

func TestDiscordContentToSpansKeepsUnknownMentionsIntact(t *testing.T) {
	message := testDiscordMessage()
	message.Content = "hi <@980000000000000009>"

	// Without a label there is nothing better to show, but the raw token must
	// survive rather than being dropped as if the mention never happened.
	text := spansToPlainText(discordContentToSpans(message, map[string]string{}))
	if !strings.Contains(text, "<@980000000000000009>") {
		t.Fatalf("unknown mention = %q, want the original token preserved", text)
	}
}

func TestDiscordContentToSpansSummarizesAttachments(t *testing.T) {
	message := testDiscordMessage()
	message.Attachments = append(message.Attachments, struct {
		ID       string `json:"id"`
		Filename string `json:"filename"`
		URL      string `json:"url"`
	}{ID: "a1", Filename: "spec.pdf", URL: "https://cdn.discord/spec.pdf"})

	text := spansToPlainText(discordContentToSpans(message, nil))
	if !strings.Contains(text, "spec.pdf") {
		t.Fatalf("attachment summary = %q, want the filename", text)
	}
}

func TestDiscordDisplayNameFallsBackToUsername(t *testing.T) {
	message := testDiscordMessage()
	message.Author.GlobalName = ""
	if got := discordDisplayName(message); got != "rey" {
		t.Fatalf("discordDisplayName() = %q, want the username", got)
	}
}

func TestPublishableToDiscord(t *testing.T) {
	own := &db.SpaceMessage{SenderKind: "person", SenderUserID: "user-1",
		Content: []db.MessageSpan{{Type: "text", Text: "hello"}}}
	if !publishableToDiscord(own, "user-1") {
		t.Fatal("a person's own Misty message should publish")
	}

	// Never bounce a Discord-sourced message back to Discord.
	mirrored := *own
	mirrored.Origin, _ = json.Marshal(db.MessageOrigin{System: "discord", ExternalID: "1"})
	if publishableToDiscord(&mirrored, "user-1") {
		t.Fatal("a Discord-sourced message must not be republished")
	}

	agent := *own
	agent.SenderKind = "agent"
	if publishableToDiscord(&agent, "user-1") {
		t.Fatal("agent output stays inside the Space")
	}

	other := *own
	other.SenderUserID = "user-2"
	if publishableToDiscord(&other, "user-1") {
		t.Fatal("a member may only publish their own message")
	}

	blank := *own
	blank.Content = []db.MessageSpan{{Type: "text", Text: "   "}}
	if publishableToDiscord(&blank, "user-1") {
		t.Fatal("a whitespace-only message has nothing to publish")
	}
}

func TestTruncateForDiscordRespectsTheContentLimit(t *testing.T) {
	truncated := truncateForDiscord(strings.Repeat("x", 2500))
	if length := len([]rune(truncated)); length != discordContentLimit {
		t.Fatalf("truncateForDiscord() length = %d, want %d", length, discordContentLimit)
	}
	if !strings.HasSuffix(truncated, "…") {
		t.Fatal("a truncated message should end with an ellipsis")
	}
	if short := truncateForDiscord("hello"); short != "hello" {
		t.Fatalf("truncateForDiscord() = %q, want short content untouched", short)
	}
}

func TestSnowflakeAfterComparesNumerically(t *testing.T) {
	// A plain string comparison would order "9" after "10" and rewind the cursor.
	if snowflakeAfter("9", "10") {
		t.Fatal("snowflakeAfter(9,10) must be false")
	}
	if !snowflakeAfter("10", "9") {
		t.Fatal("snowflakeAfter(10,9) must be true")
	}
	if !snowflakeAfter("1200000000000000005", "1200000000000000003") {
		t.Fatal("a newer same-length snowflake must compare greater")
	}
	if !snowflakeAfter("1200000000000000002", "") {
		t.Fatal("any message is newer than an empty cursor")
	}
}

func TestSpansToPlainTextRendersMentions(t *testing.T) {
	spans := []db.MessageSpan{
		{Type: "text", Text: "hey "},
		{Type: "mention", Label: "Poe"},
		{Type: "text", Text: " look"},
	}
	if got := spansToPlainText(spans); got != "hey @Poe look" {
		t.Fatalf("spansToPlainText() = %q", got)
	}
}

func TestDiscordContentToSpansRespectsMistyMessageLimit(t *testing.T) {
	message := testDiscordMessage()
	message.Content = strings.Repeat("x", 5000)

	// Exceeding Misty's own message limit would make the insert fail and drop
	// the message, so mirrored content is trimmed rather than lost.
	text := spansToPlainText(discordContentToSpans(message, nil))
	if length := len([]rune(text)); length != mistyMessageCharLimit {
		t.Fatalf("mirrored length = %d, want %d", length, mistyMessageCharLimit)
	}
}
