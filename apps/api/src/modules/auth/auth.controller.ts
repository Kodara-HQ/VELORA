import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthTokens, AuthUser } from '@velora/shared';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto } from './dto/auth.dto';
import { CurrentUser, Public } from '../../common/decorators';
import { requestContext } from '../../common/utils/request';
import type { IssuedTokens } from './tokens.service';
import { CartService } from '../cart/cart.module';
import { readGuestId } from '../../common/viewer';
import type { Env } from '../../config/env';

export const REFRESH_COOKIE = 'velora_rt';
const COOKIE_PATH = '/api/v1/auth';
/**
 * Every auth call from a browser must send this header. Browsers cannot attach custom headers to
 * cross-site requests without a CORS preflight we would reject, so it doubles as CSRF protection
 * for the cookie-authenticated refresh/logout endpoints (alongside SameSite=Strict + Origin checks).
 */
export const CLIENT_HEADER = 'x-velora-client';

@ApiTags('Auth')
@ApiHeader({ name: CLIENT_HEADER, required: true, description: '"web" or "mobile"' })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly cart: CartService,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a customer account and start a session' })
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.register(dto, requestContext(req));
    await this.cart.mergeGuestCart(result.user.id, readGuestId(req.headers));
    return this.respond(req, res, result);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sign in. Sending X-Guest-Id merges that guest bag into the account.' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto, requestContext(req));
    await this.cart.mergeGuestCart(result.user.id, readGuestId(req.headers));
    return this.respond(req, res, result);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate the refresh token and get a new access token' })
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertTrustedClient(req);
    const presented = this.isMobile(req) ? dto.refreshToken : req.cookies?.[REFRESH_COOKIE];
    try {
      const result = await this.auth.refresh(presented, requestContext(req));
      return this.respond(req, res, result);
    } catch (e) {
      this.clearCookie(res);
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertTrustedClient(req);
    const presented = this.isMobile(req) ? dto.refreshToken : req.cookies?.[REFRESH_COOKIE];
    await this.auth.logout(presented, requestContext(req));
    this.clearCookie(res);
    return { loggedOut: true };
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign out of every device' })
  async logoutAll(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logoutEverywhere(user.id, requestContext(req));
    this.clearCookie(res);
    return { loggedOut: true };
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @ApiBearerAuth()
  @Get('login-activity')
  loginActivity(@CurrentUser() user: AuthUser) {
    return this.auth.loginActivity(user.id);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.auth.forgotPassword(dto.email, requestContext(req));
    return { message: 'If an account exists for that email, we have sent a link to reset the password.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    await this.auth.resetPassword(dto, requestContext(req));
    return { message: 'Your password has been updated. Please sign in.' };
  }

  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.changePassword(user.id, dto, requestContext(req));
    return this.respond(req, res, result);
  }

  // ─── helpers ───

  private isMobile(req: Request) {
    return req.headers[CLIENT_HEADER] === 'mobile';
  }

  /** Cookie-based endpoints accept only our own clients and allowed origins. */
  private assertTrustedClient(req: Request) {
    const client = req.headers[CLIENT_HEADER];
    if (client !== 'web' && client !== 'mobile') throw new ForbiddenException('Unrecognised client');
    const origin = req.headers.origin;
    if (client === 'web' && origin) {
      const allowed = this.config.get('CORS_ORIGINS', { infer: true }).split(',').map((s) => s.trim());
      if (!allowed.includes(origin)) throw new ForbiddenException('Origin not allowed');
    }
  }

  private respond(req: Request, res: Response, result: { user: AuthUser; tokens: IssuedTokens }) {
    const body: AuthTokens = { accessToken: result.tokens.accessToken, expiresIn: result.tokens.expiresIn };
    if (this.isMobile(req)) {
      body.refreshToken = result.tokens.refreshToken;
    } else {
      res.cookie(REFRESH_COOKIE, result.tokens.refreshToken, {
        httpOnly: true,
        secure: this.config.get('COOKIE_SECURE', { infer: true }),
        sameSite: 'strict',
        path: COOKIE_PATH,
        expires: result.tokens.refreshExpiresAt,
      });
    }
    return { user: result.user, tokens: body };
  }

  private clearCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH, httpOnly: true, sameSite: 'strict' });
  }
}
