#!/bin/bash

echo "=== Verification Script for hub.axailotl.ai ==="
echo ""

# Wait for Cloudflare build to complete
echo "Waiting 2 minutes for Cloudflare build to complete..."
sleep 120

echo ""
echo "=== Test 1: Check if site is accessible ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://hub.axailotl.ai/)
if [ "$STATUS" = "200" ]; then
  echo "✅ Site is UP (HTTP 200)"
else
  echo "❌ Site returned HTTP $STATUS"
fi

echo ""
echo "=== Test 2: Check upload page ==="
UPLOAD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://hub.axailotl.ai/upload)
if [ "$UPLOAD_STATUS" = "200" ]; then
  echo "✅ Upload page accessible (HTTP 200)"
else
  echo "❌ Upload page returned HTTP $UPLOAD_STATUS"
fi

echo ""
echo "=== Test 3: Check if JavaScript bundle has new 40MB threshold ==="
# Fetch the main JS bundle and check for the threshold value
BUNDLE=$(curl -s https://hub.axailotl.ai/upload | grep -o 'src="/_next/static/chunks/.*\.js"' | head -1 | sed 's/.*src="\(.*\)".*/\1/')
if [ -n "$BUNDLE" ]; then
  echo "Found bundle: $BUNDLE"
  THRESHOLD_CHECK=$(curl -s "https://hub.axailotl.ai$BUNDLE" | grep -o "41943040\|40\*1024\*1024" || echo "")
  if [ -n "$THRESHOLD_CHECK" ]; then
    echo "✅ Found 40MB threshold in bundle (40*1024*1024 = 41943040)"
  else
    echo "⚠️  Could not find 40MB threshold - bundle may not be updated yet"
  fi
else
  echo "⚠️  Could not find JS bundle"
fi

echo ""
echo "=== Test 4: Test API - check if 50MB validation removed ==="
# The API should now accept metadata without size validation
echo "This requires manual upload test with 73MB file"
echo "Expected: File should use chunked upload automatically"

echo ""
echo "=== Deployment Verification Complete ==="
echo ""
echo "Manual test required:"
echo "1. Go to https://hub.axailotl.ai/upload"
echo "2. Try uploading a 73MB file"
echo "3. It should use chunked upload (shows 'Uploading chunk X/Y')"
echo "4. Should NOT show 'File must be less than 50MB' error"
