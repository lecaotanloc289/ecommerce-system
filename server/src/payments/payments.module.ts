import { Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import { PaymentConfirmationService } from './payment-confirmation.service';
import { createPaymentProviders, PAYMENT_PROVIDERS } from './payment-providers';
import { PaymentWebhooksController } from './payment-webhooks.controller';
import { PaymentWebhooksService } from './payment-webhooks.service';

/**
 * Payment webhooks + confirmation (T3.1). Exports `PaymentConfirmationService` (zero-amount
 * confirmation) and the `PAYMENT_PROVIDERS` map.
 */
@Module({
  controllers: [PaymentWebhooksController],
  providers: [
    { provide: PAYMENT_PROVIDERS, inject: [ENV], useFactory: createPaymentProviders },
    PaymentConfirmationService,
    PaymentWebhooksService,
  ],
  exports: [PaymentConfirmationService, PAYMENT_PROVIDERS],
})
export class PaymentsModule {}
