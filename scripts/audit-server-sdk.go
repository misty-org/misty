// Run with: go run scripts/audit-server-sdk.go
package main

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type Route struct {
	Verb      string `json:"verb"`
	Path      string `json:"path"`
	File      string `json:"file"`
	Line      int    `json:"line"`
	SDKMethod string `json:"sdkMethod,omitempty"`
}

func main() {
	root := "../misty-server"
	fset := token.NewFileSet()
	files, _ := filepath.Glob(filepath.Join(root, "internal/app/*.go"))
	methodsRaw, _ := os.ReadFile(filepath.Join(root, "internal/apprpc/methods.json"))
	var registry struct {
		Methods map[string]struct {
			Verb string
			Path string
		}
	}
	_ = json.Unmarshal(methodsRaw, &registry)
	implemented := map[string]string{}
	for name, method := range registry.Methods {
		implemented[method.Verb+" "+method.Path] = name
	}
	routes := map[string]Route{}
	for _, path := range files {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		source, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			panic(err)
		}
		ast.Inspect(source, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			name := selector.Sel.Name
			var verb string
			var expr ast.Expr
			switch name {
			case "Get", "Post", "Put", "Patch", "Delete", "Head":
				if len(call.Args) > 0 {
					verb = strings.ToUpper(name)
					expr = call.Args[0]
				}
			case "MethodFunc", "Method":
				if len(call.Args) > 1 {
					if method, ok := call.Args[0].(*ast.SelectorExpr); ok {
						verb = strings.ToUpper(strings.TrimPrefix(method.Sel.Name, "Method"))
						expr = call.Args[1]
					}
				}
			}
			if expr == nil {
				return true
			}
			route, ok := routeString(expr)
			if !ok || !appDomain(route) {
				return true
			}
			position := fset.Position(call.Pos())
			rel, _ := filepath.Rel(root, path)
			key := verb + " " + route
			routes[key] = Route{Verb: verb, Path: route, File: rel, Line: position.Line, SDKMethod: implemented[key]}
			return true
		})
	}
	output := make([]Route, 0, len(routes))
	for _, route := range routes {
		output = append(output, route)
	}
	sort.Slice(output, func(i, j int) bool {
		if output[i].Path == output[j].Path {
			return output[i].Verb < output[j].Verb
		}
		return output[i].Path < output[j].Path
	})
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(output)
}
func routeString(expr ast.Expr) (string, bool) {
	switch value := expr.(type) {
	case *ast.BasicLit:
		if value.Kind == token.STRING {
			text, err := strconv.Unquote(value.Value)
			return text, err == nil
		}
	case *ast.Ident:
		if value.Name == "prefix" {
			return "", true
		}
	case *ast.BinaryExpr:
		if value.Op == token.ADD {
			left, l := routeString(value.X)
			right, r := routeString(value.Y)
			return left + right, l && r
		}
	}
	return "", false
}
func appDomain(path string) bool {
	for _, root := range []string{"spaces", "activity", "mail", "connections", "cloud", "agents", "agent-runs", "agent-voice", "mcp", "automations", "devices", "search", "ai", "misty"} {
		if path == "/"+root || strings.HasPrefix(path, "/"+root+"/") {
			return true
		}
	}
	return path == "/me" || path == "/me/avatar"
}
