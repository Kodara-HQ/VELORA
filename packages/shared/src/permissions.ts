/**
 * Single source of truth for authorisation.
 * The API seeds these into `permissions` / `role_permissions` and enforces them in guards.
 * The web and mobile apps use them only to decide what to SHOW — never as the security boundary.
 */
export const PERMISSIONS = {
  // Administration
  DASHBOARD_VIEW: 'dashboard.view',
  USERS_VIEW: 'users.view',
  USERS_MANAGE: 'users.manage',
  ROLES_VIEW: 'roles.view',
  ROLES_MANAGE: 'roles.manage',
  AUDIT_VIEW: 'audit.view',
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',
  // Catalogue
  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_UPDATE: 'products.update',
  PRODUCTS_DELETE: 'products.delete',
  PRODUCTS_APPROVE: 'products.approve',
  CATEGORIES_MANAGE: 'categories.manage',
  BRANDS_MANAGE: 'brands.manage',
  REVIEWS_MODERATE: 'reviews.moderate',
  // Inventory
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_ADJUST: 'inventory.adjust',
  INVENTORY_TRANSFER: 'inventory.transfer',
  WAREHOUSES_MANAGE: 'warehouses.manage',
  SUPPLIERS_MANAGE: 'suppliers.manage',
  PURCHASE_ORDERS_MANAGE: 'purchase_orders.manage',
  GOODS_RECEIVE: 'goods.receive',
  // Orders & fulfilment
  ORDERS_VIEW: 'orders.view',
  ORDERS_MANAGE: 'orders.manage',
  ORDERS_CANCEL: 'orders.cancel',
  SHIPMENTS_MANAGE: 'shipments.manage',
  RETURNS_VIEW: 'returns.view',
  RETURNS_MANAGE: 'returns.manage',
  // Customers
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_MANAGE: 'customers.manage',
  // Marketplace
  VENDORS_VIEW: 'vendors.view',
  VENDORS_MANAGE: 'vendors.manage',
  VENDORS_APPROVE: 'vendors.approve',
  // Finance
  FINANCE_VIEW: 'finance.view',
  PAYMENTS_VIEW: 'payments.view',
  REFUNDS_PROCESS: 'refunds.process',
  SETTLEMENTS_MANAGE: 'settlements.manage',
  FINANCE_EXPORT: 'finance.export',
  // Marketing
  PROMOTIONS_MANAGE: 'promotions.manage',
  COUPONS_MANAGE: 'coupons.manage',
  LOYALTY_MANAGE: 'loyalty.manage',
  NOTIFICATIONS_SEND: 'notifications.send',
  ANALYTICS_VIEW: 'analytics.view',
  // Vendor portal (always scoped to the vendor's own records)
  VENDOR_PORTAL_ACCESS: 'vendor_portal.access',
  VENDOR_PRODUCTS_MANAGE: 'vendor_portal.products',
  VENDOR_ORDERS_VIEW: 'vendor_portal.orders',
  VENDOR_REPORTS_VIEW: 'vendor_portal.reports',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  PRODUCT_MANAGER: 'product_manager',
  INVENTORY_MANAGER: 'inventory_manager',
  ORDER_MANAGER: 'order_manager',
  FINANCE_OFFICER: 'finance_officer',
  CUSTOMER_SUPPORT: 'customer_support',
  MARKETING_MANAGER: 'marketing_manager',
  WAREHOUSE_OFFICER: 'warehouse_officer',
  VENDOR: 'vendor',
  CUSTOMER: 'customer',
} as const;

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];

const P = PERMISSIONS;
const isVendorPortal = (p: string) => p.startsWith('vendor_portal.');

export const ROLE_DEFINITIONS: Record<RoleCode, { name: string; description: string; permissions: Permission[] }> = {
  super_admin: {
    name: 'Super Administrator',
    description: 'Unrestricted back-office access, including roles, permissions and system settings.',
    permissions: ALL_PERMISSIONS.filter((p) => !isVendorPortal(p)),
  },
  admin: {
    name: 'Administrator',
    description: 'Runs day-to-day operations. Cannot change roles or core system settings.',
    permissions: ALL_PERMISSIONS.filter(
      (p) => !isVendorPortal(p) && p !== P.ROLES_MANAGE && p !== P.SETTINGS_MANAGE,
    ),
  },
  product_manager: {
    name: 'Product Manager',
    description: 'Owns the catalogue: products, categories, brands and review moderation.',
    permissions: [P.DASHBOARD_VIEW, P.PRODUCTS_VIEW, P.PRODUCTS_CREATE, P.PRODUCTS_UPDATE, P.PRODUCTS_DELETE,
      P.PRODUCTS_APPROVE, P.CATEGORIES_MANAGE, P.BRANDS_MANAGE, P.REVIEWS_MODERATE, P.INVENTORY_VIEW, P.ANALYTICS_VIEW],
  },
  inventory_manager: {
    name: 'Inventory Manager',
    description: 'Stock levels, warehouses, transfers, suppliers and purchasing.',
    permissions: [P.DASHBOARD_VIEW, P.PRODUCTS_VIEW, P.INVENTORY_VIEW, P.INVENTORY_ADJUST, P.INVENTORY_TRANSFER,
      P.WAREHOUSES_MANAGE, P.SUPPLIERS_MANAGE, P.PURCHASE_ORDERS_MANAGE, P.GOODS_RECEIVE],
  },
  order_manager: {
    name: 'Order Manager',
    description: 'Processes orders, shipments and returns.',
    permissions: [P.DASHBOARD_VIEW, P.ORDERS_VIEW, P.ORDERS_MANAGE, P.ORDERS_CANCEL, P.SHIPMENTS_MANAGE,
      P.RETURNS_VIEW, P.RETURNS_MANAGE, P.CUSTOMERS_VIEW, P.PRODUCTS_VIEW, P.INVENTORY_VIEW],
  },
  finance_officer: {
    name: 'Finance Officer',
    description: 'Payments, refunds, commissions, settlements and financial exports.',
    permissions: [P.DASHBOARD_VIEW, P.FINANCE_VIEW, P.PAYMENTS_VIEW, P.REFUNDS_PROCESS, P.SETTLEMENTS_MANAGE,
      P.FINANCE_EXPORT, P.ORDERS_VIEW, P.VENDORS_VIEW, P.ANALYTICS_VIEW],
  },
  customer_support: {
    name: 'Customer Support',
    description: 'Helps customers with orders, returns and accounts.',
    permissions: [P.ORDERS_VIEW, P.CUSTOMERS_VIEW, P.RETURNS_VIEW, P.RETURNS_MANAGE, P.PRODUCTS_VIEW, P.REVIEWS_MODERATE],
  },
  marketing_manager: {
    name: 'Marketing Manager',
    description: 'Campaigns, promotions, coupons, loyalty and customer messaging.',
    permissions: [P.DASHBOARD_VIEW, P.PROMOTIONS_MANAGE, P.COUPONS_MANAGE, P.LOYALTY_MANAGE, P.NOTIFICATIONS_SEND,
      P.ANALYTICS_VIEW, P.CUSTOMERS_VIEW, P.PRODUCTS_VIEW],
  },
  warehouse_officer: {
    name: 'Warehouse Officer',
    description: 'Picks, packs, receives goods and records stock movements.',
    permissions: [P.INVENTORY_VIEW, P.INVENTORY_ADJUST, P.GOODS_RECEIVE, P.ORDERS_VIEW, P.SHIPMENTS_MANAGE],
  },
  vendor: {
    name: 'Vendor',
    description: 'Marketplace seller. Sees only their own products, orders and payouts.',
    permissions: [P.VENDOR_PORTAL_ACCESS, P.VENDOR_PRODUCTS_MANAGE, P.VENDOR_ORDERS_VIEW, P.VENDOR_REPORTS_VIEW],
  },
  customer: {
    name: 'Customer',
    description: 'Shopper account. No back-office access.',
    permissions: [],
  },
};

/** Roles that grant access to the staff dashboard. */
export const STAFF_ROLES: RoleCode[] = [
  'super_admin', 'admin', 'product_manager', 'inventory_manager', 'order_manager',
  'finance_officer', 'customer_support', 'marketing_manager', 'warehouse_officer',
];
