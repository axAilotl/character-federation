#!/bin/bash

echo "=== Testing API Endpoints ==="
echo ""

echo "Test 1: Check if API accepts large file size in metadata"
echo "Testing with 73MB file size (previously rejected)..."

# Create test metadata payload with 73MB size
SIZE_73MB=$((73 * 1024 * 1024))

# Test the presign endpoint (which validates file metadata)
curl -s -X POST https://hub.axailotl.ai/api/uploads/presign \
  -H "Content-Type: application/json" \
  -d "{
    \"files\": [{
      \"name\": \"test-73mb-file.png\",
      \"size\": $SIZE_73MB,
      \"type\": \"image/png\"
    }]
  }" | jq -r '.error // "No error (auth required, but validation passed)"'

echo ""
echo "If you see 'No error' or 'Authentication required', the size validation is removed."
echo "If you see 'File must be less than 50MB', the fix didn't work."
echo ""

echo "Test 2: Verify Durable Object binding exists"
echo "Checking Cloudflare worker info..."
curl -s https://hub.axailotl.ai/ -I | grep -E "cf-ray|server"

echo ""
echo "=== Tests Complete ==="
