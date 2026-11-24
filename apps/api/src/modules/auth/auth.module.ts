import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrincipalService } from './principal.service';
import { TokensService } from './tokens.service';
import { CartModule } from '../cart/cart.module';
import type { Env } from '../../config/env';

@Global()
@Module({
  imports: [
    CartModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { issuer: 'velora-api', audience: 'velora' },
        verifyOptions: { issuer: 'velora-api', audience: 'velora', algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokensService, PrincipalService],
  exports: [PrincipalService, TokensService, JwtModule],
})
export class AuthModule {}
