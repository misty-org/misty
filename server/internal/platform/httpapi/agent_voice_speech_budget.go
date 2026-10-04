package api

import (
	agent "github.com/kannachi323/misty/server/internal/agents"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Keep UTF-8 and prefer complete sentences over the last space. Each chunk is admitted only when
// the preceding one finishes; no quota is held for the unspoken remainder.
func voiceSpeechChunks(text string) []string {
	var chunks []string
	for len(text) > 320 {
		end := 320
		for !utf8.ValidString(text[:end]) {
			end--
		}
		sentence := 0
		for i, r := range text[:end] {
			if !strings.ContainsRune(".!?。！？\n", r) {
				continue
			}
			next := i + utf8.RuneLen(r)
			following, _ := utf8.DecodeRuneInString(text[next:])
			if r == '\n' || strings.ContainsRune("。！？", r) || unicode.IsSpace(following) {
				sentence = next
			}
		}
		if sentence > 0 {
			end = sentence
		} else if boundary := strings.LastIndexAny(text[:end], " \n,;:"); boundary >= end/2 {
			_, size := utf8.DecodeRuneInString(text[boundary:])
			end = boundary + size
		}
		chunks = append(chunks, text[:end])
		text = text[end:]
	}
	if text != "" {
		chunks = append(chunks, text)
	}
	return chunks
}

// A fixed provider generation limit bounds each already chunked speech request.
// Billing turns raw context sizes into its admission estimate.
func voiceSpeechFacts(text string, contextBytes, retainedTextTokens, audioBytes, retainedAudioTokens int) (agent.RealtimeVoiceUsage, int) {
	const limit = 2048
	return agent.RealtimeVoiceUsage{"context_bytes": int64(contextBytes), "speech_bytes": int64(len(text)), "retained_text_tokens": int64(retainedTextTokens), "audio_pcm_bytes": int64(audioBytes), "retained_audio_tokens": int64(retainedAudioTokens), "output_token_limit": limit}, limit
}
