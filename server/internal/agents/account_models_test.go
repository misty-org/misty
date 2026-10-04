package agent

import (
 "context"
 "encoding/json"
 "errors"
 "io"
 "net/http"
 "strings"
 "testing"
 "github.com/kannachi323/misty/server/internal/aimodels"
)

func TestAccountLibraryUsesResponsesAndDisabledFallbackMakesNoCall(t *testing.T){
 calls:=0
 analyzer:=(&SmartLibraryAnalyzer{ModelResolver:func(ctx context.Context,user,role string)(*aimodels.Resolved,error){
  if user!="owner"{t.Fatal("wrong account")};if role=="library-fallback"{return nil,aimodels.ErrDisabled}
  return &aimodels.Resolved{Provider:"openai",Model:"openai/gpt-6-luna",BaseURL:"https://api.openai.com/v1",APIKey:"fixture",Reasoning:"low"},nil
 },Client:&http.Client{Transport:voiceTransport(func(r *http.Request)(*http.Response,error){
  calls++;if r.URL.String()!="https://api.openai.com/v1/responses" || r.Header.Get("Authorization")!="Bearer fixture"{t.Fatal("wrong endpoint or credential")}
  var body map[string]any;if json.NewDecoder(r.Body).Decode(&body)!=nil || body["model"]!="gpt-6-luna"{t.Fatal("native model ID missing")}
  if body["reasoning"].(map[string]any)["effort"]!="low"{t.Fatal("reasoning choice ignored")}
  return &http.Response{StatusCode:200,Body:io.NopCloser(strings.NewReader(`{"output_text":"{\"assets\":[]}","usage":{"input_tokens":3,"output_tokens":2}}`)),Header:http.Header{}},nil
 })}}).WithAIAccount("owner")
 analysis,err:=analyzer.Analyze(t.Context(),[]SmartLibraryAsset{{AssetID:"asset",AssetKind:"text",ExtractedText:"hello"}})
 if err!=nil || calls!=1 || len(analysis.Failures)!=1{t.Fatal("disabled fallback made an extra attempt",calls,err)}
}
func TestAccountEmbeddingUsesSelectedModelAndImageDescription(t *testing.T){
 calls:=0
 analyzer:=(&SmartLibraryAnalyzer{ModelResolver:func(ctx context.Context,user,role string)(*aimodels.Resolved,error){
  if user!="owner" || role!="embedding"{t.Fatal("wrong embedding authority")}
  return &aimodels.Resolved{Provider:"openai",Model:"openai/text-embedding-3-small",BaseURL:"https://api.openai.com/v1",APIKey:"fixture"},nil
 },Client:&http.Client{Transport:voiceTransport(func(r *http.Request)(*http.Response,error){
  calls++;if r.URL.Path!="/v1/embeddings"{t.Fatal("wrong embedding endpoint")}
  var body map[string]any;_ = json.NewDecoder(r.Body).Decode(&body)
  if body["model"]!="text-embedding-3-small" || body["dimensions"]!=float64(SmartLibraryEmbeddingDims){t.Fatal("embedding model or dimensions ignored")}
  input,ok:=body["input"].([]any);if !ok || len(input)!=1{t.Fatal("wrong input")};if _,ok=input[0].(string);!ok{t.Fatal("image bytes sent to a text embedding model")}
  raw,_:=json.Marshal(map[string]any{"data":[]any{map[string]any{"embedding":make([]float64,SmartLibraryEmbeddingDims)}},"usage":map[string]int{"prompt_tokens":3}})
  return &http.Response{StatusCode:200,Body:io.NopCloser(strings.NewReader(string(raw))),Header:http.Header{}},nil
 })}}).WithAIAccount("owner")
 embeddings,_,err:=analyzer.EmbedAssets(t.Context(),[]SmartLibraryAsset{{AssetID:"asset",AssetKind:"image",MimeType:"image/png",Bytes:[]byte("fixture-image")}},map[string]SmartLibraryMetadata{"asset":{Description:"A red bicycle"}})
 if err!=nil || calls!=1 || len(embeddings)!=1 || embeddings[0].Model!="openai/text-embedding-3-small"{t.Fatal("selected embedding model was not recorded",err)}
}
func TestDisabledAccountTranscriptionRetryDoesNotContactAnotherModel(t *testing.T){
 calls:=0
 analyzer:=(&SmartLibraryAnalyzer{ModelResolver:func(ctx context.Context,user,role string)(*aimodels.Resolved,error){
  if role=="transcription-fallback"{return nil,aimodels.ErrDisabled}
  return &aimodels.Resolved{Provider:"openai",Model:"openai/gpt-4o-mini-transcribe",BaseURL:"https://api.openai.com/v1",APIKey:"fixture"},nil
 },Client:&http.Client{Transport:voiceTransport(func(r *http.Request)(*http.Response,error){calls++;if r.URL.Path!="/v1/audio/transcriptions"{t.Fatal("wrong transcription endpoint")};return &http.Response{StatusCode:503,Body:io.NopCloser(strings.NewReader("unavailable")),Header:http.Header{}},nil})}}).WithAIAccount("owner")
 _,_,_,err:=analyzer.TranscribeAgentVoiceWithUsage(t.Context(),[]byte("audio"),"audio/webm",1000)
 var providerErr *SpeechProviderError
 if !errors.As(err,&providerErr) || calls!=1{t.Fatal("disabled retry called another provider",calls,err)}
}
