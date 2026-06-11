-- Platform coupons (vendor_id IS NULL) must have globally-unique codes.
-- The composite UNIQUE(vendor_id, code) does NOT enforce this: Postgres treats
-- NULL as distinct, so two platform coupons could share a code. A partial unique
-- index closes that gap while leaving vendor-scoped codes governed by the composite.
CREATE UNIQUE INDEX "coupons_platform_code_key"
  ON "coupons" ("code")
  WHERE "vendor_id" IS NULL;
