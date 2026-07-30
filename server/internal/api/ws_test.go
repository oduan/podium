package api

import "testing"

func TestValidatePromptImageContract(t *testing.T) {
	valid := map[string]any{
		"message": "look",
		"images": []any{map[string]any{
			"type": "image", "data": "YQ==", "mimeType": "image/png",
		}},
	}
	if err := validateCommand("prompt", valid); err != nil {
		t.Fatalf("valid image contract rejected: %v", err)
	}
	invalid := map[string]any{
		"message": "look",
		"images": []any{map[string]any{
			"data": "YQ==", "mediaType": "image/png",
		}},
	}
	if err := validateCommand("prompt", invalid); err == nil {
		t.Fatal("legacy mediaType image contract was accepted")
	}
}

func TestValidateExtensionResponseContract(t *testing.T) {
	for _, response := range []map[string]any{
		{"id": "one", "value": "choice"},
		{"id": "two", "confirmed": false},
		{"id": "three", "cancelled": true},
	} {
		if err := validateExtensionResponse(response); err != nil {
			t.Fatalf("valid extension response rejected: %v", err)
		}
	}
	if err := validateExtensionResponse(map[string]any{"id": "old", "response": "choice"}); err == nil {
		t.Fatal("legacy response field was accepted")
	}
	if err := validateExtensionResponse(map[string]any{"id": "ambiguous", "value": "x", "cancelled": true}); err == nil {
		t.Fatal("ambiguous extension response was accepted")
	}
}
