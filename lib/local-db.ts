import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'
import { randomUUID } from 'node:crypto'
import { addDays, dayKey, dayRange, dayStart } from '@/lib/time'

// Self-hosted storage (SHOPOS_STORAGE=mariadb). Every shop's rows carry its shop_id and every query
// filters on it. Money is DECIMAL in the database and rounded to two places here; timestamps are UTC.

export type LocalProduct = {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  category: string | null
  unit: string
  cost_price: number
  sale_price: number
  stock_quantity: number
  reorder_level: number
  image_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type LocalProductInput = Omit<LocalProduct, 'id' | 'created_at' | 'updated_at' | 'image_url' | 'is_active'> & { image_url?: string | null }
export type LocalSaleItem = { product_id: string; product_name: string; quantity: number; unit_price: number; cost_price: number; subtotal: number; returned_quantity: number }
export type LocalSale = {
  id: string
  // Invoice number: 1, 2, 3… within the shop.
  number: number
  client_id: string | null
  total: number
  discount: number
  payment_method: string
  amount_paid: number
  change_given: number
  credit_amount: number
  // Money given back so far for returned items (sum of the sale's returns).
  refunded: number
  customer_id: string | null
  customer_name: string | null
  created_by_name: string | null
  created_at: string
  items: LocalSaleItem[]
}
export type LocalSaleReturn = {
  id: string
  amount: number
  khata_amount: number
  refund_method: string
  reason: string | null
  created_by_name: string | null
  created_at: string
  items: Array<{ product_id: string; product_name: string; quantity: number; amount: number }>
}
export type LocalSaleReturnInput = { items: Array<{ product_id: string; quantity: number }>; reason?: string; client_id?: string }
export type LocalSaleFilter = { search?: string; start?: Date; end?: Date; limit?: number; offset?: number }
export type PaymentMethod = 'cash' | 'card' | 'credit'
// offline: rung up on a till without a connection and synced later (see lib/offline/till.ts). The goods
// have already left the shop, so the sale is recorded even if stock ran short meanwhile (stock stops at 0),
// and it keeps the time it was made (sold_at, up to 14 days back).
export type LocalSaleInput = { items: Array<{ product_id: string; quantity: number }>; discount?: number; payment_method: PaymentMethod; amount_paid?: number; client_id?: string; customer_id?: string | null; offline?: boolean; sold_at?: string }

const OFFLINE_SALE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
// When an offline sale happened; anything in the future or too old counts as now.
export function offlineSaleTime(soldAt: string | undefined, now = new Date()) {
  const time = soldAt ? Date.parse(soldAt) : Number.NaN
  if (!Number.isFinite(time) || time > now.getTime() || now.getTime() - time > OFFLINE_SALE_MAX_AGE_MS) return now
  return new Date(time)
}

export class LocalDataError extends Error {
  // code: machine-readable reason the UI can act on, e.g. 'unverified' to offer a new verification link.
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = 'LocalDataError'
  }
}

export type Queryable = Pool | PoolConnection

const PRODUCT_COLUMNS = 'id, name, sku, barcode, category, unit, cost_price, sale_price, stock_quantity, reorder_level, image_url, is_active, created_at, updated_at'
const SALE_COLUMNS = 'sales.id, sales.number, sales.client_id, sales.total, sales.discount, sales.payment_method, sales.amount_paid, sales.change_given, sales.credit_amount, sales.refunded, sales.customer_id, customers.name AS customer_name, seller.full_name AS created_by_name, sales.created_at'
const SALE_FROM = 'sales LEFT JOIN customers ON customers.id = sales.customer_id LEFT JOIN users AS seller ON seller.id = sales.created_by'
const TABLE_OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
export const TRIAL_DAYS = 14
export const PLAN_PRICE_PKR = 1500

// Append-only: each entry is one schema version. Never edit an entry that has shipped; add a new one.
// DDL is not transactional in MariaDB, so later statements use IF [NOT] EXISTS where they can and a
// half-applied version can be re-run.
const migrations: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS products (
      id CHAR(36) NOT NULL PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      sku VARCHAR(80) NULL,
      barcode VARCHAR(80) NULL,
      category VARCHAR(80) NULL,
      unit VARCHAR(20) NOT NULL DEFAULT 'pcs',
      cost_price DECIMAL(14,2) NOT NULL DEFAULT 0,
      sale_price DECIMAL(14,2) NOT NULL DEFAULT 0,
      stock_quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
      reorder_level DECIMAL(14,3) NOT NULL DEFAULT 0,
      image_url VARCHAR(2048) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      -- A barcode scan must resolve to one product, so active products cannot share a code.
      active_sku VARCHAR(80) AS (IF(is_active = 1, sku, NULL)) PERSISTENT,
      active_barcode VARCHAR(80) AS (IF(is_active = 1, barcode, NULL)) PERSISTENT,
      UNIQUE KEY products_active_sku_uq (active_sku),
      UNIQUE KEY products_active_barcode_uq (active_barcode),
      KEY products_name_idx (name),
      CONSTRAINT products_stock_nonnegative CHECK (stock_quantity >= 0)
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS sales (
      id CHAR(36) NOT NULL PRIMARY KEY,
      client_id VARCHAR(120) NULL,
      total DECIMAL(14,2) NOT NULL,
      discount DECIMAL(14,2) NOT NULL DEFAULT 0,
      payment_method VARCHAR(10) NOT NULL,
      amount_paid DECIMAL(14,2) NOT NULL,
      change_given DECIMAL(14,2) NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL,
      UNIQUE KEY sales_client_id_uq (client_id),
      KEY sales_created_at_idx (created_at)
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS sale_items (
      id CHAR(36) NOT NULL PRIMARY KEY,
      sale_id CHAR(36) NOT NULL,
      product_id CHAR(36) NOT NULL,
      product_name VARCHAR(160) NOT NULL,
      quantity DECIMAL(14,3) NOT NULL,
      unit_price DECIMAL(14,2) NOT NULL,
      cost_price DECIMAL(14,2) NOT NULL,
      subtotal DECIMAL(14,2) NOT NULL,
      KEY sale_items_sale_id_idx (sale_id),
      CONSTRAINT sale_items_sale_fk FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE,
      CONSTRAINT sale_items_product_fk FOREIGN KEY (product_id) REFERENCES products (id),
      CONSTRAINT sale_items_quantity_positive CHECK (quantity > 0)
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS stock_moves (
      id CHAR(36) NOT NULL PRIMARY KEY,
      product_id CHAR(36) NOT NULL,
      delta DECIMAL(14,3) NOT NULL,
      reason VARCHAR(200) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      KEY stock_moves_product_id_idx (product_id),
      KEY stock_moves_created_at_idx (created_at),
      CONSTRAINT stock_moves_product_fk FOREIGN KEY (product_id) REFERENCES products (id),
      CONSTRAINT stock_moves_delta_nonzero CHECK (delta <> 0)
    ) ${TABLE_OPTIONS}`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) NOT NULL PRIMARY KEY,
      email VARCHAR(254) NOT NULL,
      full_name VARCHAR(120) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(10) NOT NULL,
      email_verified_at DATETIME(3) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      last_login_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      UNIQUE KEY users_email_uq (email),
      CONSTRAINT users_role_valid CHECK (role IN ('owner', 'manager', 'cashier'))
    ) ${TABLE_OPTIONS}`,
    // Only a SHA-256 of each session and email token is stored, so a database leak does not leak logins.
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash CHAR(64) NOT NULL PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      last_seen_at DATETIME(3) NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      user_agent VARCHAR(255) NULL,
      ip VARCHAR(64) NULL,
      KEY sessions_user_id_idx (user_id),
      KEY sessions_expires_at_idx (expires_at),
      CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS email_tokens (
      token_hash CHAR(64) NOT NULL PRIMARY KEY,
      purpose VARCHAR(10) NOT NULL,
      email VARCHAR(254) NOT NULL,
      user_id CHAR(36) NULL,
      role VARCHAR(10) NULL,
      full_name VARCHAR(120) NULL,
      created_by CHAR(36) NULL,
      created_at DATETIME(3) NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      used_at DATETIME(3) NULL,
      KEY email_tokens_email_idx (email, purpose),
      CONSTRAINT email_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT email_tokens_purpose_valid CHECK (purpose IN ('verify', 'reset', 'invite'))
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS auth_attempts (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      bucket VARCHAR(80) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      KEY auth_attempts_bucket_idx (bucket, created_at)
    ) ${TABLE_OPTIONS}`,
  ],
  [
    // Many shops on one install. Platform admins (role 'admin') run the service and belong to no shop.
    `CREATE TABLE IF NOT EXISTS shops (
      id CHAR(36) NOT NULL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(40) NULL,
      address VARCHAR(300) NULL,
      receipt_footer VARCHAR(300) NULL,
      timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Karachi',
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      KEY shops_created_at_idx (created_at)
    ) ${TABLE_OPTIONS}`,
    // "Expired" is not stored: a trialing or active subscription whose period has ended is expired.
    `CREATE TABLE IF NOT EXISTS subscriptions (
      shop_id CHAR(36) NOT NULL PRIMARY KEY,
      plan VARCHAR(20) NOT NULL DEFAULT 'basic',
      status VARCHAR(12) NOT NULL,
      price_pkr DECIMAL(14,2) NOT NULL,
      current_period_end DATETIME(3) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      KEY subscriptions_status_idx (status, current_period_end),
      CONSTRAINT subscriptions_shop_fk FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE,
      CONSTRAINT subscriptions_status_valid CHECK (status IN ('trialing', 'active', 'suspended'))
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS subscription_payments (
      id CHAR(36) NOT NULL PRIMARY KEY,
      shop_id CHAR(36) NOT NULL,
      amount DECIMAL(14,2) NOT NULL,
      method VARCHAR(20) NOT NULL,
      reference VARCHAR(120) NULL,
      months INT NOT NULL,
      period_end DATETIME(3) NOT NULL,
      recorded_by CHAR(36) NULL,
      created_at DATETIME(3) NOT NULL,
      KEY subscription_payments_shop_idx (shop_id, created_at),
      KEY subscription_payments_created_idx (created_at),
      CONSTRAINT subscription_payments_shop_fk FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE,
      CONSTRAINT subscription_payments_amount_positive CHECK (amount > 0),
      CONSTRAINT subscription_payments_months_positive CHECK (months > 0)
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS subscription_events (
      id CHAR(36) NOT NULL PRIMARY KEY,
      shop_id CHAR(36) NOT NULL,
      event VARCHAR(30) NOT NULL,
      detail VARCHAR(300) NULL,
      actor_id CHAR(36) NULL,
      created_at DATETIME(3) NOT NULL,
      KEY subscription_events_shop_idx (shop_id, created_at),
      CONSTRAINT subscription_events_shop_fk FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}`,

    // Data from a single-shop install becomes the first shop, on a trial.
    `INSERT INTO shops (id, name, timezone, created_at, updated_at)
     SELECT UUID(), 'My shop', 'Asia/Karachi', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) FROM DUAL
     WHERE NOT EXISTS (SELECT 1 FROM shops) AND (EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM products) OR EXISTS (SELECT 1 FROM sales))`,
    `INSERT INTO subscriptions (shop_id, plan, status, price_pkr, current_period_end, created_at, updated_at)
     SELECT id, 'basic', 'trialing', ${PLAN_PRICE_PKR}, UTC_TIMESTAMP(3) + INTERVAL ${TRIAL_DAYS} DAY, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
     FROM shops WHERE id NOT IN (SELECT shop_id FROM subscriptions)`,

    `ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_id CHAR(36) NULL AFTER id`,
    `UPDATE users SET shop_id = (SELECT id FROM shops ORDER BY created_at LIMIT 1) WHERE shop_id IS NULL`,
    `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_valid`,
    `ALTER TABLE users
      ADD KEY IF NOT EXISTS users_shop_id_idx (shop_id),
      ADD CONSTRAINT users_shop_fk FOREIGN KEY IF NOT EXISTS (shop_id) REFERENCES shops (id) ON DELETE CASCADE,
      ADD CONSTRAINT IF NOT EXISTS users_role_valid CHECK (role IN ('admin', 'owner', 'manager', 'cashier')),
      ADD CONSTRAINT IF NOT EXISTS users_shop_matches_role CHECK ((role = 'admin') = (shop_id IS NULL))`,

    `ALTER TABLE email_tokens ADD COLUMN IF NOT EXISTS shop_id CHAR(36) NULL AFTER purpose`,
    `UPDATE email_tokens SET shop_id = (SELECT id FROM shops ORDER BY created_at LIMIT 1) WHERE purpose = 'invite' AND shop_id IS NULL`,
    `ALTER TABLE email_tokens ADD CONSTRAINT email_tokens_shop_fk FOREIGN KEY IF NOT EXISTS (shop_id) REFERENCES shops (id) ON DELETE CASCADE`,

    `ALTER TABLE products ADD COLUMN IF NOT EXISTS shop_id CHAR(36) NULL AFTER id`,
    `UPDATE products SET shop_id = (SELECT id FROM shops ORDER BY created_at LIMIT 1) WHERE shop_id IS NULL`,
    // Codes only need to be unique within a shop.
    `ALTER TABLE products
      MODIFY shop_id CHAR(36) NOT NULL,
      DROP INDEX IF EXISTS products_active_sku_uq,
      DROP INDEX IF EXISTS products_active_barcode_uq,
      DROP INDEX IF EXISTS products_name_idx`,
    `ALTER TABLE products
      ADD UNIQUE KEY IF NOT EXISTS products_shop_sku_uq (shop_id, active_sku),
      ADD UNIQUE KEY IF NOT EXISTS products_shop_barcode_uq (shop_id, active_barcode),
      ADD KEY IF NOT EXISTS products_shop_name_idx (shop_id, name),
      ADD CONSTRAINT products_shop_fk FOREIGN KEY IF NOT EXISTS (shop_id) REFERENCES shops (id) ON DELETE CASCADE`,

    `CREATE TABLE IF NOT EXISTS customers (
      id CHAR(36) NOT NULL PRIMARY KEY,
      shop_id CHAR(36) NOT NULL,
      name VARCHAR(160) NOT NULL,
      phone VARCHAR(40) NULL,
      address VARCHAR(300) NULL,
      notes VARCHAR(1000) NULL,
      -- What the customer owes the shop (khata). Kept equal to the sum of their ledger rows.
      balance DECIMAL(14,2) NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      KEY customers_shop_name_idx (shop_id, name),
      CONSTRAINT customers_shop_fk FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS customer_ledger (
      id CHAR(36) NOT NULL PRIMARY KEY,
      shop_id CHAR(36) NOT NULL,
      customer_id CHAR(36) NOT NULL,
      kind VARCHAR(12) NOT NULL,
      amount DECIMAL(14,2) NOT NULL,
      sale_id CHAR(36) NULL,
      note VARCHAR(300) NULL,
      created_by CHAR(36) NULL,
      created_at DATETIME(3) NOT NULL,
      KEY customer_ledger_customer_idx (customer_id, created_at),
      KEY customer_ledger_shop_idx (shop_id, created_at),
      CONSTRAINT customer_ledger_shop_fk FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE,
      CONSTRAINT customer_ledger_customer_fk FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
      CONSTRAINT customer_ledger_kind_valid CHECK (kind IN ('sale', 'payment', 'adjustment')),
      CONSTRAINT customer_ledger_amount_nonzero CHECK (amount <> 0)
    ) ${TABLE_OPTIONS}`,

    `ALTER TABLE sales
      ADD COLUMN IF NOT EXISTS shop_id CHAR(36) NULL AFTER id,
      ADD COLUMN IF NOT EXISTS customer_id CHAR(36) NULL AFTER client_id,
      ADD COLUMN IF NOT EXISTS credit_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER change_given,
      ADD COLUMN IF NOT EXISTS created_by CHAR(36) NULL AFTER credit_amount`,
    `UPDATE sales SET shop_id = (SELECT id FROM shops ORDER BY created_at LIMIT 1) WHERE shop_id IS NULL`,
    // Idempotency keys come from the browser, so they are only unique within a shop.
    `ALTER TABLE sales
      MODIFY shop_id CHAR(36) NOT NULL,
      DROP INDEX IF EXISTS sales_client_id_uq,
      DROP INDEX IF EXISTS sales_created_at_idx`,
    `ALTER TABLE sales
      ADD UNIQUE KEY IF NOT EXISTS sales_shop_client_uq (shop_id, client_id),
      ADD KEY IF NOT EXISTS sales_shop_created_idx (shop_id, created_at),
      ADD KEY IF NOT EXISTS sales_customer_idx (customer_id),
      ADD CONSTRAINT sales_shop_fk FOREIGN KEY IF NOT EXISTS (shop_id) REFERENCES shops (id) ON DELETE CASCADE,
      ADD CONSTRAINT sales_customer_fk FOREIGN KEY IF NOT EXISTS (customer_id) REFERENCES customers (id)`,
    `ALTER TABLE customer_ledger ADD CONSTRAINT customer_ledger_sale_fk FOREIGN KEY IF NOT EXISTS (sale_id) REFERENCES sales (id) ON DELETE CASCADE`,

    `ALTER TABLE stock_moves
      ADD COLUMN IF NOT EXISTS shop_id CHAR(36) NULL AFTER id,
      ADD COLUMN IF NOT EXISTS created_by CHAR(36) NULL AFTER reason`,
    `UPDATE stock_moves SET shop_id = (SELECT id FROM shops ORDER BY created_at LIMIT 1) WHERE shop_id IS NULL`,
    `ALTER TABLE stock_moves
      MODIFY shop_id CHAR(36) NOT NULL,
      ADD KEY IF NOT EXISTS stock_moves_shop_created_idx (shop_id, created_at),
      ADD CONSTRAINT stock_moves_shop_fk FOREIGN KEY IF NOT EXISTS (shop_id) REFERENCES shops (id) ON DELETE CASCADE`,

    `CREATE TABLE IF NOT EXISTS suppliers (
      id CHAR(36) NOT NULL PRIMARY KEY,
      shop_id CHAR(36) NOT NULL,
      name VARCHAR(160) NOT NULL,
      phone VARCHAR(40) NULL,
      address VARCHAR(300) NULL,
      notes VARCHAR(1000) NULL,
      -- What the shop owes the supplier. Kept equal to the sum of their ledger rows.
      balance DECIMAL(14,2) NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      KEY suppliers_shop_name_idx (shop_id, name),
      CONSTRAINT suppliers_shop_fk FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS purchases (
      id CHAR(36) NOT NULL PRIMARY KEY,
      shop_id CHAR(36) NOT NULL,
      supplier_id CHAR(36) NULL,
      reference VARCHAR(80) NULL,
      total DECIMAL(14,2) NOT NULL,
      amount_paid DECIMAL(14,2) NOT NULL,
      notes VARCHAR(1000) NULL,
      created_by CHAR(36) NULL,
      created_at DATETIME(3) NOT NULL,
      KEY purchases_shop_created_idx (shop_id, created_at),
      KEY purchases_supplier_idx (supplier_id),
      CONSTRAINT purchases_shop_fk FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE,
      CONSTRAINT purchases_supplier_fk FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
      CONSTRAINT purchases_paid_valid CHECK (amount_paid >= 0 AND amount_paid <= total)
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS purchase_items (
      id CHAR(36) NOT NULL PRIMARY KEY,
      purchase_id CHAR(36) NOT NULL,
      product_id CHAR(36) NOT NULL,
      product_name VARCHAR(160) NOT NULL,
      quantity DECIMAL(14,3) NOT NULL,
      unit_cost DECIMAL(14,2) NOT NULL,
      subtotal DECIMAL(14,2) NOT NULL,
      KEY purchase_items_purchase_idx (purchase_id),
      CONSTRAINT purchase_items_purchase_fk FOREIGN KEY (purchase_id) REFERENCES purchases (id) ON DELETE CASCADE,
      CONSTRAINT purchase_items_product_fk FOREIGN KEY (product_id) REFERENCES products (id),
      CONSTRAINT purchase_items_quantity_positive CHECK (quantity > 0)
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS supplier_ledger (
      id CHAR(36) NOT NULL PRIMARY KEY,
      shop_id CHAR(36) NOT NULL,
      supplier_id CHAR(36) NOT NULL,
      kind VARCHAR(12) NOT NULL,
      amount DECIMAL(14,2) NOT NULL,
      purchase_id CHAR(36) NULL,
      note VARCHAR(300) NULL,
      created_by CHAR(36) NULL,
      created_at DATETIME(3) NOT NULL,
      KEY supplier_ledger_supplier_idx (supplier_id, created_at),
      CONSTRAINT supplier_ledger_shop_fk FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE,
      CONSTRAINT supplier_ledger_supplier_fk FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE,
      CONSTRAINT supplier_ledger_purchase_fk FOREIGN KEY (purchase_id) REFERENCES purchases (id) ON DELETE CASCADE,
      CONSTRAINT supplier_ledger_kind_valid CHECK (kind IN ('purchase', 'payment', 'adjustment')),
      CONSTRAINT supplier_ledger_amount_nonzero CHECK (amount <> 0)
    ) ${TABLE_OPTIONS}`,
  ],
  [
    // Daily sales target and the automatic day-end report (email and WhatsApp).
    `ALTER TABLE shops
      ADD COLUMN IF NOT EXISTS daily_target DECIMAL(14,2) NULL,
      ADD COLUMN IF NOT EXISTS report_enabled TINYINT(1) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS report_time CHAR(5) NOT NULL DEFAULT '22:00',
      ADD COLUMN IF NOT EXISTS report_email VARCHAR(254) NULL,
      ADD COLUMN IF NOT EXISTS report_whatsapp VARCHAR(200) NULL,
      ADD COLUMN IF NOT EXISTS report_last_sent_on DATE NULL`,
    // Money spent running the shop (rent, bills, wages). spent_on is the shop's local calendar day.
    `CREATE TABLE IF NOT EXISTS expenses (
      id CHAR(36) NOT NULL PRIMARY KEY,
      shop_id CHAR(36) NOT NULL,
      category VARCHAR(40) NOT NULL,
      amount DECIMAL(14,2) NOT NULL,
      note VARCHAR(300) NULL,
      spent_on DATE NOT NULL,
      created_by CHAR(36) NULL,
      created_at DATETIME(3) NOT NULL,
      KEY expenses_shop_day_idx (shop_id, spent_on),
      CONSTRAINT expenses_shop_fk FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE,
      CONSTRAINT expenses_amount_positive CHECK (amount > 0)
    ) ${TABLE_OPTIONS}`,
    // Every attempt to deliver a day-end report, so the owner can see what went out and what failed.
    `CREATE TABLE IF NOT EXISTS report_deliveries (
      id CHAR(36) NOT NULL PRIMARY KEY,
      shop_id CHAR(36) NOT NULL,
      day DATE NOT NULL,
      channel VARCHAR(10) NOT NULL,
      recipient VARCHAR(254) NOT NULL,
      status VARCHAR(10) NOT NULL,
      error VARCHAR(500) NULL,
      created_at DATETIME(3) NOT NULL,
      KEY report_deliveries_shop_idx (shop_id, created_at),
      CONSTRAINT report_deliveries_shop_fk FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}`,
  ],
  [
    // Invoice numbers: 1, 2, 3… per shop, in the order the sales were made. next_sale_number is the
    // shop's counter; locking the shop row while taking a number keeps numbers unique and gap-free.
    `ALTER TABLE shops ADD COLUMN IF NOT EXISTS next_sale_number INT NOT NULL DEFAULT 1`,
    `ALTER TABLE sales
      ADD COLUMN IF NOT EXISTS number INT NULL AFTER shop_id,
      ADD COLUMN IF NOT EXISTS refunded DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER credit_amount`,
    `UPDATE sales JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY shop_id ORDER BY created_at, id) AS n FROM sales) numbered ON numbered.id = sales.id
     SET sales.number = numbered.n`,
    `UPDATE shops SET next_sale_number = (SELECT COALESCE(MAX(number), 0) + 1 FROM sales WHERE sales.shop_id = shops.id)`,
    `ALTER TABLE sales
      MODIFY number INT NOT NULL,
      ADD UNIQUE KEY IF NOT EXISTS sales_shop_number_uq (shop_id, number)`,

    // Returns: items brought back from a sale. The refund goes back on the customer's khata first
    // (up to what that sale left unpaid), the rest in cash, or to the card for a card sale.
    // amount is net of the sale's discount; cost is the cost of the returned goods.
    `CREATE TABLE IF NOT EXISTS sale_returns (
      id CHAR(36) NOT NULL PRIMARY KEY,
      shop_id CHAR(36) NOT NULL,
      sale_id CHAR(36) NOT NULL,
      client_id VARCHAR(120) NULL,
      amount DECIMAL(14,2) NOT NULL,
      khata_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
      refund_method VARCHAR(10) NOT NULL,
      cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      reason VARCHAR(300) NULL,
      created_by CHAR(36) NULL,
      created_at DATETIME(3) NOT NULL,
      UNIQUE KEY sale_returns_shop_client_uq (shop_id, client_id),
      KEY sale_returns_shop_created_idx (shop_id, created_at),
      KEY sale_returns_sale_idx (sale_id),
      CONSTRAINT sale_returns_shop_fk FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE,
      CONSTRAINT sale_returns_sale_fk FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE,
      CONSTRAINT sale_returns_amounts_valid CHECK (amount >= 0 AND khata_amount >= 0 AND khata_amount <= amount),
      CONSTRAINT sale_returns_method_valid CHECK (refund_method IN ('cash', 'card'))
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS sale_return_items (
      id CHAR(36) NOT NULL PRIMARY KEY,
      return_id CHAR(36) NOT NULL,
      product_id CHAR(36) NOT NULL,
      product_name VARCHAR(160) NOT NULL,
      quantity DECIMAL(14,3) NOT NULL,
      unit_price DECIMAL(14,2) NOT NULL,
      cost_price DECIMAL(14,2) NOT NULL,
      amount DECIMAL(14,2) NOT NULL,
      KEY sale_return_items_return_idx (return_id),
      CONSTRAINT sale_return_items_return_fk FOREIGN KEY (return_id) REFERENCES sale_returns (id) ON DELETE CASCADE,
      CONSTRAINT sale_return_items_product_fk FOREIGN KEY (product_id) REFERENCES products (id),
      CONSTRAINT sale_return_items_quantity_positive CHECK (quantity > 0)
    ) ${TABLE_OPTIONS}`,
    `ALTER TABLE customer_ledger DROP CONSTRAINT IF EXISTS customer_ledger_kind_valid`,
    `ALTER TABLE customer_ledger ADD CONSTRAINT IF NOT EXISTS customer_ledger_kind_valid CHECK (kind IN ('sale', 'payment', 'adjustment', 'return'))`,
  ],
  [
    // Screenshots or PDFs of subscription payments, sent by shop owners from Billing. The file itself
    // is in object storage (lib/storage.ts). reviewed_at is set when an admin records a payment.
    `CREATE TABLE IF NOT EXISTS payment_proofs (
      id CHAR(36) NOT NULL PRIMARY KEY,
      shop_id CHAR(36) NOT NULL,
      object_key VARCHAR(300) NOT NULL,
      content_type VARCHAR(60) NOT NULL,
      size_bytes INT NOT NULL,
      note VARCHAR(300) NULL,
      uploaded_by CHAR(36) NULL,
      created_at DATETIME(3) NOT NULL,
      reviewed_at DATETIME(3) NULL,
      KEY payment_proofs_shop_idx (shop_id, created_at),
      KEY payment_proofs_pending_idx (reviewed_at, created_at),
      CONSTRAINT payment_proofs_shop_fk FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}`,
  ],
  [
    // Affiliate (partner) program (lib/local-affiliates.ts). People apply at /partner; an admin approves
    // them. A shop that signs up through an approved partner's link records them in shops.referred_by,
    // and each payment from that shop in its first 12 paid months earns the partner a commission.
    // token_hash: the partner's private page /partner/<token> (only the hash is stored).
    `CREATE TABLE IF NOT EXISTS affiliates (
      id CHAR(36) NOT NULL PRIMARY KEY,
      code VARCHAR(16) NOT NULL,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(254) NOT NULL,
      phone VARCHAR(40) NOT NULL,
      city VARCHAR(80) NULL,
      country VARCHAR(80) NULL,
      payout_method VARCHAR(20) NOT NULL,
      payout_details VARCHAR(200) NOT NULL,
      about VARCHAR(500) NULL,
      status VARCHAR(12) NOT NULL DEFAULT 'pending',
      token_hash CHAR(64) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      approved_at DATETIME(3) NULL,
      UNIQUE KEY affiliates_code_uq (code),
      UNIQUE KEY affiliates_email_uq (email),
      UNIQUE KEY affiliates_token_uq (token_hash),
      KEY affiliates_status_idx (status, created_at),
      CONSTRAINT affiliates_status_valid CHECK (status IN ('pending', 'approved', 'rejected')),
      CONSTRAINT affiliates_payout_valid CHECK (payout_method IN ('paypal', 'wise', 'payoneer', 'bank', 'mobile_wallet', 'other'))
    ) ${TABLE_OPTIONS}`,
    `ALTER TABLE shops
      ADD COLUMN IF NOT EXISTS referred_by CHAR(36) NULL AFTER timezone,
      ADD KEY IF NOT EXISTS shops_referred_by_idx (referred_by),
      ADD CONSTRAINT shops_referred_by_fk FOREIGN KEY IF NOT EXISTS (referred_by) REFERENCES affiliates (id) ON DELETE SET NULL`,
    `CREATE TABLE IF NOT EXISTS affiliate_commissions (
      id CHAR(36) NOT NULL PRIMARY KEY,
      affiliate_id CHAR(36) NOT NULL,
      shop_id CHAR(36) NOT NULL,
      payment_id CHAR(36) NOT NULL,
      months INT NOT NULL,
      amount DECIMAL(14,2) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      paid_at DATETIME(3) NULL,
      payout_note VARCHAR(200) NULL,
      UNIQUE KEY affiliate_commissions_payment_uq (payment_id),
      KEY affiliate_commissions_affiliate_idx (affiliate_id, paid_at),
      CONSTRAINT affiliate_commissions_affiliate_fk FOREIGN KEY (affiliate_id) REFERENCES affiliates (id) ON DELETE CASCADE,
      CONSTRAINT affiliate_commissions_shop_fk FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE,
      CONSTRAINT affiliate_commissions_payment_fk FOREIGN KEY (payment_id) REFERENCES subscription_payments (id) ON DELETE CASCADE,
      CONSTRAINT affiliate_commissions_amount_positive CHECK (amount > 0)
    ) ${TABLE_OPTIONS}`,
  ],
  [
    // Card billing through Paddle (lib/paddle.ts) next to manual PKR payments. A subscription now has a
    // currency and a billing interval (its price is per interval), and provider 'paddle' links it to a
    // Paddle subscription that renews by itself. Payments and partner commissions keep their currency.
    // provider_ref: the Paddle transaction, so a webhook delivered twice records one payment.
    // months 0: a mid-period plan change charged pro rata (it buys no extra time).
    `ALTER TABLE subscriptions CHANGE COLUMN IF EXISTS price_pkr price DECIMAL(14,2) NOT NULL`,
    `ALTER TABLE subscriptions
      ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'PKR' AFTER price,
      ADD COLUMN IF NOT EXISTS billing_interval VARCHAR(5) NOT NULL DEFAULT 'month' AFTER currency,
      ADD COLUMN IF NOT EXISTS provider VARCHAR(10) NOT NULL DEFAULT 'manual' AFTER billing_interval,
      ADD COLUMN IF NOT EXISTS provider_customer_id VARCHAR(64) NULL AFTER provider,
      ADD COLUMN IF NOT EXISTS provider_subscription_id VARCHAR(64) NULL AFTER provider_customer_id,
      ADD COLUMN IF NOT EXISTS provider_status VARCHAR(12) NULL AFTER provider_subscription_id,
      ADD COLUMN IF NOT EXISTS cancel_at_period_end TINYINT(1) NOT NULL DEFAULT 0 AFTER provider_status,
      ADD COLUMN IF NOT EXISTS provider_synced_at DATETIME(3) NULL AFTER cancel_at_period_end,
      ADD UNIQUE KEY IF NOT EXISTS subscriptions_provider_sub_uq (provider_subscription_id)`,
    `ALTER TABLE subscriptions ADD CONSTRAINT IF NOT EXISTS subscriptions_currency_valid CHECK (currency IN ('PKR', 'USD'))`,
    `ALTER TABLE subscriptions ADD CONSTRAINT IF NOT EXISTS subscriptions_interval_valid CHECK (billing_interval IN ('month', 'year'))`,
    `ALTER TABLE subscription_payments
      ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'PKR' AFTER amount,
      ADD COLUMN IF NOT EXISTS provider_ref VARCHAR(64) NULL AFTER reference,
      ADD UNIQUE KEY IF NOT EXISTS subscription_payments_provider_ref_uq (provider_ref)`,
    `ALTER TABLE subscription_payments DROP CONSTRAINT IF EXISTS subscription_payments_months_positive`,
    `ALTER TABLE subscription_payments ADD CONSTRAINT IF NOT EXISTS subscription_payments_months_valid CHECK (months >= 0)`,
    `ALTER TABLE subscription_payments ADD CONSTRAINT IF NOT EXISTS subscription_payments_currency_valid CHECK (currency IN ('PKR', 'USD'))`,
    `ALTER TABLE affiliate_commissions ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'PKR' AFTER amount`,
    // Every Paddle webhook event handled, by Paddle's event id: a repeat delivery is acknowledged and skipped.
    `CREATE TABLE IF NOT EXISTS billing_events (
      event_id VARCHAR(64) NOT NULL PRIMARY KEY,
      event_type VARCHAR(60) NOT NULL,
      shop_id CHAR(36) NULL,
      occurred_at DATETIME(3) NOT NULL,
      received_at DATETIME(3) NOT NULL,
      outcome VARCHAR(200) NULL,
      KEY billing_events_shop_idx (shop_id, received_at)
    ) ${TABLE_OPTIONS}`,
  ],
  [
    // Settings for the whole service, changed by platform admins (lib/local-platform.ts, /admin/settings).
    `CREATE TABLE IF NOT EXISTS platform_settings (
      name VARCHAR(60) NOT NULL PRIMARY KEY,
      value VARCHAR(500) NOT NULL,
      updated_at DATETIME(3) NOT NULL
    ) ${TABLE_OPTIONS}`,
    // card_required: the shop signed up while trials needed a card, so it stays read-only until a card
    // subscription (in its Paddle trial) or a payment is in place.
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS card_required TINYINT(1) NOT NULL DEFAULT 0 AFTER cancel_at_period_end`,
  ],
  [
    // Each shop's country (ISO 3166-1 alpha-2; 'ZZ' = not given), the key to lib/countries: currency,
    // language, tax, receipts and payment options follow from it. Shops from before are in Pakistan.
    // Rollback: deploy/rollback/0010-shop-country.sql.
    `ALTER TABLE shops ADD COLUMN IF NOT EXISTS country CHAR(2) NOT NULL DEFAULT 'PK' AFTER timezone`,
    `ALTER TABLE shops ADD KEY IF NOT EXISTS shops_country_idx (country)`,
  ],
]

// Survives Next dev hot reloads, which would otherwise open a new pool per edit.
// shoposReadyFor: how many migrations shoposReady covered, so a hot reload that adds one migrates again.
const store = globalThis as typeof globalThis & { shoposPool?: Pool; shoposReady?: Promise<void>; shoposReadyFor?: number }

function createPool() {
  return mysql.createPool({
    host: process.env.SHOPOS_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.SHOPOS_DB_PORT ?? 3306),
    database: process.env.SHOPOS_DB_NAME ?? 'shopos',
    user: process.env.SHOPOS_DB_USER ?? 'shopos',
    password: process.env.SHOPOS_DB_PASSWORD ?? '',
    connectionLimit: Number(process.env.SHOPOS_DB_POOL_SIZE ?? 10),
    charset: 'UTF8MB4_UNICODE_CI',
    timezone: 'Z',
    decimalNumbers: true,
    enableKeepAlive: true,
  })
}

async function migrate(pool: Pool) {
  const connection = await pool.getConnection()
  try {
    // Several app instances may start together; only one applies migrations.
    const [[lock]] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK('shopos_migrations', 60) AS acquired")
    if (!lock?.acquired) throw new Error('Timed out waiting for the database migration lock.')
    try {
      await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version INT NOT NULL PRIMARY KEY, applied_at DATETIME(3) NOT NULL) ${TABLE_OPTIONS}`)
      const [rows] = await connection.query<RowDataPacket[]>('SELECT version FROM schema_migrations')
      const applied = new Set(rows.map((row) => Number(row.version)))
      for (const [index, statements] of migrations.entries()) {
        const version = index + 1
        if (applied.has(version)) continue
        for (const statement of statements) await connection.query(statement)
        await connection.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [version, new Date()])
      }
    } finally {
      await connection.query("SELECT RELEASE_LOCK('shopos_migrations')")
    }
  } finally {
    connection.release()
  }
}

export async function getPool() {
  store.shoposPool ??= createPool()
  if (store.shoposReadyFor !== migrations.length) {
    store.shoposReady = undefined
    store.shoposReadyFor = migrations.length
  }
  store.shoposReady ??= migrate(store.shoposPool).catch((error) => {
    store.shoposReady = undefined
    throw error
  })
  await store.shoposReady
  return store.shoposPool
}

export const isDbError = (error: unknown, errno: number): error is Error & { errno: number } =>
  error instanceof Error && (error as { errno?: number }).errno === errno
export const ER_DUP_ENTRY = 1062
const ER_LOCK_DEADLOCK = 1213

export async function withTransaction<T>(work: (connection: PoolConnection) => Promise<T>) {
  const pool = await getPool()
  for (let attempt = 1; ; attempt += 1) {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const result = await work(connection)
      await connection.commit()
      return result
    } catch (error) {
      await connection.rollback().catch(() => undefined)
      if (isDbError(error, ER_LOCK_DEADLOCK) && attempt < 3) continue
      throw error
    } finally {
      connection.release()
    }
  }
}

export const roundMoney = (value: number) => Math.round(value * 100) / 100
export const iso = (value: Date | string) => new Date(value).toISOString()
export const likePattern = (query: string) => `%${query.replace(/[\\%_]/g, '\\$&')}%`

export function productFromRow(row: RowDataPacket): LocalProduct {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    category: row.category,
    unit: row.unit,
    cost_price: Number(row.cost_price),
    sale_price: Number(row.sale_price),
    stock_quantity: Number(row.stock_quantity),
    reorder_level: Number(row.reorder_level),
    image_url: row.image_url,
    is_active: Boolean(row.is_active),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  }
}

async function getProduct(db: Queryable, shopId: string, id: string, lock = false) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE shop_id = ? AND id = ? AND is_active = 1${lock ? ' FOR UPDATE' : ''}`, [shopId, id])
  return rows[0] ? productFromRow(rows[0]) : null
}

function productValues(input: LocalProductInput) {
  return {
    name: input.name,
    sku: input.sku || null,
    barcode: input.barcode || null,
    category: input.category || null,
    unit: input.unit || 'pcs',
    cost_price: input.cost_price,
    sale_price: input.sale_price,
    stock_quantity: input.stock_quantity,
    reorder_level: input.reorder_level,
    image_url: input.image_url || null,
  }
}

const duplicateCodeMessage = (label: string) => `${label} is already in use by another product.`

async function assertUniqueCodes(db: Queryable, shopId: string, input: LocalProductInput, excludeId = '') {
  const codes = [['sku', 'SKU', input.sku], ['barcode', 'Barcode', input.barcode]] as const
  for (const [column, label, value] of codes) {
    if (!value) continue
    // The column collation is case-insensitive, so "abc" and "ABC" clash.
    const [rows] = await db.query<RowDataPacket[]>(`SELECT 1 FROM products WHERE shop_id = ? AND is_active = 1 AND id <> ? AND ${column} = ? LIMIT 1`, [shopId, excludeId, value])
    if (rows.length) throw new LocalDataError(duplicateCodeMessage(label), 409)
  }
}

// Two requests can pass the check above at once; the unique keys catch the loser.
function translateDuplicateCode(error: unknown): never {
  if (isDbError(error, ER_DUP_ENTRY)) {
    if (error.message.includes('products_shop_sku_uq')) throw new LocalDataError(duplicateCodeMessage('SKU'), 409)
    if (error.message.includes('products_shop_barcode_uq')) throw new LocalDataError(duplicateCodeMessage('Barcode'), 409)
  }
  throw error
}

export async function getLocalProduct(shopId: string, id: string) {
  return getProduct(await getPool(), shopId, id)
}

// Whether any product of the shop (removed ones too) still shows this photo.
export async function productPhotoInUse(shopId: string, url: string) {
  const [rows] = await (await getPool()).query<RowDataPacket[]>('SELECT 1 FROM products WHERE shop_id = ? AND image_url = ? LIMIT 1', [shopId, url])
  return rows.length > 0
}

export async function listLocalProducts(shopId: string, search = '') {
  const query = search.trim()
  const like = likePattern(query)
  const [rows] = await (await getPool()).query<RowDataPacket[]>(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE shop_id = ? AND is_active = 1 AND (? = '' OR name LIKE ? OR sku LIKE ? OR barcode LIKE ?) ORDER BY name`,
    [shopId, query, like, like, like],
  )
  return rows.map(productFromRow)
}

export async function insertLocalProduct(shopId: string, input: LocalProductInput) {
  return withTransaction(async (connection) => {
    await assertUniqueCodes(connection, shopId, input)
    const id = randomUUID()
    const now = new Date()
    const values = productValues(input)
    await connection.query(
      `INSERT INTO products (id, shop_id, name, sku, barcode, category, unit, cost_price, sale_price, stock_quantity, reorder_level, image_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, shopId, values.name, values.sku, values.barcode, values.category, values.unit, values.cost_price, values.sale_price, values.stock_quantity, values.reorder_level, values.image_url, now, now],
    )
    return getProduct(connection, shopId, id)
  }).catch(translateDuplicateCode)
}

export async function updateLocalProduct(shopId: string, id: string, input: LocalProductInput) {
  return withTransaction(async (connection) => {
    if (!(await getProduct(connection, shopId, id, true))) return null
    await assertUniqueCodes(connection, shopId, input, id)
    const values = productValues(input)
    await connection.query(
      `UPDATE products SET name = ?, sku = ?, barcode = ?, category = ?, unit = ?, cost_price = ?, sale_price = ?,
       stock_quantity = ?, reorder_level = ?, image_url = ?, updated_at = ? WHERE shop_id = ? AND id = ? AND is_active = 1`,
      [values.name, values.sku, values.barcode, values.category, values.unit, values.cost_price, values.sale_price, values.stock_quantity, values.reorder_level, values.image_url, new Date(), shopId, id],
    )
    return getProduct(connection, shopId, id)
  }).catch(translateDuplicateCode)
}

export async function removeLocalProduct(shopId: string, id: string) {
  const [result] = await (await getPool()).query<ResultSetHeader>('UPDATE products SET is_active = 0, updated_at = ? WHERE shop_id = ? AND id = ? AND is_active = 1', [new Date(), shopId, id])
  return result.affectedRows > 0
}

export async function adjustLocalStock(shopId: string, productId: string, delta: number, reason: string, actorId: string | null = null) {
  return withTransaction(async (connection) => {
    const product = await getProduct(connection, shopId, productId, true)
    if (!product) throw new LocalDataError('Product not found.', 404)
    if (product.stock_quantity + delta < 0) throw new LocalDataError('Stock cannot be reduced below zero.', 409)
    const now = new Date()
    await connection.query('UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?', [delta, now, productId])
    await connection.query('INSERT INTO stock_moves (id, shop_id, product_id, delta, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [randomUUID(), shopId, productId, delta, reason.trim(), actorId, now])
    return (await getProduct(connection, shopId, productId))!
  })
}

function saleFromRow(row: RowDataPacket, items: LocalSaleItem[]): LocalSale {
  return {
    id: row.id,
    number: Number(row.number),
    client_id: row.client_id,
    total: Number(row.total),
    discount: Number(row.discount),
    payment_method: row.payment_method,
    amount_paid: Number(row.amount_paid),
    change_given: Number(row.change_given),
    credit_amount: Number(row.credit_amount),
    refunded: Number(row.refunded),
    customer_id: row.customer_id,
    customer_name: row.customer_name ?? null,
    created_by_name: row.created_by_name ?? null,
    created_at: iso(row.created_at),
    items,
  }
}

async function attachItems(db: Queryable, rows: RowDataPacket[]) {
  if (!rows.length) return []
  // A product appears once per sale, so returns match sale lines by product.
  const [itemRows] = await db.query<RowDataPacket[]>(
    `SELECT sale_items.sale_id, sale_items.product_id, sale_items.product_name, sale_items.quantity, sale_items.unit_price, sale_items.cost_price, sale_items.subtotal,
       (SELECT COALESCE(SUM(ri.quantity), 0) FROM sale_return_items ri JOIN sale_returns r ON r.id = ri.return_id WHERE r.sale_id = sale_items.sale_id AND ri.product_id = sale_items.product_id) AS returned_quantity
     FROM sale_items WHERE sale_items.sale_id IN (?) ORDER BY sale_items.product_name`,
    [rows.map((row) => row.id)],
  )
  const itemsBySale = new Map<string, LocalSaleItem[]>()
  for (const item of itemRows) {
    const list = itemsBySale.get(item.sale_id) ?? []
    list.push({ product_id: item.product_id, product_name: item.product_name, quantity: Number(item.quantity), unit_price: Number(item.unit_price), cost_price: Number(item.cost_price), subtotal: Number(item.subtotal), returned_quantity: Number(item.returned_quantity) })
    itemsBySale.set(item.sale_id, list)
  }
  return rows.map((row) => saleFromRow(row, itemsBySale.get(row.id) ?? []))
}

async function findSale(db: Queryable, shopId: string, column: 'id' | 'client_id', value: string) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${SALE_COLUMNS} FROM ${SALE_FROM} WHERE sales.shop_id = ? AND sales.${column} = ?`, [shopId, value])
  return (await attachItems(db, rows))[0] ?? null
}

export async function createLocalSale(shopId: string, input: LocalSaleInput, actorId: string | null = null): Promise<LocalSale> {
  try {
    return await withTransaction(async (connection) => {
      // A retried checkout (same client_id) returns the sale that was already recorded.
      if (input.client_id) {
        const existing = await findSale(connection, shopId, 'client_id', input.client_id)
        if (existing) return existing
      }

      // Lock the products in a fixed order so concurrent sales cannot deadlock or oversell.
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT ${PRODUCT_COLUMNS} FROM products WHERE shop_id = ? AND is_active = 1 AND id IN (?) ORDER BY id FOR UPDATE`,
        [shopId, input.items.map((item) => item.product_id)],
      )
      const productsById = new Map(rows.map((row) => [row.id as string, productFromRow(row)]))
      const lines = input.items.map(({ product_id, quantity }) => {
        const product = productsById.get(product_id)
        if (!product) throw new LocalDataError('A product in this sale is no longer available.', 404)
        if (quantity > product.stock_quantity && !input.offline) throw new LocalDataError(`Not enough stock for ${product.name}.`, 409)
        return { product, quantity, subtotal: roundMoney(product.sale_price * quantity) }
      })

      if (input.payment_method === 'credit' && !input.customer_id) throw new LocalDataError('Choose a customer for a credit (khata) sale.', 400)
      if (input.customer_id) {
        const [customer] = await connection.query<RowDataPacket[]>('SELECT id FROM customers WHERE shop_id = ? AND id = ? AND is_active = 1 FOR UPDATE', [shopId, input.customer_id])
        if (!customer.length) throw new LocalDataError('Customer not found.', 404)
      }

      const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.subtotal, 0))
      const discount = roundMoney(input.discount ?? 0)
      if (discount > subtotal) throw new LocalDataError('Discount cannot exceed the sale subtotal.', 400)
      const total = roundMoney(subtotal - discount)
      // A credit sale may be paid in part (or not at all); the rest goes on the customer's khata.
      const credit = input.payment_method === 'credit'
      const amountPaid = roundMoney(input.amount_paid ?? (credit ? 0 : total))
      if (!credit && amountPaid < total) throw new LocalDataError('Amount paid must cover the sale total.', 400)
      if (credit && amountPaid > total) throw new LocalDataError('For a credit sale, the amount paid cannot be more than the total.', 400)
      const creditAmount = credit ? roundMoney(total - amountPaid) : 0

      // Taken last: the shop row lock serialises this shop's checkouts only for the final inserts.
      const [[counter]] = await connection.query<RowDataPacket[]>('SELECT next_sale_number FROM shops WHERE id = ? FOR UPDATE', [shopId])
      if (!counter) throw new LocalDataError('Shop not found.', 404)
      const number = Number(counter.next_sale_number)
      await connection.query('UPDATE shops SET next_sale_number = ? WHERE id = ?', [number + 1, shopId])

      const id = randomUUID()
      const createdAt = input.offline ? offlineSaleTime(input.sold_at) : new Date()
      await connection.query(
        `INSERT INTO sales (id, shop_id, number, client_id, customer_id, total, discount, payment_method, amount_paid, change_given, credit_amount, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, shopId, number, input.client_id ?? null, input.customer_id ?? null, total, discount, input.payment_method, amountPaid, credit ? 0 : roundMoney(amountPaid - total), creditAmount, actorId, createdAt],
      )
      for (const { product, quantity, subtotal: lineSubtotal } of lines) {
        await connection.query(
          'INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, unit_price, cost_price, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [randomUUID(), id, product.id, product.name, quantity, product.sale_price, product.cost_price, lineSubtotal],
        )
        await connection.query('UPDATE products SET stock_quantity = GREATEST(stock_quantity - ?, 0), updated_at = ? WHERE id = ?', [quantity, new Date(), product.id])
      }
      if (creditAmount > 0) {
        await connection.query('UPDATE customers SET balance = balance + ?, updated_at = ? WHERE id = ?', [creditAmount, createdAt, input.customer_id])
        await connection.query(
          'INSERT INTO customer_ledger (id, shop_id, customer_id, kind, amount, sale_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [randomUUID(), shopId, input.customer_id, 'sale', creditAmount, id, `Sale #${number}`, actorId, createdAt],
        )
      }
      return (await findSale(connection, shopId, 'id', id))!
    })
  } catch (error) {
    // Two requests with the same client_id raced; the first one won, so return its sale.
    if (input.client_id && isDbError(error, ER_DUP_ENTRY) && error.message.includes('sales_shop_client_uq')) {
      const existing = await findSale(await getPool(), shopId, 'client_id', input.client_id)
      if (existing) return existing
    }
    throw error
  }
}

// Newest first. search matches the invoice number ("12" or "#12"), the customer or a product name.
export async function listLocalSales(shopId: string, filter: LocalSaleFilter = {}) {
  const pool = await getPool()
  const conditions = ['sales.shop_id = ?']
  const values: unknown[] = [shopId]
  const search = filter.search?.trim() ?? ''
  if (search) {
    const like = likePattern(search)
    const number = /^#?\d{1,9}$/.test(search) ? Number(search.replace('#', '')) : -1
    conditions.push('(sales.number = ? OR customers.name LIKE ? OR EXISTS (SELECT 1 FROM sale_items WHERE sale_items.sale_id = sales.id AND sale_items.product_name LIKE ?))')
    values.push(number, like, like)
  }
  if (filter.start) {
    conditions.push('sales.created_at >= ?')
    values.push(filter.start)
  }
  if (filter.end) {
    conditions.push('sales.created_at < ?')
    values.push(filter.end)
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${SALE_COLUMNS} FROM ${SALE_FROM} WHERE ${conditions.join(' AND ')} ORDER BY sales.created_at DESC, sales.id LIMIT ? OFFSET ?`,
    [...values, filter.limit ?? 20, filter.offset ?? 0],
  )
  return attachItems(pool, rows)
}

async function listReturns(db: Queryable, saleId: string): Promise<LocalSaleReturn[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT sale_returns.*, users.full_name AS created_by_name FROM sale_returns LEFT JOIN users ON users.id = sale_returns.created_by
     WHERE sale_returns.sale_id = ? ORDER BY sale_returns.created_at, sale_returns.id`,
    [saleId],
  )
  if (!rows.length) return []
  const [items] = await db.query<RowDataPacket[]>('SELECT return_id, product_id, product_name, quantity, amount FROM sale_return_items WHERE return_id IN (?) ORDER BY product_name', [rows.map((row) => row.id)])
  return rows.map((row) => ({
    id: row.id,
    amount: Number(row.amount),
    khata_amount: Number(row.khata_amount),
    refund_method: row.refund_method,
    reason: row.reason,
    created_by_name: row.created_by_name ?? null,
    created_at: iso(row.created_at),
    items: items.filter((item) => item.return_id === row.id).map((item) => ({ product_id: item.product_id, product_name: item.product_name, quantity: Number(item.quantity), amount: Number(item.amount) })),
  }))
}

// One sale with everything returned from it.
export async function getLocalSale(shopId: string, id: string, db?: Queryable) {
  const queryable = db ?? (await getPool())
  const sale = await findSale(queryable, shopId, 'id', id)
  if (!sale) return null
  return { ...sale, returns: await listReturns(queryable, id) }
}

// Takes items back from a sale: puts them back in stock and refunds their share of what was paid
// (the sale's discount is shared across its items). The refund first comes off the customer's
// khata, up to what this sale left unpaid, and the rest is cash, or goes back to the card.
export async function returnLocalSale(shopId: string, saleId: string, input: LocalSaleReturnInput, actorId: string | null = null) {
  try {
    return await withTransaction(async (connection) => {
      // Lock the sale before any plain read: InnoDB fixes a transaction's snapshot at its first
      // non-locking read, so later reads then see returns committed by a concurrent request.
      const [saleRows] = await connection.query<RowDataPacket[]>('SELECT id, number, total, payment_method, credit_amount, refunded, customer_id FROM sales WHERE shop_id = ? AND id = ? FOR UPDATE', [shopId, saleId])
      const sale = saleRows[0]
      if (!sale) throw new LocalDataError('Sale not found.', 404)

      // A retried request (same client_id) returns the sale as the first attempt left it.
      if (input.client_id) {
        const [existing] = await connection.query<RowDataPacket[]>('SELECT sale_id FROM sale_returns WHERE shop_id = ? AND client_id = ?', [shopId, input.client_id])
        if (existing[0]) {
          if (existing[0].sale_id !== saleId) throw new LocalDataError('This return was already recorded for another sale.', 409)
          return (await getLocalSale(shopId, saleId, connection))!
        }
      }

      const found = (await findSale(connection, shopId, 'id', saleId))!
      const saleItems = new Map(found.items.map((item) => [item.product_id, item]))

      const ids = input.items.map((item) => item.product_id)
      if (new Set(ids).size !== ids.length) throw new LocalDataError('Each product can only appear once in a return.', 400)
      const gross = found.items.reduce((sum, item) => sum + item.subtotal, 0)
      // What the customer actually paid per rupee of list price, after the sale's discount.
      const paidShare = gross > 0 ? Number(sale.total) / gross : 0
      const lines = input.items.map(({ product_id, quantity }) => {
        const item = saleItems.get(product_id)
        if (!item) throw new LocalDataError('That product is not part of this sale.', 400)
        const left = roundQuantity(item.quantity - item.returned_quantity)
        if (quantity > left) throw new LocalDataError(left > 0 ? `Only ${left} of ${item.product_name} can still be returned.` : `${item.product_name} has already been returned.`, 409)
        return { item, quantity, amount: roundMoney(item.unit_price * quantity * paidShare) }
      })

      const total = Number(sale.total)
      const alreadyRefunded = Number(sale.refunded)
      const everythingBack = found.items.every((item) => roundQuantity(item.quantity - item.returned_quantity - (lines.find((line) => line.item === item)?.quantity ?? 0)) <= 0)
      // The last return settles the sale exactly, whatever the rounding on earlier ones.
      const amount = everythingBack ? roundMoney(total - alreadyRefunded) : Math.min(roundMoney(lines.reduce((sum, line) => sum + line.amount, 0)), roundMoney(total - alreadyRefunded))
      const cost = roundMoney(lines.reduce((sum, line) => sum + line.item.cost_price * line.quantity, 0))

      // Lock the products in a fixed order, as sales do.
      await connection.query('SELECT id FROM products WHERE shop_id = ? AND id IN (?) ORDER BY id FOR UPDATE', [shopId, ids])

      let khataAmount = 0
      if (sale.customer_id && Number(sale.credit_amount) > 0) {
        const [[previous]] = await connection.query<RowDataPacket[]>('SELECT COALESCE(SUM(khata_amount), 0) AS khata FROM sale_returns WHERE sale_id = ?', [saleId])
        const [[customer]] = await connection.query<RowDataPacket[]>('SELECT balance FROM customers WHERE id = ? FOR UPDATE', [sale.customer_id])
        const unpaidOnSale = roundMoney(Number(sale.credit_amount) - Number(previous.khata))
        khataAmount = roundMoney(Math.max(0, Math.min(amount, unpaidOnSale, Number(customer?.balance ?? 0))))
      }

      const id = randomUUID()
      const now = new Date()
      const label = `Return on sale #${sale.number}`
      await connection.query(
        'INSERT INTO sale_returns (id, shop_id, sale_id, client_id, amount, khata_amount, refund_method, cost, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, shopId, saleId, input.client_id ?? null, amount, khataAmount, sale.payment_method === 'card' ? 'card' : 'cash', cost, input.reason?.trim() || null, actorId, now],
      )
      for (const { item, quantity, amount: lineAmount } of lines) {
        await connection.query(
          'INSERT INTO sale_return_items (id, return_id, product_id, product_name, quantity, unit_price, cost_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [randomUUID(), id, item.product_id, item.product_name, quantity, item.unit_price, item.cost_price, lineAmount],
        )
        await connection.query('UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE shop_id = ? AND id = ?', [quantity, now, shopId, item.product_id])
        await connection.query('INSERT INTO stock_moves (id, shop_id, product_id, delta, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [randomUUID(), shopId, item.product_id, quantity, label, actorId, now])
      }
      await connection.query('UPDATE sales SET refunded = refunded + ? WHERE id = ?', [amount, saleId])
      if (khataAmount > 0) {
        await connection.query('UPDATE customers SET balance = balance - ?, updated_at = ? WHERE id = ?', [khataAmount, now, sale.customer_id])
        await connection.query(
          "INSERT INTO customer_ledger (id, shop_id, customer_id, kind, amount, sale_id, note, created_by, created_at) VALUES (?, ?, ?, 'return', ?, ?, ?, ?, ?)",
          [randomUUID(), shopId, sale.customer_id, -khataAmount, saleId, label, actorId, now],
        )
      }
      return (await getLocalSale(shopId, saleId, connection))!
    })
  } catch (error) {
    // Two requests with the same client_id raced; the first one recorded the return.
    if (input.client_id && isDbError(error, ER_DUP_ENTRY) && error.message.includes('sale_returns_shop_client_uq')) {
      const sale = await getLocalSale(shopId, saleId)
      if (sale) return sale
    }
    throw error
  }
}

const roundQuantity = (value: number) => Math.round(value * 1000) / 1000

export async function getLocalDashboardStats(shopId: string, timezone: string) {
  const pool = await getPool()
  const today = dayKey(timezone)
  const startAt = dayStart(timezone, today)
  const weekKeys = dayRange(addDays(today, -6), today)
  const weekStart = dayStart(timezone, weekKeys[0])

  const [[totals]] = await pool.query<RowDataPacket[]>('SELECT COALESCE(SUM(total), 0) AS sales, COALESCE(SUM(discount), 0) AS discounts, COUNT(*) AS count FROM sales WHERE shop_id = ? AND created_at >= ?', [shopId, startAt])
  const [[margin]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM((sale_items.unit_price - sale_items.cost_price) * sale_items.quantity), 0) AS margin
     FROM sale_items JOIN sales ON sales.id = sale_items.sale_id WHERE sales.shop_id = ? AND sales.created_at >= ?`,
    [shopId, startAt],
  )
  const [lowRows] = await pool.query<RowDataPacket[]>(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE shop_id = ? AND is_active = 1 AND stock_quantity <= reorder_level ORDER BY name`, [shopId])
  const [recentRows] = await pool.query<RowDataPacket[]>(`SELECT ${SALE_COLUMNS} FROM ${SALE_FROM} WHERE sales.shop_id = ? AND sales.created_at >= ? ORDER BY sales.created_at DESC, sales.id LIMIT 10`, [shopId, startAt])
  // Returns count on the day the goods came back, as negative sales.
  const [[returned]] = await pool.query<RowDataPacket[]>('SELECT COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(cost), 0) AS cost FROM sale_returns WHERE shop_id = ? AND created_at >= ?', [shopId, startAt])
  const [weekRows] = await pool.query<RowDataPacket[]>(
    'SELECT total, created_at FROM sales WHERE shop_id = ? AND created_at >= ? UNION ALL SELECT -amount, created_at FROM sale_returns WHERE shop_id = ? AND created_at >= ?',
    [shopId, weekStart, shopId, weekStart],
  )
  const [[credit]] = await pool.query<RowDataPacket[]>('SELECT COALESCE(SUM(balance), 0) AS owed, COUNT(*) AS customers FROM customers WHERE shop_id = ? AND is_active = 1 AND balance > 0', [shopId])
  // Target, today's expenses and what a new shop has set up so far (the getting-started checklist).
  const [[setup]] = await pool.query<RowDataPacket[]>(
    `SELECT shops.daily_target, shops.phone, shops.address, shops.report_enabled,
       (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE shop_id = shops.id AND spent_on = ?) AS expenses_today,
       EXISTS (SELECT 1 FROM products WHERE shop_id = shops.id) AS has_products,
       EXISTS (SELECT 1 FROM sales WHERE shop_id = shops.id) AS has_sales,
       EXISTS (SELECT 1 FROM customers WHERE shop_id = shops.id) AS has_customers,
       (EXISTS (SELECT 1 FROM users WHERE shop_id = shops.id AND role <> 'owner') OR EXISTS (SELECT 1 FROM email_tokens WHERE shop_id = shops.id AND purpose = 'invite')) AS has_staff
     FROM shops WHERE shops.id = ?`,
    [today, shopId],
  )

  const byDay = new Map(weekKeys.map((key) => [key, 0]))
  for (const row of weekRows) {
    const key = dayKey(timezone, new Date(row.created_at))
    if (byDay.has(key)) byDay.set(key, roundMoney(byDay.get(key)! + Number(row.total)))
  }
  const lowProducts = lowRows.map(productFromRow)
  return {
    sales: roundMoney(Number(totals.sales) - Number(returned.amount)),
    profit: roundMoney(Number(margin.margin) - Number(totals.discounts) - (Number(returned.amount) - Number(returned.cost))),
    returnsToday: roundMoney(Number(returned.amount)),
    lowStock: lowProducts.length,
    salesCount: Number(totals.count),
    lowProducts,
    recent: await attachItems(pool, recentRows),
    week: weekKeys.map((day) => ({ day, total: byDay.get(day) ?? 0 })),
    creditOutstanding: roundMoney(Number(credit.owed)),
    creditCustomers: Number(credit.customers),
    target: setup?.daily_target === null || setup?.daily_target === undefined ? null : Number(setup.daily_target),
    expensesToday: roundMoney(Number(setup?.expenses_today ?? 0)),
    checklist: {
      products: Boolean(setup?.has_products),
      sale: Boolean(setup?.has_sales),
      customers: Boolean(setup?.has_customers),
      staff: Boolean(setup?.has_staff),
      profile: Boolean(setup?.phone || setup?.address),
      dayEnd: Boolean(setup?.report_enabled),
    },
  }
}

export async function localDbHealth() {
  await (await getPool()).query('SELECT 1')
}
