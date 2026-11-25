/* eslint-disable no-console */
/**
 * Development seed. Idempotent: safe to run repeatedly (reference data is upserted,
 * demo records are created only if missing). Never run against production.
 */
import { PrismaClient, Prisma, ProductStatus, VendorStatus, DiscountType, ApplicationStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { ALL_PERMISSIONS, ROLE_DEFINITIONS, RoleCode, GHANA_REGIONS } from '@velora/shared';

const prisma = new PrismaClient();

const SUPER_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@velora.test';
const SUPER_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD;

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run the development seed with NODE_ENV=production.');
}
if (!SUPER_PASSWORD || !DEMO_PASSWORD) {
  throw new Error('Set SEED_SUPER_ADMIN_PASSWORD and SEED_DEMO_PASSWORD in apps/api/.env before seeding.');
}

const slugify = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const img = (label: string, bg = 'EDE9E3') =>
  `https://placehold.co/800x1067/${bg}/111111/png?text=${encodeURIComponent(label)}&font=montserrat`;

async function seedAccessControl() {
  for (const code of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code, module: code.split('.')[0] },
    });
  }
  const perms = await prisma.permission.findMany();
  const permId = new Map(perms.map((p) => [p.code, p.id]));

  for (const [code, def] of Object.entries(ROLE_DEFINITIONS)) {
    const role = await prisma.role.upsert({
      where: { code },
      update: { name: def.name, description: def.description },
      create: { code, name: def.name, description: def.description, isSystem: true },
    });
    // System roles are re-synchronised with the shared definition on every seed.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (def.permissions.length) {
      await prisma.rolePermission.createMany({
        data: def.permissions.map((p) => ({ roleId: role.id, permissionId: permId.get(p)! })),
      });
    }
  }
  console.log(`✓ ${perms.length} permissions, ${Object.keys(ROLE_DEFINITIONS).length} roles`);
}

async function upsertUser(opts: {
  email: string; password: string; firstName: string; lastName: string; phone?: string; roles: RoleCode[];
}) {
  const existing = await prisma.user.findUnique({ where: { email: opts.email } });
  if (existing) return existing;
  const passwordHash = await argon2.hash(opts.password, { type: argon2.argon2id });
  const roles = await prisma.role.findMany({ where: { code: { in: opts.roles } } });
  const isCustomer = opts.roles.includes('customer');
  return prisma.user.create({
    data: {
      email: opts.email,
      phone: opts.phone,
      passwordHash,
      firstName: opts.firstName,
      lastName: opts.lastName,
      emailVerifiedAt: new Date(),
      referralCode: `VEL${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
      ...(isCustomer && {
        customer: { create: { marketingOptIn: true } },
        loyaltyAccount: { create: {} },
        wishlists: { create: { name: 'My Wishlist' } },
      }),
    },
  });
}

async function seedUsers() {
  await upsertUser({ email: SUPER_EMAIL, password: SUPER_PASSWORD!, firstName: 'Ama', lastName: 'Owusu', roles: ['super_admin'] });
  const staff: Array<[RoleCode, string, string]> = [
    ['admin', 'Kwame', 'Mensah'],
    ['product_manager', 'Efua', 'Asante'],
    ['inventory_manager', 'Yaw', 'Boateng'],
    ['order_manager', 'Akosua', 'Darko'],
    ['finance_officer', 'Kofi', 'Appiah'],
    ['customer_support', 'Abena', 'Ofori'],
    ['marketing_manager', 'Esi', 'Quaye'],
    ['warehouse_officer', 'Kojo', 'Addo'],
  ];
  for (const [role, firstName, lastName] of staff) {
    await upsertUser({ email: `${role.replace(/_/g, '-')}@staff.velora.test`, password: DEMO_PASSWORD!, firstName, lastName, roles: [role] });
  }
  const customers: Array<[string, string, string]> = [
    ['Adwoa', 'Nkansah', '+233241000001'],
    ['Nana', 'Agyeman', '+233201000002'],
    ['Selorm', 'Kpodo', '+233551000003'],
    ['Fatima', 'Issah', '+233271000004'],
    ['Ekow', 'Hagan', '+233501000005'],
  ];
  for (const [firstName, lastName, phone] of customers) {
    const user = await upsertUser({
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.test`,
      password: DEMO_PASSWORD!, firstName, lastName, phone, roles: ['customer'],
    });
    const hasAddress = await prisma.address.count({ where: { userId: user.id } });
    if (!hasAddress) {
      await prisma.address.create({
        data: {
          userId: user.id, label: 'Home', recipientName: `${firstName} ${lastName}`, phone,
          line1: '14 Oxford Street', city: 'Osu, Accra', region: 'Greater Accra',
          digitalAddress: 'GA-018-' + phone.slice(-4), isDefault: true,
        },
      });
    }
  }
  console.log(`✓ super admin, ${staff.length} staff, ${customers.length} customers`);
}

async function seedVendors() {
  const owner = await upsertUser({
    email: 'vendor@velora.test', password: DEMO_PASSWORD!, firstName: 'Akua', lastName: 'Sarpong',
    phone: '+233244000010', roles: ['vendor'],
  });
  const kente = await prisma.vendor.upsert({
    where: { slug: 'adinkra-atelier' },
    update: {},
    create: {
      ownerUserId: owner.id, businessName: 'Adinkra Atelier', slug: 'adinkra-atelier', email: 'vendor@velora.test',
      phone: '+233244000010', status: VendorStatus.ACTIVE, commissionRate: new Prisma.Decimal('12.50'),
      description: 'Contemporary African-print ready-to-wear, made in Kumasi.', verifiedAt: new Date(),
      payoutMethod: 'MOMO_MTN',
    },
  });
  const applicant = await upsertUser({
    email: 'applicant@velora.test', password: DEMO_PASSWORD!, firstName: 'Kweku', lastName: 'Annan', roles: ['customer'],
  });
  const hasApp = await prisma.vendorApplication.count({ where: { userId: applicant.id } });
  if (!hasApp) {
    await prisma.vendorApplication.create({
      data: {
        userId: applicant.id, businessName: 'Coastline Leather Co.', registrationNumber: 'CS123456789',
        contactPhone: '+233208000011', businessAddress: 'Takoradi Market Circle, Takoradi',
        productCategories: ['bags', 'shoes'], status: ApplicationStatus.SUBMITTED,
      },
    });
  }
  // Every vendor has its own stock location (code VND-<id>), as created on approval.
  await prisma.warehouse.upsert({
    where: { code: `VND-${kente.id}` },
    update: {},
    create: { code: `VND-${kente.id}`, name: 'Adinkra Atelier (vendor stock)', vendorId: kente.id, city: 'Kumasi', region: 'Ashanti', phone: '+233244000010' },
  });
  await prisma.vendor.update({ where: { id: kente.id }, data: { payoutDetails: { accountName: 'Akua Sarpong', number: '+233244000010' } } });
  console.log('✓ 1 active vendor, 1 pending application');
  return kente;
}

const CATEGORY_TREE: Array<{ name: string; children: string[] }> = [
  { name: "Women's Fashion", children: ['Dresses', 'Tops & Blouses', 'Skirts', 'Trousers & Jeans', 'Outerwear', 'Lingerie & Sleepwear'] },
  { name: "Men's Fashion", children: ['Shirts', 'T-Shirts & Polos', 'Trousers & Chinos', 'Suits & Blazers', 'Traditional Wear'] },
  { name: "Children's Fashion", children: ['Girls', 'Boys', 'Baby'] },
  { name: 'Shoes', children: ['Heels', 'Sneakers', 'Sandals & Slides', 'Formal Shoes'] },
  { name: 'Bags', children: ['Handbags', 'Tote Bags', 'Backpacks', 'Clutches'] },
  { name: 'Jewellery', children: ['Necklaces', 'Earrings', 'Bracelets', 'Rings'] },
  { name: 'Accessories', children: ['Sunglasses', 'Belts', 'Hats & Headwraps', 'Watches'] },
  { name: 'Beauty', children: ['Skincare', 'Makeup', 'Fragrance', 'Hair Care'] },
  { name: 'Home & Lifestyle', children: ['Bedding', 'Decor', 'Kitchen & Dining'] },
];

async function seedCategories() {
  let sort = 0;
  for (const top of CATEGORY_TREE) {
    const parent = await prisma.category.upsert({
      where: { slug: slugify(top.name) },
      update: {},
      create: { name: top.name, slug: slugify(top.name), sortOrder: sort++, imageUrl: img(top.name, 'D9A0A7') },
    });
    let childSort = 0;
    for (const child of top.children) {
      const slug = `${slugify(top.name)}-${slugify(child)}`;
      await prisma.category.upsert({
        where: { slug },
        update: {},
        create: { name: child, slug, parentId: parent.id, sortOrder: childSort++ },
      });
    }
  }
  console.log(`✓ ${CATEGORY_TREE.length} top-level categories`);
}

async function seedBrands() {
  const brands = ['VÉLORA Studio', 'Maison Noir', 'Adinkra Atelier', 'Kente & Co.', 'Lumière Beauty', 'Sahel Leather', 'Urban Accra'];
  for (const [i, name] of brands.entries()) {
    await prisma.brand.upsert({
      where: { slug: slugify(name) },
      update: {},
      create: { name, slug: slugify(name), isFeatured: i < 4 },
    });
  }
  console.log(`✓ ${brands.length} brands`);
}

async function seedWarehouses() {
  const rows = [
    { code: 'ACC-01', name: 'Accra Fulfilment Centre', city: 'Spintex, Accra', region: 'Greater Accra', isDefault: true },
    { code: 'KSI-01', name: 'Kumasi Hub', city: 'Adum, Kumasi', region: 'Ashanti', isDefault: false },
  ];
  for (const w of rows) await prisma.warehouse.upsert({ where: { code: w.code }, update: {}, create: w });
  console.log(`✓ ${rows.length} warehouses`);
}

type SeedProduct = {
  name: string; category: string; brand: string; price: string; compareAt?: string; material: string;
  colors: Array<[string, string]>; sizes: string[]; vendor?: boolean; featured?: boolean; description: string;
};

const SIZES_APPAREL = ['XS', 'S', 'M', 'L', 'XL'];
const SIZES_MEN = ['S', 'M', 'L', 'XL', 'XXL'];
const SIZES_SHOES = ['37', '38', '39', '40', '41', '42'];
const ONE_SIZE = ['One Size'];

const PRODUCTS: SeedProduct[] = [
  { name: 'Satin Wrap Midi Dress', category: "womens-fashion-dresses", brand: 'VÉLORA Studio', price: '389.00', compareAt: '459.00', material: '100% polyester satin', colors: [['Champagne', '#E8D5B5'], ['Noir', '#111111']], sizes: SIZES_APPAREL, featured: true, description: 'A fluid wrap silhouette with a self-tie waist and fluttered sleeves. Cut to skim the body and fall just below the knee.' },
  { name: 'Pleated Chiffon Maxi Dress', category: 'womens-fashion-dresses', brand: 'Maison Noir', price: '445.00', material: 'Chiffon with polyester lining', colors: [['Dusty Rose', '#D9A0A7'], ['Sage', '#A3B18A']], sizes: SIZES_APPAREL, featured: true, description: 'Sunray pleats, a modest V-neck and a lined skirt that moves beautifully.' },
  { name: 'Ankara Print Peplum Top', category: 'womens-fashion-tops-blouses', brand: 'Adinkra Atelier', price: '210.00', material: '100% cotton wax print', colors: [['Sunset Print', '#E07A3F'], ['Indigo Print', '#2E3A87']], sizes: SIZES_APPAREL, vendor: true, description: 'Structured peplum in authentic wax print, finished with a concealed back zip.' },
  { name: 'Relaxed Linen Shirt', category: 'womens-fashion-tops-blouses', brand: 'VÉLORA Studio', price: '179.00', material: '100% linen', colors: [['Ivory', '#F8F7F4'], ['Sand', '#D8C3A5']], sizes: SIZES_APPAREL, description: 'Breathable linen with dropped shoulders, made for Accra afternoons.' },
  { name: 'High-Rise Wide-Leg Trousers', category: 'womens-fashion-trousers-jeans', brand: 'Maison Noir', price: '265.00', compareAt: '320.00', material: 'Viscose blend crepe', colors: [['Black', '#111111'], ['Camel', '#C19A6B']], sizes: SIZES_APPAREL, featured: true, description: 'Pressed front creases, side pockets and a high waist that lengthens the leg.' },
  { name: 'Kente Panel Midi Skirt', category: 'womens-fashion-skirts', brand: 'Kente & Co.', price: '520.00', material: 'Handwoven kente panel, cotton body', colors: [['Gold Kente', '#C9A227']], sizes: SIZES_APPAREL, vendor: true, description: 'A heritage kente panel set into a modern A-line midi skirt.' },
  { name: 'Cropped Tailored Blazer', category: 'womens-fashion-outerwear', brand: 'VÉLORA Studio', price: '499.00', material: 'Polyester-viscose suiting', colors: [['Blush', '#E8C4C4'], ['Black', '#111111']], sizes: SIZES_APPAREL, description: 'Sharp shoulders, a single button and a cropped length for dresses and high waists.' },
  { name: 'Oxford Cotton Shirt', category: 'mens-fashion-shirts', brand: 'Urban Accra', price: '199.00', material: '100% cotton oxford', colors: [['White', '#FFFFFF'], ['Sky Blue', '#A7C7E7']], sizes: SIZES_MEN, description: 'A wardrobe staple with a button-down collar and a slim, modern fit.' },
  { name: 'Heavyweight Boxy Tee', category: 'mens-fashion-t-shirts-polos', brand: 'Urban Accra', price: '119.00', compareAt: '149.00', material: '240gsm cotton jersey', colors: [['Black', '#111111'], ['Bone', '#E3DAC9'], ['Olive', '#6B705C']], sizes: SIZES_MEN, featured: true, description: 'Dense cotton jersey, dropped shoulders and a boxy cut that holds its shape.' },
  { name: 'Slim Stretch Chinos', category: 'mens-fashion-trousers-chinos', brand: 'Urban Accra', price: '229.00', material: '98% cotton, 2% elastane', colors: [['Navy', '#1F2A44'], ['Khaki', '#BDB08A']], sizes: ['30', '32', '34', '36', '38'], description: 'All-day comfort with just enough stretch.' },
  { name: 'Embroidered Fugu Smock', category: 'mens-fashion-traditional-wear', brand: 'Kente & Co.', price: '380.00', material: 'Hand-loomed cotton strip cloth', colors: [['Indigo Stripe', '#2B3A67'], ['Earth Stripe', '#8B5E3C']], sizes: SIZES_MEN, vendor: true, description: 'A Northern Ghanaian classic with hand-finished neckline embroidery.' },
  { name: 'Girls Tulle Party Dress', category: 'childrens-fashion-girls', brand: 'VÉLORA Studio', price: '159.00', material: 'Tulle overlay, cotton lining', colors: [['Pink', '#F4C2C2'], ['Lilac', '#C8A2C8']], sizes: ['2Y', '4Y', '6Y', '8Y', '10Y'], description: 'Layers of soft tulle with a satin bow at the waist.' },
  { name: 'Boys Cotton Shorts Set', category: 'childrens-fashion-boys', brand: 'Urban Accra', price: '129.00', material: '100% cotton', colors: [['Navy/White', '#1F2A44']], sizes: ['2Y', '4Y', '6Y', '8Y', '10Y'], description: 'Tee and drawstring shorts made for play.' },
  { name: 'Pointed Block-Heel Pumps', category: 'shoes-heels', brand: 'Maison Noir', price: '349.00', compareAt: '399.00', material: 'Faux leather upper, rubber sole', colors: [['Nude', '#D2B48C'], ['Black', '#111111']], sizes: SIZES_SHOES, featured: true, description: 'A 6cm block heel you can actually walk in.' },
  { name: 'Leather Court Sneakers', category: 'shoes-sneakers', brand: 'Sahel Leather', price: '420.00', material: 'Full-grain leather', colors: [['White', '#FFFFFF'], ['White/Rose', '#D9A0A7']], sizes: ['38', '39', '40', '41', '42', '43', '44'], description: 'Minimal low-tops with a cushioned insole.' },
  { name: 'Woven Leather Slides', category: 'shoes-sandals-slides', brand: 'Sahel Leather', price: '245.00', material: 'Hand-woven leather', colors: [['Tan', '#C68E5B'], ['Black', '#111111']], sizes: SIZES_SHOES, vendor: true, description: 'Handwoven in Tamale on a contoured footbed.' },
  { name: 'Structured Top-Handle Bag', category: 'bags-handbags', brand: 'Maison Noir', price: '560.00', material: 'Pebbled faux leather', colors: [['Black', '#111111'], ['Ivory', '#F8F7F4']], sizes: ONE_SIZE, featured: true, description: 'A compact structured bag with a detachable crossbody strap.' },
  { name: 'Canvas Market Tote', category: 'bags-tote-bags', brand: 'VÉLORA Studio', price: '139.00', material: 'Heavy cotton canvas', colors: [['Natural', '#E9DFC9']], sizes: ONE_SIZE, description: 'Roomy, sturdy and ready for the market or the office.' },
  { name: 'Gold-Tone Layered Necklace', category: 'jewellery-necklaces', brand: 'VÉLORA Studio', price: '119.00', material: '18k gold-plated brass', colors: [['Gold', '#D4AF37']], sizes: ONE_SIZE, description: 'Three delicate chains, pre-layered so they never tangle.' },
  { name: 'Krobo Bead Drop Earrings', category: 'jewellery-earrings', brand: 'Adinkra Atelier', price: '85.00', material: 'Recycled-glass Krobo beads', colors: [['Multicolour', '#B5651D']], sizes: ONE_SIZE, vendor: true, description: 'Handmade from recycled-glass beads by artisans in Odumase-Krobo.' },
  { name: 'Oversized Cat-Eye Sunglasses', category: 'accessories-sunglasses', brand: 'Maison Noir', price: '159.00', material: 'Acetate frame, UV400 lenses', colors: [['Tortoise', '#8B5A2B'], ['Black', '#111111']], sizes: ONE_SIZE, description: 'UV400 protection with a retro silhouette.' },
  { name: 'Satin Headwrap', category: 'accessories-hats-headwraps', brand: 'Adinkra Atelier', price: '69.00', material: 'Satin', colors: [['Emerald', '#046307'], ['Burgundy', '#800020']], sizes: ONE_SIZE, vendor: true, description: 'Pre-shaped satin wrap that protects hair and finishes a look.' },
  { name: 'Shea Glow Body Butter', category: 'beauty-skincare', brand: 'Lumière Beauty', price: '95.00', material: 'Unrefined Ghanaian shea butter, vitamin E', colors: [['Unscented', '#F3E5AB']], sizes: ['200ml'], featured: true, description: 'Whipped unrefined shea for deep, lasting moisture.' },
  { name: 'Velvet Matte Lipstick', category: 'beauty-makeup', brand: 'Lumière Beauty', price: '79.00', material: 'Vegan formula', colors: [['Rose Nude', '#C08081'], ['Brick Red', '#8B2F2F'], ['Plum', '#5E2750']], sizes: ['3.5g'], description: 'High-pigment matte that stays comfortable all day.' },
  { name: 'Mudcloth Throw Cushion', category: 'home-lifestyle-decor', brand: 'VÉLORA Studio', price: '149.00', material: 'Cotton cover, recycled fill', colors: [['Black/Ivory', '#111111']], sizes: ['45 x 45 cm'], description: 'Graphic mudcloth-inspired print on heavyweight cotton.' },
];

async function seedProducts(vendorId: number) {
  const brands = new Map((await prisma.brand.findMany()).map((b) => [b.name, b.id]));
  const cats = new Map((await prisma.category.findMany()).map((c) => [c.slug, c.id]));
  const warehouses = await prisma.warehouse.findMany({ orderBy: { id: 'asc' } });
  let created = 0;

  for (const [i, p] of PRODUCTS.entries()) {
    const slug = slugify(p.name);
    if (await prisma.product.findUnique({ where: { slug } })) continue;
    const categoryId = cats.get(p.category);
    if (!categoryId) throw new Error(`Unknown category slug ${p.category}`);
    const styleCode = `VL-${String(1000 + i)}`;

    await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: p.name, slug, styleCode, categoryId, brandId: brands.get(p.brand),
          vendorId: p.vendor ? vendorId : null,
          shortDescription: p.description.split('.')[0] + '.', description: p.description,
          material: p.material, careInstructions: 'Gentle cold wash or spot clean. Do not tumble dry.',
          basePrice: new Prisma.Decimal(p.price), compareAtPrice: p.compareAt ? new Prisma.Decimal(p.compareAt) : null,
          status: ProductStatus.ACTIVE, isFeatured: !!p.featured, publishedAt: new Date(Date.now() - i * 86_400_000),
          tags: [p.brand, p.category.split('-')[0]],
          attributes: { create: [
            { name: 'Material', value: p.material, sortOrder: 0 },
            { name: 'Origin', value: p.vendor ? 'Made in Ghana' : 'Imported', sortOrder: 1 },
          ] },
          images: { create: p.colors.flatMap(([color, hex], ci) => [0, 1].map((n) => ({
            color, url: img(`${p.name} · ${color}`, hex.slice(1)), altText: `${p.name} in ${color}`, sortOrder: ci * 2 + n,
          }))) },
        },
      });
      for (const [ci, [color, colorHex]] of p.colors.entries()) {
        for (const [si, size] of p.sizes.entries()) {
          const variant = await tx.productVariant.create({
            data: {
              productId: product.id, color, colorHex, size, sortOrder: ci * 100 + si,
              sku: `${styleCode}-${slugify(color).replace(/-/g, '').slice(0, 12).toUpperCase()}-${size.replace(/\s+/g, '').toUpperCase()}`,
              costPrice: new Prisma.Decimal(p.price).mul(0.45).toDecimalPlaces(2),
            },
          });
          for (const [wi, wh] of warehouses.entries()) {
            // Deterministic, varied stock: some variants are deliberately low or out of stock.
            const qty = (i * 7 + ci * 5 + si * 3 + wi * 11) % 23;
            const inv = await tx.inventory.create({
              data: { variantId: variant.id, warehouseId: wh.id, quantityOnHand: qty, reorderLevel: 4,
                averageCost: new Prisma.Decimal(p.price).mul(0.45).toDecimalPlaces(2) },
            });
            if (qty > 0) {
              await tx.stockMovement.create({
                data: { inventoryId: inv.id, type: 'OPENING_BALANCE', quantity: qty, balanceAfter: qty, note: 'Seed opening balance' },
              });
            }
          }
        }
      }
    });
    created++;
  }
  console.log(`✓ ${created} new products (${PRODUCTS.length} defined) with variants and per-warehouse stock`);
}

async function seedCommerceConfig() {
  const now = new Date();
  const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);
  const coupons = [
    { code: 'AKWAABA10', description: '10% off your first order', type: DiscountType.PERCENTAGE, value: '10', maxDiscountAmount: '100', firstOrderOnly: true },
    { code: 'STYLE50', description: 'GH₵50 off orders over GH₵400', type: DiscountType.FIXED_AMOUNT, value: '50', minOrderAmount: '400' },
    { code: 'FREESHIP', description: 'Free delivery over GH₵250', type: DiscountType.FREE_SHIPPING, value: '0', minOrderAmount: '250' },
  ];
  for (const c of coupons) {
    await prisma.coupon.upsert({
      where: { code: c.code },
      update: {},
      create: {
        ...c, value: new Prisma.Decimal(c.value),
        minOrderAmount: c.minOrderAmount ? new Prisma.Decimal(c.minOrderAmount) : null,
        maxDiscountAmount: c.maxDiscountAmount ? new Prisma.Decimal(c.maxDiscountAmount) : null,
        startsAt: now, endsAt: inDays(90),
      },
    });
  }

  if (!(await prisma.shippingZone.count())) {
    const others = GHANA_REGIONS.filter((r) => r !== 'Greater Accra' && r !== 'Ashanti');
    const zones = [
      { name: 'Greater Accra', regions: ['Greater Accra'], methods: [
        { code: 'standard', name: 'Standard delivery', fee: '25.00', freeOverAmount: '500.00', minDays: 1, maxDays: 2 },
        { code: 'express', name: 'Same-day express', fee: '45.00', minDays: 0, maxDays: 0 },
        { code: 'pickup', name: 'Pick up at Spintex', fee: '0.00', minDays: 0, maxDays: 1 },
      ] },
      { name: 'Ashanti', regions: ['Ashanti'], methods: [
        { code: 'standard', name: 'Standard delivery', fee: '35.00', freeOverAmount: '600.00', minDays: 2, maxDays: 3 },
        { code: 'pickup', name: 'Pick up at Adum', fee: '0.00', minDays: 1, maxDays: 2 },
      ] },
      { name: 'Rest of Ghana', regions: others, methods: [
        { code: 'standard', name: 'Standard delivery', fee: '55.00', freeOverAmount: '800.00', minDays: 3, maxDays: 6 },
      ] },
    ];
    for (const z of zones) {
      await prisma.shippingZone.create({
        data: {
          name: z.name, regions: z.regions,
          methods: { create: z.methods.map((m, i) => ({
            ...m, carrier: 'VÉLORA Dispatch', sortOrder: i, fee: new Prisma.Decimal(m.fee),
            freeOverAmount: m.freeOverAmount ? new Prisma.Decimal(m.freeOverAmount) : null,
          })) },
        },
      });
    }
  }

  const settings: Array<{ group: string; key: string; value: Prisma.InputJsonValue; isPublic: boolean; description: string }> = [
    { group: 'store', key: 'name', value: 'VÉLORA', isPublic: true, description: 'Store display name' },
    { group: 'store', key: 'tagline', value: 'Where Elegance Meets Expression.', isPublic: true, description: 'Brand identity line' },
    { group: 'store', key: 'slogan', value: 'DEFINE YOUR STYLE.', isPublic: true, description: 'Brand slogan' },
    { group: 'store', key: 'supportEmail', value: 'care@velora.test', isPublic: true, description: 'Customer care email' },
    { group: 'store', key: 'supportPhone', value: '+233 30 000 0000', isPublic: true, description: 'Customer care phone' },
    { group: 'currency', key: 'default', value: 'GHS', isPublic: true, description: 'Default ISO-4217 currency' },
    { group: 'currency', key: 'enabled', value: ['GHS'], isPublic: true, description: 'Currencies customers can pay in' },
    { group: 'tax', key: 'pricesIncludeTax', value: true, isPublic: true, description: 'Catalogue prices are tax-inclusive' },
    { group: 'tax', key: 'rates', value: [], isPublic: false, description: 'Tax lines applied at checkout; configure with your accountant' },
    { group: 'orders', key: 'returnWindowDays', value: 14, isPublic: true, description: 'Days after delivery a return can be requested' },
    { group: 'orders', key: 'unpaidOrderTtlMinutes', value: 60, isPublic: false, description: 'Release reserved stock for unpaid orders after this' },
    { group: 'loyalty', key: 'pointsPerCedi', value: 1, isPublic: true, description: 'Points earned per GH₵1 spent' },
    { group: 'loyalty', key: 'cediPerPoint', value: 0.05, isPublic: true, description: 'Redemption value of one point' },
    { group: 'loyalty', key: 'minRedeemPoints', value: 200, isPublic: true, description: 'Smallest number of points that can be redeemed' },
    { group: 'loyalty', key: 'maxRedeemPercent', value: 50, isPublic: true, description: 'Most of an order (merchandise, %) payable with points' },
    { group: 'loyalty', key: 'referralBonusPoints', value: 500, isPublic: true, description: 'Points for the referrer when a referred friend’s first order is delivered' },
    { group: 'loyalty', key: 'refereeBonusPoints', value: 250, isPublic: true, description: 'Points for the new customer on their first delivered order' },
    { group: 'loyalty', key: 'reviewBonusPoints', value: 50, isPublic: true, description: 'Points for each approved product review' },
    { group: 'marketplace', key: 'defaultCommissionRate', value: 15, isPublic: false, description: 'Default vendor commission %' },
    { group: 'marketplace', key: 'settlementHoldDays', value: 14, isPublic: false, description: 'Days before vendor earnings become payable' },
  ];
  for (const s of settings) {
    await prisma.systemSetting.upsert({ where: { group_key: { group: s.group, key: s.key } }, update: {}, create: s });
  }

  const suppliers = [
    { name: 'Kantamanto Textiles Ltd', contactName: 'Mary Tetteh', phone: '+233302000100', country: 'Ghana', paymentTerms: 'Net 30' },
    { name: 'Guangzhou Apparel Sourcing', contactName: 'Li Wei', email: 'sales@gz-apparel.example', country: 'China', paymentTerms: '50% deposit' },
  ];
  if (!(await prisma.supplier.count())) await prisma.supplier.createMany({ data: suppliers });

  console.log(`✓ ${coupons.length} coupons, shipping zones, ${settings.length} settings, suppliers`);
}

const SIZE_GUIDES: Record<string, Prisma.InputJsonValue> = {
  'womens-fashion': {
    unit: 'cm', note: 'Measure over light clothing. Between sizes? Size up for a relaxed fit.',
    columns: ['Size', 'UK', 'Bust', 'Waist', 'Hips'],
    rows: [['XS', '6', '80–83', '62–65', '87–90'], ['S', '8', '84–87', '66–69', '91–94'], ['M', '10', '88–92', '70–74', '95–99'],
      ['L', '12–14', '93–99', '75–81', '100–106'], ['XL', '16', '100–106', '82–88', '107–113']],
  },
  'mens-fashion': {
    unit: 'cm', note: 'Chest measured under the arms; waist at the natural waistline.',
    columns: ['Size', 'Chest', 'Waist', 'Neck'],
    rows: [['S', '88–94', '74–80', '37–38'], ['M', '95–101', '81–87', '39–40'], ['L', '102–108', '88–94', '41–42'],
      ['XL', '109–116', '95–102', '43–44'], ['XXL', '117–124', '103–110', '45–46']],
  },
  'childrens-fashion': {
    unit: 'cm', note: 'Sizes are by age; check height for the best fit.',
    columns: ['Size', 'Height', 'Chest'],
    rows: [['2Y', '92', '53'], ['4Y', '104', '57'], ['6Y', '116', '61'], ['8Y', '128', '65'], ['10Y', '140', '70']],
  },
  shoes: {
    unit: 'cm', note: 'Measure heel to longest toe while standing.',
    columns: ['EU', 'UK', 'US (W)', 'Foot length'],
    rows: [['37', '4', '6.5', '23.5'], ['38', '5', '7.5', '24.1'], ['39', '6', '8.5', '24.8'], ['40', '6.5', '9', '25.4'],
      ['41', '7.5', '10', '26.0'], ['42', '8', '10.5', '26.7'], ['43', '9', '11.5', '27.3'], ['44', '9.5', '12', '28.0']],
  },
};

const REVIEW_TEXT: Array<[number, string, string, 'RUNS_SMALL' | 'TRUE_TO_SIZE' | 'RUNS_LARGE']> = [
  [5, 'Exactly as pictured', 'The fabric feels premium and the fit is spot on. Delivery to East Legon took a day.', 'TRUE_TO_SIZE'],
  [5, 'My new favourite', 'Wore it to a wedding in Kumasi and got so many compliments. Worth every pesewa.', 'TRUE_TO_SIZE'],
  [4, 'Lovely, size up', 'Beautiful finish but a little snug across the shoulders. I would order one size up.', 'RUNS_SMALL'],
  [4, 'Great quality', 'Well made and the colour is rich. Packaging was elegant too.', 'TRUE_TO_SIZE'],
  [5, 'Perfect gift', 'Bought this for my sister and she loves it. Arrived beautifully wrapped.', 'TRUE_TO_SIZE'],
  [3, 'Nice but roomy', 'Good material, but it runs a bit large for me. Customer care helped with an exchange.', 'RUNS_LARGE'],
];

/** Storefront realism: size guides, sales history, approved reviews, Q&A and search trends. Idempotent. */
async function seedStorefront() {
  for (const [slug, guide] of Object.entries(SIZE_GUIDES)) {
    await prisma.category.updateMany({ where: { slug, sizeGuide: { equals: Prisma.DbNull } }, data: { sizeGuide: guide } });
  }

  const products = await prisma.product.findMany({ orderBy: { id: 'asc' } });
  if (products.every((p) => p.soldCount === 0)) {
    for (const [i, p] of products.entries()) {
      await prisma.product.update({ where: { id: p.id }, data: { soldCount: (i * 37 + 11) % 180 + (p.isFeatured ? 60 : 0), viewCount: (i * 131) % 900 + 120 } });
    }
  }

  if (!(await prisma.productReview.count())) {
    const reviewers = await prisma.user.findMany({ where: { email: { endsWith: '@example.test' } }, orderBy: { id: 'asc' } });
    for (const [i, p] of products.slice(0, 18).entries()) {
      const n = 2 + (i % 3);
      const picks = Array.from({ length: n }, (_, k) => REVIEW_TEXT[(i + k * 2) % REVIEW_TEXT.length]);
      await prisma.productReview.createMany({
        data: picks.map(([rating, title, body, fit], k) => ({
          productId: p.id, userId: reviewers[(i + k) % reviewers.length].id, rating, title, body, fit,
          status: 'APPROVED' as const, helpfulCount: (i + k * 3) % 9,
          createdAt: new Date(Date.now() - (i * 3 + k) * 86_400_000),
        })),
      });
      const avg = picks.reduce((s, r) => s + r[0], 0) / n;
      await prisma.product.update({ where: { id: p.id }, data: { avgRating: new Prisma.Decimal(avg.toFixed(2)), reviewCount: n } });
    }
  }

  if (!(await prisma.productQuestion.count())) {
    const asker = await prisma.user.findFirstOrThrow({ where: { email: { endsWith: '@example.test' } } });
    const support = await prisma.user.findFirstOrThrow({ where: { email: 'customer-support@staff.velora.test' } });
    const dress = products.find((p) => p.slug === 'satin-wrap-midi-dress');
    if (dress) {
      await prisma.productQuestion.create({
        data: { productId: dress.id, userId: asker.id, question: 'Is the satin see-through in the lighter colour?',
          answer: 'The Champagne colourway is fully opaque. We recommend nude undergarments for the smoothest finish.',
          answeredBy: support.id, answeredAt: new Date(), status: 'APPROVED' },
      });
    }
  }

  if (!(await prisma.searchTerm.count())) {
    const terms: Array<[string, number]> = [['dress', 412], ['sneakers', 298], ['kente', 251], ['shea butter', 187], ['linen', 143], ['handbag', 139], ['earrings', 96], ['blazer', 88]];
    await prisma.searchTerm.createMany({ data: terms.map(([term, searchCount]) => ({ term, searchCount, resultCount: 1 })) });
  }
  console.log('✓ size guides, sales history, reviews, Q&A, search trends');
}

/** Deterministic PRNG so every developer gets the same demo history. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 60 days of realistic order history for the admin dashboard and reports.
 * Older orders are delivered and paid; recent ones are shipped or still being prepared
 * (with stock properly reserved); a few are cancelled.
 */
async function seedOrderHistory() {
  if (await prisma.order.count({ where: { idempotencyKey: { startsWith: 'seed-' } } })) return;
  const rand = mulberry32(20261124);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const customers = await prisma.user.findMany({ where: { email: { endsWith: '@example.test' } }, include: { addresses: true } });
  const variants = await prisma.productVariant.findMany({
    where: { isActive: true },
    include: { product: { include: { images: { take: 1, orderBy: { sortOrder: 'asc' } }, vendor: true } }, inventory: true },
  });
  const accra = await prisma.shippingMethod.findFirstOrThrow({ where: { code: 'standard', zone: { name: 'Greater Accra' } } });
  const kumasi = await prisma.shippingMethod.findFirstOrThrow({ where: { code: 'standard', zone: { name: 'Ashanti' } } });
  const guestNames = ['Yaa Mensah', 'Kojo Otoo', 'Afua Badu', 'Kwesi Arthur', 'Efe Bello', 'Maame Esi'];
  let made = 0;

  for (let day = 59; day >= 0; day--) {
    const perDay = 1 + Math.floor(rand() * (day < 14 ? 4 : 3));
    for (let n = 0; n < perDay; n++) {
      const placedAt = new Date(Date.now() - day * 86_400_000 - Math.floor(rand() * 10) * 3_600_000);
      const isGuest = rand() < 0.35;
      const user = isGuest ? null : pick(customers);
      const name = user ? `${user.firstName} ${user.lastName}` : pick(guestNames);
      const inKumasi = rand() < 0.25;
      const method = inKumasi ? kumasi : accra;
      const address = {
        recipientName: name, phone: user?.phone ?? `+23324${String(1000000 + Math.floor(rand() * 8999999))}`,
        line1: `${1 + Math.floor(rand() * 90)} ${pick(['Oxford Street', 'Ring Road', 'Spintex Road', 'Liberation Road', 'Adum High Street'])}`,
        city: inKumasi ? 'Kumasi' : pick(['Osu, Accra', 'East Legon, Accra', 'Tema', 'Dansoman, Accra']),
        region: inKumasi ? 'Ashanti' : 'Greater Accra', countryCode: 'GH',
      };
      const lines = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({ v: pick(variants), qty: rand() < 0.8 ? 1 : 2 }))
        .filter((l, i, arr) => arr.findIndex((x) => x.v.id === l.v.id) === i);
      const subtotal = lines.reduce((s, l) => s.add((l.v.price ?? l.v.product.basePrice).mul(l.qty)), new Prisma.Decimal(0));
      const shipping = method.freeOverAmount && subtotal.gte(method.freeOverAmount) ? new Prisma.Decimal(0) : method.fee;
      const cancelled = rand() < 0.06;
      const status = cancelled ? 'CANCELLED' : day > 6 ? 'DELIVERED' : day > 2 ? 'SHIPPED' : 'PROCESSING';
      const paid = status === 'DELIVERED';
      const orderNumber = `VL${placedAt.toISOString().slice(2, 10).replace(/-/g, '')}S${String(made).padStart(4, '0')}`;

      await prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            orderNumber, userId: user?.id, guestEmail: user?.email ?? `${name.split(' ')[0].toLowerCase()}.${made}@example.test`,
            guestPhone: address.phone, status, paymentStatus: paid ? 'PAID' : 'PENDING',
            subtotal, shippingTotal: shipping, grandTotal: subtotal.add(shipping), shippingMethodId: method.id,
            shippingAddress: address, idempotencyKey: `seed-${made}`, channel: rand() < 0.3 ? 'mobile' : 'web',
            placedAt, createdAt: placedAt, paidAt: paid ? new Date(placedAt.getTime() + 2 * 86_400_000) : null,
            cancelledAt: cancelled ? new Date(placedAt.getTime() + 3_600_000) : null, cancelReason: cancelled ? 'Cancelled by customer' : null,
          },
        });
        for (const l of lines) {
          const wh = l.v.inventory.slice().sort((a, b) => (b.quantityOnHand - b.quantityReserved) - (a.quantityOnHand - a.quantityReserved))[0];
          const unit = l.v.price ?? l.v.product.basePrice;
          const item = await tx.orderItem.create({
            data: {
              orderId: order.id, productId: l.v.productId, variantId: l.v.id, vendorId: l.v.product.vendorId, warehouseId: wh?.warehouseId,
              productName: l.v.product.name, variantLabel: [l.v.color, l.v.size].filter(Boolean).join(' / '), sku: l.v.sku,
              imageUrl: l.v.product.images[0]?.url, unitPrice: unit, quantity: l.qty, lineTotal: unit.mul(l.qty), createdAt: placedAt,
            },
          });
          if (l.v.product.vendorId && l.v.product.vendor) {
            const gross = unit.mul(l.qty);
            const commission = gross.mul(l.v.product.vendor.commissionRate).div(100).toDecimalPlaces(2);
            await tx.vendorCommission.create({
              data: { vendorId: l.v.product.vendorId, orderItemId: item.id, rate: l.v.product.vendor.commissionRate, grossAmount: gross,
                commissionAmount: commission, netAmount: gross.sub(commission),
                status: cancelled ? 'REVERSED' : paid ? 'ELIGIBLE' : 'PENDING', eligibleAt: paid ? new Date(placedAt.getTime() + 16 * 86_400_000) : null },
            });
          }
          // Still-processing orders hold real reservations so fulfilment from the admin works end to end.
          if (status === 'PROCESSING' && wh && wh.quantityOnHand - wh.quantityReserved >= l.qty) {
            await tx.inventory.update({ where: { id: wh.id }, data: { quantityReserved: { increment: l.qty } } });
            wh.quantityReserved += l.qty;
            await tx.stockMovement.create({ data: { inventoryId: wh.id, type: 'RESERVATION', quantity: l.qty, balanceAfter: wh.quantityOnHand, referenceType: 'order', referenceId: order.id, note: 'Reserved for order', createdAt: placedAt } });
          }
        }
        await tx.payment.create({
          data: { orderId: order.id, provider: 'CASH_ON_DELIVERY', method: 'CASH', reference: `PAY-${orderNumber}`, amount: order.grandTotal,
            status: paid ? 'SUCCESS' : cancelled ? 'ABANDONED' : 'PENDING', verifiedAt: paid ? order.paidAt : null, createdAt: placedAt },
        });
        const history: Array<[string, string, number]> = [['PROCESSING', 'Order placed. Pay cash or MoMo to the rider on delivery.', 0]];
        if (cancelled) history.push(['CANCELLED', 'Cancelled by customer', 1]);
        if (status === 'SHIPPED' || status === 'DELIVERED') history.push(['SHIPPED', 'Handed to VÉLORA Dispatch', 20]);
        if (status === 'DELIVERED') history.push(['DELIVERED', 'Delivered and paid on delivery', 48]);
        for (const [s, note, h] of history) {
          await tx.orderStatusHistory.create({ data: { orderId: order.id, toStatus: s as never, note, createdAt: new Date(placedAt.getTime() + h * 3_600_000) } });
        }
        if (status === 'SHIPPED' || status === 'DELIVERED') {
          const shippedAt = new Date(placedAt.getTime() + 20 * 3_600_000);
          await tx.shipment.create({
            data: { orderId: order.id, carrier: 'VÉLORA Dispatch', trackingNumber: `VD${orderNumber.slice(2)}`, status: status === 'DELIVERED' ? 'DELIVERED' : 'IN_TRANSIT',
              dispatchedAt: shippedAt, deliveredAt: status === 'DELIVERED' ? new Date(placedAt.getTime() + 48 * 3_600_000) : null,
              events: { create: [{ status: 'DISPATCHED', description: 'Left the Accra Fulfilment Centre', location: 'Spintex', occurredAt: shippedAt }] } },
          });
        }
        if (user && paid) {
          await tx.customer.update({ where: { userId: user.id }, data: { orderCount: { increment: 1 }, lifetimeValue: { increment: order.grandTotal }, lastOrderAt: placedAt } });
          const points = Math.floor(Number(order.grandTotal));
          const acct = await tx.loyaltyAccount.update({ where: { userId: user.id }, data: { pointsBalance: { increment: points }, lifetimePoints: { increment: points } } });
          await tx.loyaltyTransaction.create({ data: { accountId: acct.id, type: 'EARN', points, balanceAfter: acct.pointsBalance, orderId: order.id, description: `Order ${orderNumber}` } });
        }
      });
      made++;
    }
  }
  // Same thresholds the delivery flow uses (AdminOrdersService.deliver).
  await prisma.$executeRaw`UPDATE loyalty_accounts SET tier = CASE
    WHEN lifetime_points >= 20000 THEN 'PLATINUM' WHEN lifetime_points >= 8000 THEN 'GOLD'
    WHEN lifetime_points >= 2500 THEN 'SILVER' ELSE 'BRONZE' END`;
  console.log(`✓ ${made} historical orders`);
}


/** Demo promotions: a flash sale running now and a sale starting soon (dates relative to when the seed runs). */
async function seedPromotions() {
  if (process.env.SEED_SKIP_DEMO_PROMOTIONS === '1') return; // e2e tests create their own promotions
  const now = Date.now();
  const H = 3_600_000;
  const pick = async (slugs: string[]) => (await prisma.product.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true, basePrice: true } }));
  const flash = await prisma.promotion.findUnique({ where: { slug: 'weekend-flash-sale' } });
  if (!flash || flash.endsAt.getTime() < now) {
    const products = await pick(['satin-wrap-midi-dress', 'leather-court-sneakers', 'structured-top-handle-bag', 'ankara-print-peplum-top', 'krobo-bead-drop-earrings', 'relaxed-linen-shirt']);
    if (flash) await prisma.promotion.delete({ where: { id: flash.id } });
    await prisma.promotion.create({
      data: {
        name: 'Weekend Flash Sale', slug: 'weekend-flash-sale', type: 'FLASH_SALE', value: 25, priority: 10,
        headline: '25% off selected pieces, while stocks last', campaign: 'weekend',
        startsAt: new Date(now - H), endsAt: new Date(now + 72 * H),
        products: { create: products.map((p, i) => ({ productId: p.id, stockLimit: i % 2 === 0 ? 15 : null })) },
      },
    });
  }
  if (!(await prisma.promotion.findUnique({ where: { slug: 'kente-week' } }))) {
    const products = await pick(['kente-panel-midi-skirt', 'embroidered-fugu-smock', 'satin-headwrap']);
    await prisma.promotion.create({
      data: {
        name: 'Kente Week', slug: 'kente-week', type: 'PERCENTAGE_OFF', value: 15, priority: 5,
        headline: '15% off handwoven and heritage pieces', campaign: 'heritage',
        startsAt: new Date(now + 48 * H), endsAt: new Date(now + 9 * 24 * H),
        products: { create: products.map((p) => ({ productId: p.id })) },
      },
    });
  }
  console.log('✓ promotions (flash sale live, Kente Week scheduled)');
}

async function main() {
  await seedAccessControl();
  await seedUsers();
  const vendor = await seedVendors();
  await seedCategories();
  await seedBrands();
  await seedWarehouses();
  await seedProducts(vendor.id);
  await seedCommerceConfig();
  await seedStorefront();
  await seedPromotions();
  await seedOrderHistory();
}

main()
  .then(() => console.log('Seed complete.'))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
