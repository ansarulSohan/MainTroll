import os
import boto3
import pymysql
from botocore.config import Config
from pymysql.cursors import DictCursor

sns = boto3.client(
    "sns",
    config=Config(connect_timeout=5, read_timeout=10, retries={"max_attempts": 1}),
)

# 1. Alerts for tasks that are completed or cancelled are closed
RESOLVE_DONE_TASKS = """
    UPDATE alerts a
    JOIN maintenance_tasks t ON t.task_id = a.task_id
    SET a.state = 'Resolved'
    WHERE a.state = 'Open' AND t.status IN ('Completed', 'Cancelled')
"""

# 2. New alerts for overdue tasks
CREATE_TASK_ALERTS = """
    INSERT INTO alerts (alert_id, task_id, document_id, alert_type, priority_score, state)
    SELECT UUID(), t.task_id, NULL, 'Overdue maintenance',
           (CASE t.priority WHEN 'Critical' THEN 40 WHEN 'High' THEN 30
                            WHEN 'Medium' THEN 20 ELSE 10 END)
         + (CASE e.criticality WHEN 'Critical' THEN 50 WHEN 'Warning' THEN 30
                               ELSE 10 END),
           'Open'
    FROM maintenance_tasks t
    JOIN equipment e ON e.equipment_id = t.equipment_id
    WHERE t.status IN ('Pending', 'In Progress')
      AND t.due_date < CURDATE()
      AND NOT EXISTS (
          SELECT 1 FROM alerts a
          WHERE a.task_id = t.task_id
            AND a.alert_type = 'Overdue maintenance'
            AND a.state IN ('Open', 'Sent', 'Acknowledged'))
"""

# 3. New alerts for documents that are expired or expire within 30 days
CREATE_DOC_ALERTS = """
    INSERT INTO alerts (alert_id, task_id, document_id, alert_type, priority_score, state)
    SELECT UUID(), NULL, d.document_id,
           IF(d.expiry_date < CURDATE(), 'Document expired', 'Document expiring'),
           IF(d.expiry_date < CURDATE(), 40, 20)
         + (CASE e.criticality WHEN 'Critical' THEN 50 WHEN 'Warning' THEN 30
                               ELSE 10 END),
           'Open'
    FROM documents d
    JOIN equipment e ON e.equipment_id = d.equipment_id
    WHERE d.status = 'Active'
      AND d.expiry_date IS NOT NULL
      AND d.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
      AND NOT EXISTS (
          SELECT 1 FROM alerts a
          WHERE a.document_id = d.document_id
            AND a.state IN ('Open', 'Sent', 'Acknowledged'))
"""

# 4. One notification row per alert and person (managers get all,
#    a technician gets the alerts of their own tasks)
CREATE_NOTIFICATIONS = """
    INSERT IGNORE INTO notifications (notification_id, alert_id, user_id)
    SELECT UUID(), a.alert_id, u.user_id
    FROM alerts a JOIN musers u ON u.role = 'manager'
    WHERE a.state = 'Open'
    UNION ALL
    SELECT UUID(), a.alert_id, t.assigned_to
    FROM alerts a JOIN maintenance_tasks t ON t.task_id = a.task_id
    WHERE a.state = 'Open' AND t.assigned_to IS NOT NULL
"""

# 5. What still has to be sent
TO_SEND = """
    SELECT n.notification_id, n.user_id, u.name AS user_name,
           a.alert_type, a.priority_score,
           CASE WHEN a.task_id IS NOT NULL
                THEN CONCAT(t.title, ' (', te.name, ')')
                ELSE CONCAT(d.doc_type, ' (', de.name, ')') END AS item,
           t.due_date, d.expiry_date
    FROM notifications n
    JOIN alerts a ON a.alert_id = n.alert_id
    JOIN musers u ON u.user_id = n.user_id
    LEFT JOIN maintenance_tasks t ON t.task_id = a.task_id
    LEFT JOIN equipment te ON te.equipment_id = t.equipment_id
    LEFT JOIN documents d ON d.document_id = a.document_id
    LEFT JOIN equipment de ON de.equipment_id = d.equipment_id
    WHERE n.status IN ('Pending', 'Failed') AND a.state = 'Open'
    ORDER BY n.user_id, a.priority_score DESC
"""

# 6. An alert is Sent when all its notifications are Sent
MARK_ALERTS_SENT = """
    UPDATE alerts a
    SET a.state = 'Sent', a.sent_at = NOW()
    WHERE a.state = 'Open'
      AND EXISTS (SELECT 1 FROM notifications n WHERE n.alert_id = a.alert_id)
      AND NOT EXISTS (SELECT 1 FROM notifications n
                      WHERE n.alert_id = a.alert_id AND n.status <> 'Sent')
"""


def get_connection():
    return pymysql.connect(
        host=os.environ["DB_HOST"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        database=os.environ["DB_NAME"],
        connect_timeout=5,
        cursorclass=DictCursor,
    )


def lambda_handler(event, context):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(RESOLVE_DONE_TASKS)
            cur.execute(CREATE_TASK_ALERTS)
            cur.execute(CREATE_DOC_ALERTS)
            cur.execute(CREATE_NOTIFICATIONS)
            cur.execute(TO_SEND)
            rows = cur.fetchall()
        conn.commit()

        if not rows:
            print("Nothing to send")
            return {"sent": 0, "failed": 0}

        by_user = {}
        for r in rows:
            by_user.setdefault(r["user_id"], []).append(r)

        sent = failed = 0
        for user_id, items in by_user.items():
            lines = []
            for i, r in enumerate(items, 1):
                when = r["due_date"] or r["expiry_date"]
                extra = f", date {when}" if when else ""
                lines.append(f"{i}. [{r['priority_score']}] {r['alert_type']}: {r['item']}{extra}")
            body = (
                f"Hello {items[0]['user_name']},\n\n"
                "Your open maintenance alerts, highest priority first:\n\n"
                + "\n".join(lines)
            )
            ids = [r["notification_id"] for r in items]
            marks = ", ".join(["%s"] * len(ids))

            try:
                sns.publish(
                    TopicArn=os.environ["TOPIC_ARN"],
                    Subject=f"MainTroll: {len(items)} maintenance alerts for you",
                    Message=body,
                    MessageAttributes={
                        "audience": {"DataType": "String", "StringValue": user_id}
                    },
                )
                status = "Sent"
                sent += len(ids)
            except Exception as e:
                print(f"SNS failed for {user_id}: {e}")
                status = "Failed"
                failed += len(ids)

            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE notifications SET status = %s, "
                    f"sent_at = IF(%s = 'Sent', NOW(), NULL) "
                    f"WHERE notification_id IN ({marks})",
                    [status, status, *ids],
                )
            conn.commit()

        with conn.cursor() as cur:
            cur.execute(MARK_ALERTS_SENT)
        conn.commit()

        print(f"Sent {sent}, failed {failed}")
        return {"sent": sent, "failed": failed}
    finally:
        conn.close()
