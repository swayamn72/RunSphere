import type { Database } from '@runsphere/db';
import type { Logger } from '@runsphere/observability';
import { CAMPAIGN_TOPIC } from './campaigns.js';
import {
  EMAIL_TRANSACTIONAL_TOPIC,
  createHttpEmailSender,
  deliverCampaign,
  deliverTransactional,
  readEmailCredentials,
  type EmailCredentials,
  type EmailSender
} from './email-delivery.js';
import {
  NOTIFICATION_TOPIC,
  createFcmSender,
  createPushDelivery,
  readFcmCredentials,
  type DeliveryHandler
} from './push-delivery.js';

/**
 * The one handler `processNextDelivery` calls, routing each outbox topic to
 * whatever carries it (ADR-0009).
 *
 * Before this, push had a handler that logged `delivery.deferred` for the two
 * email topics and returned — which drained them into nothing. That was the
 * honest behaviour while no provider existed; now that both exist, the routing
 * has to be explicit, and it has to keep the property that made the old
 * behaviour safe: **an unconfigured provider drops its events with a log line
 * rather than failing them.** A topic that failed would burn the outbox attempt
 * budget and mark deliverable mail permanently dead.
 */

export interface DeliveryDeps {
  db: Database;
  logger: Logger;
  pushSender?: ReturnType<typeof createFcmSender>;
  emailSender?: EmailSender;
  emailCredentials?: EmailCredentials;
}

export const createDelivery = ({
  db,
  logger,
  pushSender,
  emailSender,
  emailCredentials
}: DeliveryDeps): DeliveryHandler => {
  const push = createPushDelivery({ db, logger, ...(pushSender ? { sender: pushSender } : {}) });
  const email = {
    db,
    logger,
    ...(emailSender ? { sender: emailSender } : {}),
    ...(emailCredentials ? { credentials: emailCredentials } : {})
  };

  return async (topic, aggregateId, payload) => {
    if (topic === NOTIFICATION_TOPIC) return push(topic, aggregateId, payload);
    if (topic === EMAIL_TRANSACTIONAL_TOPIC)
      return deliverTransactional(email, aggregateId, payload);
    if (topic === CAMPAIGN_TOPIC) {
      await deliverCampaign(email, aggregateId);
      return;
    }
    logger.info('delivery.deferred', { topic });
  };
};

/**
 * Read both providers from the environment and say plainly which are
 * configured.
 *
 * Logged at startup rather than discovered from silence: "no push arrived" and
 * "no push provider is configured" look identical from the outside, and the
 * second is a deployment mistake somebody can fix in a minute.
 */
export const createConfiguredDelivery = (
  db: Database,
  logger: Logger,
  environment: NodeJS.ProcessEnv = process.env
): DeliveryHandler => {
  const fcm = readFcmCredentials(environment);
  const emailCredentials = readEmailCredentials(environment);
  logger.info('worker.delivery_providers', {
    push: fcm !== undefined,
    email: emailCredentials !== undefined
  });
  return createDelivery({
    db,
    logger,
    ...(fcm ? { pushSender: createFcmSender(fcm) } : {}),
    ...(emailCredentials
      ? { emailCredentials, emailSender: createHttpEmailSender(emailCredentials) }
      : {})
  });
};
