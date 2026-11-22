#!/bin/sh
# Creates the local buckets: `kyc` (private) and `media` (anonymous read). Safe to re-run.
set -eu
ENDPOINT="http://s3:9000"
S3="aws --endpoint-url $ENDPOINT s3api"

i=0
until $S3 list-buckets >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "s3 not reachable at $ENDPOINT" >&2
    exit 1
  fi
  sleep 1
done

for b in kyc media; do
  $S3 head-bucket --bucket "$b" 2>/dev/null || $S3 create-bucket --bucket "$b" >/dev/null
done

$S3 put-bucket-policy --bucket media --policy '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":["s3:GetObject"],"Resource":["arn:aws:s3:::media/*"]}]}'
echo "buckets ready: kyc (private), media (public read)"
