// Command note-collab-ticket mints a collaboration ticket from the command
// line using the server's real configuration.
//
// It exists so the Go signer and the Cloudflare verifier can be checked against
// each other for real. Unit tests on both sides passing proves only that each
// agrees with itself; this proves they agree on the wire format.
//
//	NOTE_COLLAB_TICKET_PRIVATE_KEY=... NOTE_COLLAB_CONTROL_SECRET=... \
//	NOTE_COLLAB_PROJECTION_SECRET=... PARTYKIT_HOST=... \
//	MISTY_NOTES_COLLAB_ENABLED=true \
//	go run ./cmd/note-collab-ticket -note note_demo -user user_go -role editor
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/kannachi323/misty/server/api"
)

func main() {
	noteID := flag.String("note", "", "note id")
	userID := flag.String("user", "", "user id")
	spaceID := flag.String("space", "space_demo", "space id")
	role := flag.String("role", "editor", "creator, editor, or viewer")
	aclVersion := flag.Int64("acl-version", 1, "note ACL version")
	flag.Parse()

	if *noteID == "" || *userID == "" {
		fmt.Fprintln(os.Stderr, "-note and -user are required")
		os.Exit(2)
	}

	config, err := api.NoteCollabConfigFromEnv()
	if err != nil {
		fmt.Fprintf(os.Stderr, "configuration: %v\n", err)
		os.Exit(1)
	}
	if !config.Enabled {
		fmt.Fprintln(os.Stderr, "note collaboration is disabled; set MISTY_NOTES_COLLAB_ENABLED=true")
		os.Exit(1)
	}

	ticket, err := config.MintTicket(*userID, *spaceID, *noteID, *role, *aclVersion)
	if err != nil {
		fmt.Fprintf(os.Stderr, "minting: %v\n", err)
		os.Exit(1)
	}
	encoded, err := json.Marshal(ticket)
	if err != nil {
		fmt.Fprintf(os.Stderr, "encoding: %v\n", err)
		os.Exit(1)
	}
	fmt.Println(string(encoded))
}
