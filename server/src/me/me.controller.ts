import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Address, MeResponse } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import { MeResponseDto } from '../auth/auth.dto';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { BEARER_AUTH } from '../openapi/openapi';
import { AddressesService } from './addresses.service';
import {
  AddressDto,
  AddressInputDto,
  AddressListDto,
  AddressParamsDto,
  AddressUpdateDto,
  ProfileUpdateDto,
} from './me.dto';
import { MeService } from './me.service';

/** Customer profile + address book. Ownership always from the JWT, never from the client. */
@ApiTags('me')
@ApiBearerAuth(BEARER_AUTH)
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly addresses: AddressesService,
  ) {}

  @ApiOperation({ summary: 'Update own profile (name, primaryLocale)' })
  @ZodResponse({ status: 200, description: 'Updated profile', type: MeResponseDto })
  @Patch()
  @Idempotent()
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() body: ProfileUpdateDto,
  ): Promise<MeResponse> {
    return this.me.updateProfile(user.id, body);
  }

  @ApiOperation({ summary: 'List own addresses (default first, then newest)' })
  @ZodResponse({ status: 200, description: 'Addresses', type: AddressListDto })
  @Get('addresses')
  list(@CurrentUser() user: AuthUser): Promise<Address[]> {
    return this.addresses.list(user.id);
  }

  @ApiOperation({ summary: 'Add an address (the first one becomes the default)' })
  @ZodResponse({ status: 201, description: 'Created address', type: AddressDto })
  @Post('addresses')
  @Idempotent()
  create(@CurrentUser() user: AuthUser, @Body() body: AddressInputDto): Promise<Address> {
    return this.addresses.create(user.id, body);
  }

  @ApiOperation({ summary: 'Partially update an own address' })
  @ZodResponse({ status: 200, description: 'Updated address', type: AddressDto })
  @Patch('addresses/:id')
  @Idempotent()
  update(
    @CurrentUser() user: AuthUser,
    @Param() params: AddressParamsDto,
    @Body() body: AddressUpdateDto,
  ): Promise<Address> {
    return this.addresses.update(user.id, params.id, body);
  }

  @ApiOperation({ summary: 'Delete an own address (deleting the default promotes the newest)' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @Delete('addresses/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param() params: AddressParamsDto): Promise<void> {
    return this.addresses.remove(user.id, params.id);
  }

  @ApiOperation({ summary: 'Make an own address the default' })
  @ZodResponse({ status: 200, description: 'The new default address', type: AddressDto })
  @Post('addresses/:id/default')
  @HttpCode(200)
  @Idempotent()
  setDefault(@CurrentUser() user: AuthUser, @Param() params: AddressParamsDto): Promise<Address> {
    return this.addresses.setDefault(user.id, params.id);
  }
}
