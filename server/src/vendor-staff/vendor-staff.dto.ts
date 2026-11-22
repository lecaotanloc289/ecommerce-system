import {
  PageQuerySchema,
  UserIdSchema,
  VendorInvitationAcceptResultSchema,
  VendorInvitationAcceptSchema,
  VendorInvitationCreateSchema,
  VendorInvitationIdSchema,
  VendorInvitationPageSchema,
  VendorInvitationSchema,
  VendorStaffMemberSchema,
} from '@repo/core';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class InvitationCreateDto extends createZodDto(VendorInvitationCreateSchema) {}
export class InvitationDto extends createZodDto(VendorInvitationSchema) {}
export class InvitationPageDto extends createZodDto(VendorInvitationPageSchema) {}
export class InvitationQueryDto extends createZodDto(PageQuerySchema) {}
export class InvitationParamsDto extends createZodDto(z.object({ id: VendorInvitationIdSchema })) {}
export class InvitationAcceptDto extends createZodDto(VendorInvitationAcceptSchema) {}
export class InvitationAcceptResultDto extends createZodDto(VendorInvitationAcceptResultSchema) {}
export class StaffListDto extends createZodDto(z.array(VendorStaffMemberSchema)) {}
export class StaffParamsDto extends createZodDto(z.object({ userId: UserIdSchema })) {}
