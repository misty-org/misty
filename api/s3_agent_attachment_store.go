package api

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/retry"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	smithyhttp "github.com/aws/smithy-go/transport/http"
)

const agentCiphertextSHA256MetadataKey = "misty-ciphertext-sha256"

// S3AgentAttachmentStoreConfig configures a private, S3-compatible ciphertext
// bucket. BucketPrivate and LifecycleMaxDays are deliberate deployment
// assertions: object-store public-access and lifecycle controls are configured
// outside Misty, so production must explicitly acknowledge both safeguards.
type S3AgentAttachmentStoreConfig struct {
	Endpoint           string
	Region             string
	Bucket             string
	AccessKeyID        string
	SecretAccessKey    string
	ForcePathStyle     bool
	BucketPrivate      bool
	LifecycleMaxDays   int
	AllowInsecureLocal bool
	HTTPClient         *http.Client
}

type s3AttachmentAPI interface {
	PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error)
	HeadObject(context.Context, *s3.HeadObjectInput, ...func(*s3.Options)) (*s3.HeadObjectOutput, error)
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	DeleteObject(context.Context, *s3.DeleteObjectInput, ...func(*s3.Options)) (*s3.DeleteObjectOutput, error)
}

type s3AttachmentPresigner interface {
	PresignPutObject(context.Context, *s3.PutObjectInput, ...func(*s3.PresignOptions)) (*v4PresignedHTTPRequest, error)
}

// v4PresignedHTTPRequest is the subset of the SDK presign result Misty uses.
// The adapter below avoids exposing SDK types throughout the attachment API.
type v4PresignedHTTPRequest struct {
	URL          string
	Method       string
	SignedHeader http.Header
}

type awsS3Presigner struct{ value *s3.PresignClient }

func (p awsS3Presigner) PresignPutObject(ctx context.Context, input *s3.PutObjectInput, options ...func(*s3.PresignOptions)) (*v4PresignedHTTPRequest, error) {
	result, err := p.value.PresignPutObject(ctx, input, options...)
	if err != nil {
		return nil, err
	}
	return &v4PresignedHTTPRequest{URL: result.URL, Method: result.Method, SignedHeader: result.SignedHeader}, nil
}

// S3AgentAttachmentStore stores only encrypted attachment bytes. It supports
// AWS S3 and compatible services such as Cloudflare R2.
type S3AgentAttachmentStore struct {
	bucket    string
	client    s3AttachmentAPI
	presigner s3AttachmentPresigner
}

func NewS3AgentAttachmentStore(config S3AgentAttachmentStoreConfig) (*S3AgentAttachmentStore, error) {
	if err := validateS3AgentAttachmentStoreConfig(config); err != nil {
		return nil, err
	}
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = newAgentAttachmentHTTPClient()
	}
	options := s3.Options{
		Region:       strings.TrimSpace(config.Region),
		Credentials:  credentials.NewStaticCredentialsProvider(strings.TrimSpace(config.AccessKeyID), strings.TrimSpace(config.SecretAccessKey), ""),
		HTTPClient:   httpClient,
		UsePathStyle: config.ForcePathStyle,
		Retryer:      retry.NewStandard(func(options *retry.StandardOptions) { options.MaxAttempts = 3 }),
	}
	if endpoint := strings.TrimSpace(config.Endpoint); endpoint != "" {
		options.BaseEndpoint = aws.String(strings.TrimRight(endpoint, "/"))
	}
	client := s3.New(options)
	return &S3AgentAttachmentStore{
		bucket:    strings.TrimSpace(config.Bucket),
		client:    client,
		presigner: awsS3Presigner{value: s3.NewPresignClient(client)},
	}, nil
}

func validateS3AgentAttachmentStoreConfig(config S3AgentAttachmentStoreConfig) error {
	if strings.TrimSpace(config.Bucket) == "" || strings.ContainsAny(config.Bucket, "/\\\x00\r\n") {
		return errors.New("agent attachment S3 bucket is required and must not contain path separators")
	}
	if strings.TrimSpace(config.Region) == "" {
		return errors.New("agent attachment S3 region is required (use auto for Cloudflare R2)")
	}
	if strings.TrimSpace(config.AccessKeyID) == "" || strings.TrimSpace(config.SecretAccessKey) == "" {
		return errors.New("agent attachment S3 credentials are required")
	}
	if !config.BucketPrivate {
		return errors.New("document bucket must be private; set S3_PRIVATE=true only after public access is disabled")
	}
	if config.LifecycleMaxDays < 1 || config.LifecycleMaxDays > 2 {
		return errors.New("agent attachment bucket needs a provider lifecycle rule deleting objects after at most 2 days")
	}
	if endpoint := strings.TrimSpace(config.Endpoint); endpoint != "" {
		parsed, err := url.Parse(endpoint)
		if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
			return errors.New("agent attachment S3 endpoint must be an origin URL without credentials, path, query, or fragment")
		}
		if parsed.Scheme != "https" && !(config.AllowInsecureLocal && parsed.Scheme == "http" && isLoopbackAttachmentHost(parsed.Hostname())) {
			return errors.New("agent attachment S3 endpoint must use HTTPS")
		}
	}
	return nil
}

func isLoopbackAttachmentHost(host string) bool {
	return strings.EqualFold(host, "localhost") || net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback()
}

func newAgentAttachmentHTTPClient() *http.Client {
	return &http.Client{Transport: &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2:     true,
		TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		IdleConnTimeout:       60 * time.Second,
		MaxIdleConns:          50,
		MaxIdleConnsPerHost:   10,
	}}
}

func (s *S3AgentAttachmentStore) PresignPut(ctx context.Context, objectKey string, byteSize int64, mediaType, ciphertextSHA256 string, expiresAt time.Time) (AgentObjectUpload, error) {
	if !validS3AgentObjectKey(objectKey) || byteSize < 1 || byteSize > dbMaxAgentCiphertextBytes || !sha256Pattern.MatchString(ciphertextSHA256) {
		return AgentObjectUpload{}, errors.New("invalid attachment upload constraints")
	}
	duration := time.Until(expiresAt)
	if duration <= 0 || duration > 24*time.Hour {
		return AgentObjectUpload{}, errors.New("invalid attachment upload expiry")
	}
	checksumBytes, _ := hex.DecodeString(ciphertextSHA256)
	checksum := base64.StdEncoding.EncodeToString(checksumBytes)
	contentLength := byteSize
	input := &s3.PutObjectInput{
		Bucket:         aws.String(s.bucket),
		Key:            aws.String(objectKey),
		ContentLength:  &contentLength,
		ContentType:    aws.String(mediaType),
		ChecksumSHA256: aws.String(checksum),
		Metadata:       map[string]string{agentCiphertextSHA256MetadataKey: ciphertextSHA256},
	}
	request, err := s.presigner.PresignPutObject(ctx, input, func(options *s3.PresignOptions) { options.Expires = duration })
	if err != nil {
		return AgentObjectUpload{}, fmt.Errorf("presign agent attachment upload: %w", err)
	}
	headers := make(map[string]string, len(request.SignedHeader)+1)
	for key, values := range request.SignedHeader {
		if len(values) > 0 {
			headers[key] = values[0]
		}
	}
	// Some SDK versions encode content length into the signature without
	// returning it in SignedHeader. Always tell the desktop the exact body size.
	headers["Content-Length"] = strconv.FormatInt(byteSize, 10)
	return AgentObjectUpload{URL: request.URL, Method: request.Method, Headers: headers, ExpiresAt: expiresAt.UTC()}, nil
}

func (s *S3AgentAttachmentStore) Put(ctx context.Context, objectKey string, body io.Reader, byteSize int64, mediaType, ciphertextSHA256 string) error {
	if !validS3AgentObjectKey(objectKey) || byteSize < 1 || byteSize > dbMaxAgentCiphertextBytes || !sha256Pattern.MatchString(ciphertextSHA256) {
		return errors.New("invalid attachment upload constraints")
	}
	checksumBytes, _ := hex.DecodeString(ciphertextSHA256)
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(s.bucket), Key: aws.String(objectKey), Body: body,
		ContentLength: aws.Int64(byteSize), ContentType: aws.String(mediaType),
		ChecksumSHA256: aws.String(base64.StdEncoding.EncodeToString(checksumBytes)),
		Metadata:       map[string]string{agentCiphertextSHA256MetadataKey: ciphertextSHA256},
	})
	return mapS3AgentAttachmentError(err)
}

func (s *S3AgentAttachmentStore) Head(ctx context.Context, objectKey string) (AgentObjectMetadata, error) {
	if !validS3AgentObjectKey(objectKey) {
		return AgentObjectMetadata{}, ErrAgentObjectNotFound
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	output, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(objectKey)})
	if err != nil {
		return AgentObjectMetadata{}, mapS3AgentAttachmentError(err)
	}
	return s3AgentObjectMetadata(output.ContentLength, output.Metadata)
}

func (s *S3AgentAttachmentStore) Open(ctx context.Context, objectKey string) (io.ReadCloser, AgentObjectMetadata, error) {
	if !validS3AgentObjectKey(objectKey) {
		return nil, AgentObjectMetadata{}, ErrAgentObjectNotFound
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	output, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(objectKey)})
	if err != nil {
		cancel()
		return nil, AgentObjectMetadata{}, mapS3AgentAttachmentError(err)
	}
	metadata, err := s3AgentObjectMetadata(output.ContentLength, output.Metadata)
	if err != nil {
		cancel()
		_ = output.Body.Close()
		return nil, AgentObjectMetadata{}, err
	}
	return &cancelOnCloseReadCloser{ReadCloser: output.Body, cancel: cancel}, metadata, nil
}

func (s *S3AgentAttachmentStore) Delete(ctx context.Context, objectKey string) error {
	if !validS3AgentObjectKey(objectKey) {
		return ErrAgentObjectNotFound
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(objectKey)})
	return mapS3AgentAttachmentError(err)
}

type cancelOnCloseReadCloser struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (r *cancelOnCloseReadCloser) Close() error {
	err := r.ReadCloser.Close()
	r.cancel()
	return err
}

func s3AgentObjectMetadata(byteSize *int64, metadata map[string]string) (AgentObjectMetadata, error) {
	if byteSize == nil || *byteSize < 1 {
		return AgentObjectMetadata{}, errors.New("agent attachment object is missing content length")
	}
	digest := strings.ToLower(strings.TrimSpace(metadata[agentCiphertextSHA256MetadataKey]))
	if !sha256Pattern.MatchString(digest) {
		return AgentObjectMetadata{}, errors.New("agent attachment object is missing ciphertext digest metadata")
	}
	return AgentObjectMetadata{ByteSize: *byteSize, CiphertextSHA256: digest}, nil
}

func mapS3AgentAttachmentError(err error) error {
	if err == nil {
		return nil
	}
	var responseError *smithyhttp.ResponseError
	if errors.As(err, &responseError) && responseError.HTTPStatusCode() == http.StatusNotFound {
		return ErrAgentObjectNotFound
	}
	var apiError smithy.APIError
	if errors.As(err, &apiError) {
		switch strings.ToLower(apiError.ErrorCode()) {
		case "nosuchkey", "notfound", "no_such_key":
			return ErrAgentObjectNotFound
		}
	}
	return err
}

func validS3AgentObjectKey(key string) bool {
	if len(key) < 10 || len(key) > 512 || !strings.HasPrefix(key, "agents/") || strings.Contains(key, "..") || strings.ContainsAny(key, "\\\x00\r\n") {
		return false
	}
	for _, segment := range strings.Split(key, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
	}
	return true
}

const dbMaxAgentCiphertextBytes = int64(50<<20) + maxCiphertextOverhead
