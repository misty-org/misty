// Package main exposes Misty's deliberately narrow embedded storage boundary.
//
// Upstream rclone remains an unmodified dependency. Only the providers and RC
// operation groups used by Misty are linked into the application.
package main

/*
#include <stdlib.h>

struct MistyStorageCallResult {
	char* Output;
	int Status;
};
*/
import "C"

import (
	"bytes"
	"context"
	"os"
	"sync"
	"unsafe"

	rcloneconfig "github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/rc"
	"github.com/rclone/rclone/lib/oauthutil"
	"github.com/rclone/rclone/librclone/librclone"

	_ "github.com/rclone/rclone/backend/drive"
	_ "github.com/rclone/rclone/backend/dropbox"
	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/onedrive"
	_ "github.com/rclone/rclone/fs/operations"
	_ "github.com/rclone/rclone/fs/sync"
)

var authorizationURL struct {
	sync.RWMutex
	value string
}

func init() {
	oauthutil.OpenURL = func(value string) error {
		authorizationURL.Lock()
		authorizationURL.value = value
		authorizationURL.Unlock()
		return nil
	}

	rc.Add(rc.Call{
		Path:  "misty/authorization-url",
		Title: "Return the current Misty authorization URL",
		Fn: func(_ context.Context, _ rc.Params) (rc.Params, error) {
			authorizationURL.RLock()
			defer authorizationURL.RUnlock()
			return rc.Params{"url": authorizationURL.value}, nil
		},
	})
	rc.Add(rc.Call{
		Path:  "misty/authorization-reset",
		Title: "Clear the current Misty authorization URL",
		Fn: func(_ context.Context, _ rc.Params) (rc.Params, error) {
			authorizationURL.Lock()
			authorizationURL.value = ""
			authorizationURL.Unlock()
			return rc.Params{"ok": true}, nil
		},
	})
	rc.Add(rc.Call{
		Path:  "misty/config-security",
		Title: "Return Misty storage configuration security state",
		Fn: func(_ context.Context, in rc.Params) (rc.Params, error) {
			path := rcloneconfig.GetConfigPath()
			body, _ := os.ReadFile(path)
			encrypted := bytes.HasPrefix(bytes.TrimSpace(body), []byte("RCLONE_ENCRYPT_V0:"))
			passwordPresent, _ := in.GetBool("password_present")
			return rc.Params{
				"config_path":      path,
				"encrypted":        encrypted,
				"unlocked":         !encrypted || passwordPresent,
				"password_present": passwordPresent,
				"message":          "Storage credentials are managed by Misty.",
			}, nil
		},
	})
	rc.Add(rc.Call{
		Path:  "misty/config-harden",
		Title: "Encrypt the Misty storage configuration",
		Fn: func(_ context.Context, in rc.Params) (rc.Params, error) {
			password, err := in.GetString("new_password")
			if err != nil {
				return nil, err
			}
			if err := rcloneconfig.SetConfigPassword(password); err != nil {
				return nil, err
			}
			if err := rcloneconfig.LoadedData().Save(); err != nil {
				return nil, err
			}
			_ = os.Setenv("RCLONE_CONFIG_PASS", password)
			return rc.Params{
				"config_path":      rcloneconfig.GetConfigPath(),
				"encrypted":        true,
				"unlocked":         true,
				"password_present": true,
				"message":          "Storage credentials are encrypted.",
			}, nil
		},
	})
}

//export MistyStorageInitialize
func MistyStorageInitialize() {
	librclone.Initialize()
}

//export MistyStorageFinalize
func MistyStorageFinalize() {
	librclone.Finalize()
}

//export MistyStorageCall
func MistyStorageCall(method *C.char, input *C.char) (result C.struct_MistyStorageCallResult) {
	output, status := librclone.RPC(C.GoString(method), C.GoString(input))
	result.Output = C.CString(output)
	result.Status = C.int(status)
	return result
}

//export MistyStorageFreeString
func MistyStorageFreeString(value *C.char) {
	C.free(unsafe.Pointer(value))
}

func main() {}
