import {
  CancelCrmCampaignSchema,
  CreateCrmCampaignSchema,
  CreateCustomerNoteSchema,
  CrmAutomationKindSchema,
  CrmAutomationSchema,
  CrmCampaignIdSchema,
  CrmCampaignPageSchema,
  CrmCampaignPreviewSchema,
  CrmCampaignSchema,
  CrmCustomerDetailSchema,
  CrmCustomerListQuerySchema,
  CrmCustomerPageSchema,
  CrmSegmentCountsSchema,
  PageQuerySchema,
  PlatformCrmCampaignListQuerySchema,
  ReplaceCustomerTagsSchema,
  ScheduleCrmCampaignSchema,
  UpdateCrmAutomationSchema,
  UpdateCrmCampaignSchema,
  UserIdSchema,
  VendorCustomerNoteIdSchema,
} from '@repo/core';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** DTOs of the CRM controllers — every shape lives in `@repo/core/schemas/crm`. */

/** One note of `CrmCustomerDetail.notes` (also the body of `POST …/notes`). */
export const CrmCustomerNoteSchema = CrmCustomerDetailSchema.shape.notes.element;
export type CrmCustomerNote = z.infer<typeof CrmCustomerNoteSchema>;

export class CrmCustomerListQueryDto extends createZodDto(CrmCustomerListQuerySchema) {}
export class CrmCustomerPageDto extends createZodDto(CrmCustomerPageSchema) {}
export class CrmCustomerDetailDto extends createZodDto(CrmCustomerDetailSchema) {}
export class CrmCustomerParamsDto extends createZodDto(z.object({ customerId: UserIdSchema })) {}
export class CrmCustomerNoteParamsDto extends createZodDto(
  z.object({ customerId: UserIdSchema, noteId: VendorCustomerNoteIdSchema }),
) {}
export class ReplaceCustomerTagsDto extends createZodDto(ReplaceCustomerTagsSchema) {}
export class CreateCustomerNoteDto extends createZodDto(CreateCustomerNoteSchema) {}
export class CrmCustomerNoteDto extends createZodDto(CrmCustomerNoteSchema) {}
export class CrmSegmentCountsDto extends createZodDto(CrmSegmentCountsSchema) {}

export class CrmAutomationDto extends createZodDto(CrmAutomationSchema) {}
export class CrmAutomationListDto extends createZodDto(z.array(CrmAutomationSchema)) {}
export class CrmAutomationParamsDto extends createZodDto(
  z.object({ kind: CrmAutomationKindSchema }),
) {}
export class UpdateCrmAutomationDto extends createZodDto(UpdateCrmAutomationSchema) {}

export class CrmCampaignDto extends createZodDto(CrmCampaignSchema) {}
export class CrmCampaignPageDto extends createZodDto(CrmCampaignPageSchema) {}
export class CrmCampaignParamsDto extends createZodDto(z.object({ id: CrmCampaignIdSchema })) {}
export class CrmCampaignListQueryDto extends createZodDto(PageQuerySchema) {}
export class CreateCrmCampaignDto extends createZodDto(CreateCrmCampaignSchema) {}
export class UpdateCrmCampaignDto extends createZodDto(UpdateCrmCampaignSchema) {}
export class ScheduleCrmCampaignDto extends createZodDto(ScheduleCrmCampaignSchema) {}
export class CrmCampaignPreviewDto extends createZodDto(CrmCampaignPreviewSchema) {}
export class CancelCrmCampaignDto extends createZodDto(CancelCrmCampaignSchema) {}
export class PlatformCrmCampaignListQueryDto extends createZodDto(
  PlatformCrmCampaignListQuerySchema,
) {}
