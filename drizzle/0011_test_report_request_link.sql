ALTER TABLE `artifacts` ADD COLUMN `release_request_id` text;
CREATE INDEX `artifacts_release_request_idx` ON `artifacts` (`release_request_id`,`kind`);

UPDATE `artifacts`
SET `release_request_id` = (
  SELECT `release_requests`.`id`
  FROM `release_requests`
  WHERE `release_requests`.`release_id` = `artifacts`.`release_id`
    AND `release_requests`.`tested_at` = `artifacts`.`created_at`
  LIMIT 1
)
WHERE `kind` = '测试报告' AND `release_request_id` IS NULL;
