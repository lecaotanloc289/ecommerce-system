import pg from 'pg';

/**
 * Rows the e2e suite needs on top of `pnpm db:seed`: a customer with a PENDING vendor
 * application (flow e — "admin approves a vendor application"). Inserted with plain SQL against
 * the throwaway e2e database; ids are fixed so a re-run is a no-op. The KYC "document keys" are
 * placeholders: nothing in the flow dereferences them unless the reviewer opens the document links.
 */
export const E2E_IDS = {
  applicantUser: '01E2E00000000000000000001A',
  applicantRole: '01E2E00000000000000000001B',
  application: '01E2E00000000000000000001C',
  customerAddress: '01E2E00000000000000000001D',
} as const;

/** `SEED_IDS.demoUser` of `@repo/db` (kept literal: e2e does not depend on the Prisma package). */
const DEMO_CUSTOMER_ID = '01SEED00000000000000000002';

export async function seedExtra(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, email, name, primary_locale, created_at, updated_at)
       VALUES ($1, 'applicant@example.com', 'Applicant Demo', 'VI', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [E2E_IDS.applicantUser],
    );
    await client.query(
      `INSERT INTO user_roles (id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, 'CUSTOMER', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [E2E_IDS.applicantRole, E2E_IDS.applicantUser],
    );
    // The seeded demo customer has no address; give it one so checkout can start straight away.
    await client.query(
      `INSERT INTO addresses
         (id, user_id, recipient_name, phone, line1, ward, district, city, country, is_default,
          created_at, updated_at)
       VALUES ($1, $2, 'Demo Customer', '0901234567', '1 Nguyen Hue', 'Ben Nghe', 'District 1',
               'Ho Chi Minh City', 'VN', true, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [E2E_IDS.customerAddress, DEMO_CUSTOMER_ID],
    );
    await client.query(
      `INSERT INTO vendor_applications
         (id, applicant_id, status, business_license_url, tax_id, national_id_number,
          national_id_url, bank_name, bank_account_number, account_holder, created_at, updated_at)
       VALUES ($1, $2, 'PENDING', $3, '0312345678', '079123456789', $4,
               'Vietcombank', '0011001234567', 'APPLICANT DEMO', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [
        E2E_IDS.application,
        E2E_IDS.applicantUser,
        `kyc/${E2E_IDS.applicantUser}/e2e-license.pdf`,
        `kyc/${E2E_IDS.applicantUser}/e2e-national-id.pdf`,
      ],
    );
  } finally {
    await client.end();
  }
}
