// misty-pwd-helper is the tiny binary restic shells out to via
// --password-command. Given a repo name on argv, it prints the password
// stored under (keyringService, name) in the OS keyring (or the file
// fallback) and exits 0. Any failure prints to stderr and exits non-zero
// — restic will then refuse to open the repo, which is the desired
// behavior because we never want to silently retry with the wrong key.
package main

import (
	"fmt"
	"os"

	"github.com/kannachi323/misty/proxy/core/restic"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: misty-pwd-helper <repo-name>")
		os.Exit(2)
	}
	pw, err := restic.LoadPassword(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "misty-pwd-helper:", err)
		os.Exit(1)
	}
	fmt.Println(pw)
}
