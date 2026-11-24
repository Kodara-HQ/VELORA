export * from './permissions';

/** Envelope every API response uses. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiError {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AuthUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  roles: string[];
  permissions: string[];
  vendorId: number | null;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
  /** Only returned to mobile clients; web clients receive it as an httpOnly cookie. */
  refreshToken?: string;
}

export const DEFAULT_CURRENCY = 'GHS';

export const GHANA_REGIONS = [
  'Greater Accra', 'Ashanti', 'Western', 'Western North', 'Central', 'Eastern', 'Volta', 'Oti',
  'Northern', 'Savannah', 'North East', 'Upper East', 'Upper West', 'Bono', 'Bono East', 'Ahafo',
] as const;
