-- AlterTable
ALTER TABLE `order_items` ADD COLUMN `promotion_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `loyalty_discount` DECIMAL(12, 2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `message_outbox` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `channel` ENUM('IN_APP', 'EMAIL', 'SMS', 'PUSH') NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `user_id` INTEGER NULL,
    `template` VARCHAR(60) NOT NULL,
    `subject` VARCHAR(200) NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_error` VARCHAR(500) NULL,
    `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `message_outbox_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    INDEX `message_outbox_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `order_items_promotion_id_idx` ON `order_items`(`promotion_id`);

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_promotion_id_fkey` FOREIGN KEY (`promotion_id`) REFERENCES `promotions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

