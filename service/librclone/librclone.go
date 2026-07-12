// Package librclone exports shims for C library use
//
// This directory contains code to build rclone as a C library and the
// shims for accessing rclone from C.
//
// The shims are a thin wrapper over the rclone RPC.
//
// Build a shared library like this:
//
//	go build --buildmode=c-shared -o librclone.so github.com/rclone/rclone/librclone
//
// Build a static library like this:
//
//	go build --buildmode=c-archive -o librclone.a github.com/rclone/rclone/librclone
//
// Both the above commands will also generate `librclone.h` which should
// be `#include`d in `C` programs wishing to use the library.
//
// The library will depend on `libdl` and `libpthread`.
package main

/*
#include <stdlib.h>

struct RcloneRPCResult {
	char*	Output;
	int	Status;
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

	_ "github.com/rclone/rclone/backend/drive"    // Google Drive
	_ "github.com/rclone/rclone/backend/dropbox"  // Dropbox
	_ "github.com/rclone/rclone/backend/local"    // internal local filesystem operations
	_ "github.com/rclone/rclone/backend/onedrive" // OneDrive and SharePoint
	_ "github.com/rclone/rclone/fs/operations"    // import operations/* rc commands
	_ "github.com/rclone/rclone/fs/sync"          // import sync/*
)

var mistyAuthorizationURL struct {
	sync.RWMutex
	value string
}

func init() {
	oauthutil.OpenURL = func(value string) error {
		mistyAuthorizationURL.Lock()
		mistyAuthorizationURL.value = value
		mistyAuthorizationURL.Unlock()
		return nil
	}
	rc.Add(rc.Call{
		Path:  "misty/authorization-url",
		Title: "Return the current Misty authorization URL",
		Fn: func(_ context.Context, _ rc.Params) (rc.Params, error) {
			mistyAuthorizationURL.RLock()
			defer mistyAuthorizationURL.RUnlock()
			return rc.Params{"url": mistyAuthorizationURL.value}, nil
		},
	})
	rc.Add(rc.Call{
		Path:  "misty/authorization-reset",
		Title: "Clear the current Misty authorization URL",
		Fn: func(_ context.Context, _ rc.Params) (rc.Params, error) {
			mistyAuthorizationURL.Lock()
			mistyAuthorizationURL.value = ""
			mistyAuthorizationURL.Unlock()
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

// RcloneInitialize initializes rclone as a library
//
//export RcloneInitialize
func RcloneInitialize() {
	librclone.Initialize()
}

// RcloneFinalize finalizes the library
//
//export RcloneFinalize
func RcloneFinalize() {
	librclone.Finalize()
}

// RcloneRPCResult is returned from RcloneRPC
//
//	Output will be returned as a serialized JSON object
//	Status is a HTTP status return (200=OK anything else fail)
type RcloneRPCResult struct { //nolint:deadcode
	Output *C.char
	Status C.int
}

// RcloneRPC does a single RPC call. The inputs are (method, input)
// and the output is (output, status). This is an exported interface
// to the rclone API as described in https://rclone.org/rc/
//
//	method is a string, eg "operations/list"
//	input should be a string with a serialized JSON object
//	result.Output will be returned as a string with a serialized JSON object
//	result.Status is a HTTP status return (200=OK anything else fail)
//
// All strings are UTF-8 encoded, on all platforms.
//
// Caller is responsible for freeing the memory for result.Output
// (see RcloneFreeString), result itself is passed on the stack.
//
//export RcloneRPC
func RcloneRPC(method *C.char, input *C.char) (result C.struct_RcloneRPCResult) { //nolint:golint
	output, status := librclone.RPC(C.GoString(method), C.GoString(input))
	result.Output = C.CString(output)
	result.Status = C.int(status)
	return result
}

// RcloneFreeString may be used to free the string returned by RcloneRPC
//
// If the caller has access to the C standard library, the free function can
// normally be called directly instead. In some cases the caller uses a
// runtime library which is not compatible, and then this function can be
// used to release the memory with the same library that allocated it.
//
//export RcloneFreeString
func RcloneFreeString(str *C.char) {
	C.free(unsafe.Pointer(str))
}

// do nothing here - necessary for building into a C library
func main() {}
