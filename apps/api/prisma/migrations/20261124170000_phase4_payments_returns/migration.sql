-- AlterTable
ALTER TABLE `orders` ADD COLUMN `payment_due_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `payments` MODIFY `provider` ENUM('PAYSTACK', 'HUBTEL', 'CASH_ON_DELIVERY', 'SIMULATOR') NOT NULL,
    MODIFY `method` ENUM('ONLINE', 'MOMO_MTN', 'MOMO_TELECEL', 'MOMO_AT', 'CARD', 'BANK_TRANSFER', 'CASH') NOT NULL;

-- AlterTable
ALTER TABLE `refunds` ADD COLUMN `note` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `returns` ADD COLUMN `exchange_order_id` INTEGER NULL,
    ADD COLUMN `refund_amount` DECIMAL(12, 2) NULL;

-- AlterTable
ALTER TABLE `webhook_events` MODIFY `provider` ENUM('PAYSTACK', 'HUBTEL', 'CASH_ON_DELIVERY', 'SIMULATOR') NOT NULL;

-- CreateIndex
CREATE INDEX `orders_status_payment_due_at_idx` ON `orders`(`status`, `payment_due_at`);

-- CreateIndex
CREATE UNIQUE INDEX `returns_exchange_order_id_key` ON `returns`(`exchange_order_id`);

