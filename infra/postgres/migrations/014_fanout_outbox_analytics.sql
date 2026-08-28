-- Fan out durable inbox and transactional email records into outbox_events so
-- the worker can deliver push/email without the routes knowing about providers.
-- Payloads carry only opaque identifiers and safe enum kinds; never location,
-- scores, raw tokens, or email bodies (ADR-0009, roadmap item 6).
--
-- The notification fan-out also writes one non-coordinate analytic event so the
-- analytic_events schema (011) is exercised end to end.

CREATE OR REPLACE FUNCTION runsphere_notification_outbox() RETURNS trigger AS $$
BEGIN
  INSERT INTO outbox_events (topic, aggregate_id, payload)
  VALUES (
    'notification.created',
    NEW.id,
    jsonb_build_object(
      'notificationId', NEW.id::text,
      'accountId', NEW.account_id::text,
      'kind', NEW.kind
    )
  );
  INSERT INTO analytic_events (event_name, account_id, feature_version, payload)
  VALUES ('notification_created', NEW.account_id, 'foundation-1',
    jsonb_build_object('kind', NEW.kind));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notification_inbox_outbox_trigger ON notification_inbox;
CREATE TRIGGER notification_inbox_outbox_trigger
  AFTER INSERT ON notification_inbox
  FOR EACH ROW EXECUTE FUNCTION runsphere_notification_outbox();

CREATE OR REPLACE FUNCTION runsphere_email_outbox() RETURNS trigger AS $$
BEGIN
  INSERT INTO outbox_events (topic, aggregate_id, payload)
  VALUES ('email.transactional', NEW.id, jsonb_build_object('kind', TG_ARGV[0]));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS password_reset_email_trigger ON password_reset_tokens;
CREATE TRIGGER password_reset_email_trigger
  AFTER INSERT ON password_reset_tokens
  FOR EACH ROW EXECUTE FUNCTION runsphere_email_outbox('password_reset');

-- A change-email request produces two deliverables: verification to the new
-- address and the required old-address alert.
DROP TRIGGER IF EXISTS email_change_verify_trigger ON email_change_requests;
CREATE TRIGGER email_change_verify_trigger
  AFTER INSERT ON email_change_requests
  FOR EACH ROW EXECUTE FUNCTION runsphere_email_outbox('change_verify');

DROP TRIGGER IF EXISTS email_change_alert_trigger ON email_change_requests;
CREATE TRIGGER email_change_alert_trigger
  AFTER INSERT ON email_change_requests
  FOR EACH ROW EXECUTE FUNCTION runsphere_email_outbox('change_alert_old');

DROP TRIGGER IF EXISTS public_deletion_email_trigger ON public_deletion_requests;
CREATE TRIGGER public_deletion_email_trigger
  AFTER INSERT ON public_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION runsphere_email_outbox('deletion_verify');
