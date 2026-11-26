import { z } from 'zod';

/** UTC ISO-8601 timestamp as it travels over JSON (`Date#toISOString()` output). */
export const IsoDateTimeSchema = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;
