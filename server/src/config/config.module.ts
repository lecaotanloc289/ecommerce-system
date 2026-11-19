import { Global, Module } from '@nestjs/common';
import { parseEnv, type Env } from './env';

/** Injection token for the validated, typed environment. Inject with `@Inject(ENV) env: Env`. */
export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => parseEnv(process.env) }],
  exports: [ENV],
})
export class ConfigModule {}
