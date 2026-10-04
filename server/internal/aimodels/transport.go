package aimodels

import (
	"context"
	"crypto/tls"
	"errors"
	mcp "github.com/kannachi323/misty/server/internal/integrations/mcp"
	"net"
	"net/http"
	"net/url"
	"time"
)

func DialEndpoint(base string) (func(context.Context, string, string) (net.Conn, error), error) {
	if err := ValidateBase(base); err != nil {
		return nil, err
	}
	target, _ := url.Parse(base)
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		expectedPort := target.Port()
		if expectedPort == "" {
			expectedPort = "443"
		}
		if err != nil || host != target.Hostname() || port != expectedPort {
			return nil, errors.New("provider transport target changed")
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, errors.New("provider endpoint lookup failed")
		}
		if len(ips) == 0 {
			return nil, errors.New("provider endpoint unavailable")
		}
		for _, ip := range ips {
			if !mcp.IsPublicEndpointIP(ip.IP) {
				return nil, errors.New("provider endpoint resolved to a private or reserved address")
			}
		}
		dialer := net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
		var conn net.Conn
		for _, ip := range ips {
			conn, err = dialer.DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
			if err == nil {
				return conn, nil
			}
		}
		return nil, errors.New("provider endpoint connection failed")
	}, nil
}
func HTTPClient(base string) (*http.Client, error) {
	dial, err := DialEndpoint(base)
	if err != nil {
		return nil, err
	}
	return &http.Client{Timeout: 90 * time.Second, Transport: &http.Transport{Proxy: nil, DialContext: dial, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}, TLSHandshakeTimeout: 10 * time.Second}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, nil
}
