import json
import os

import pymysql

MAX_ROWS = 20   # hard cap on rows returned to the model

# Task statuses that mean "finished" (same rule as your dashboard).
# Check with: SHOW COLUMNS FROM maintenance_tasks LIKE 'status';
DONE_TASK_STATUSES = ("Completed", "Cancelled")

_conn = None    # reused between invocations while the container is warm


def get_conn():
    global _conn
    if _conn is not None:
        try:
            _conn.ping(reconnect=True)
            return _conn
        except Exception:
            _conn = None
    _conn = pymysql.connect(
        host=os.environ["DB_HOST"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        database=os.environ["DB_NAME"],
        connect_timeout=5,
        read_timeout=8,
        charset="utf8mb4",
        autocommit=True,   # avoids stale reads on a reused connection
        cursorclass=pymysql.cursors.DictCursor,
    )
    return _conn


def run_query(sql, params=()):
    with get_conn().cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def clamp_int(value, default, low, high):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def like_pattern(text):
    """Turn user text into a safe 'contains' pattern for LIKE."""
    text = str(text or "").strip()[:80]
    for char in ("\\", "%", "_"):
        text = text.replace(char, "\\" + char)
    return "%" + text + "%"


def not_done():
    """SQL piece (fixed text + placeholders) for 'task is not finished'."""
    marks = ", ".join(["%s"] * len(DONE_TASK_STATUSES))
    return f"t.status NOT IN ({marks})", list(DONE_TASK_STATUSES)


def get_overdue_equipment(params, user):
    cond, p = not_done()
    sql = f"""
        SELECT e.name AS equipment, e.location, e.criticality,
               t.title AS task, t.priority, t.due_date,
               DATEDIFF(CURDATE(), t.due_date) AS days_overdue
        FROM maintenance_tasks t
        JOIN equipment e ON e.equipment_id = t.equipment_id
        WHERE {cond} AND t.due_date < CURDATE()
        ORDER BY t.due_date ASC
        LIMIT {MAX_ROWS}
    """
    return run_query(sql, p)


def get_upcoming_maintenance(params, user):
    days = clamp_int(params.get("days"), default=14, low=1, high=90)
    cond, p = not_done()
    sql = f"""
        SELECT e.name AS equipment, e.location, t.title AS task,
               t.priority, t.status, t.due_date
        FROM maintenance_tasks t
        JOIN equipment e ON e.equipment_id = t.equipment_id
        WHERE {cond}
          AND t.due_date BETWEEN CURDATE()
                             AND DATE_ADD(CURDATE(), INTERVAL %s DAY)
        ORDER BY t.due_date ASC
        LIMIT {MAX_ROWS}
    """
    return run_query(sql, p + [days])


def get_equipment_details(params, user):
    search = str(params.get("search", "")).strip()
    if not search:
        return {"error": "Please give an equipment name."}

    matches = run_query(
        """SELECT equipment_id, name, location, criticality, status
           FROM equipment WHERE name LIKE %s ORDER BY name LIMIT 5""",
        (like_pattern(search),),
    )
    if not matches:
        return {"matches": [], "note": "No equipment found with that name."}

    # never send the internal ids to the model
    public = [{k: v for k, v in m.items() if k != "equipment_id"} for m in matches]
    if len(matches) > 1:
        return {"matches": public,
                "note": "More than one match: ask the user which one they mean."}

    # exactly one match: add its open tasks, documents and recent alerts
    eid = matches[0]["equipment_id"]
    cond, p = not_done()
    return {
        "equipment": public[0],
        "open_tasks": run_query(
            f"""SELECT t.title, t.priority, t.status, t.due_date
                FROM maintenance_tasks t
                WHERE t.equipment_id = %s AND {cond}
                ORDER BY t.due_date LIMIT 10""",
            [eid] + p,
        ),
        "documents": run_query(
            """SELECT doc_type, status, expiry_date FROM documents
               WHERE equipment_id = %s ORDER BY expiry_date LIMIT 10""",
            (eid,),
        ),
        "recent_alerts": run_query(
            """SELECT a.alert_type, a.priority_score, a.state, a.sent_at
               FROM alerts a
               LEFT JOIN maintenance_tasks t ON t.task_id = a.task_id
               LEFT JOIN documents d ON d.document_id = a.document_id
               WHERE t.equipment_id = %s OR d.equipment_id = %s
               ORDER BY a.sent_at DESC LIMIT 10""",
            (eid, eid),
        ),
    }


def get_maintenance_history(params, user):
    search = str(params.get("equipment_name", "")).strip()
    if not search:
        return {"error": "Please give an equipment name."}
    sql = f"""
        SELECT e.name AS equipment, t.title AS task, t.priority,
               t.status, t.due_date
        FROM maintenance_tasks t
        JOIN equipment e ON e.equipment_id = t.equipment_id
        WHERE e.name LIKE %s
        ORDER BY t.due_date DESC
        LIMIT {MAX_ROWS}
    """
    return run_query(sql, (like_pattern(search),))


def get_maintenance_summary(params, user):
    cond, p = not_done()
    overdue = run_query(
        f"""SELECT COUNT(*) AS total FROM maintenance_tasks t
            WHERE {cond} AND t.due_date < CURDATE()""",
        p,
    )
    documents = run_query(
        """SELECT
             COALESCE(SUM(status <> 'Archived' AND expiry_date < CURDATE()), 0) AS expired,
             COALESCE(SUM(status <> 'Archived' AND expiry_date BETWEEN CURDATE()
                          AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)), 0)
               AS expiring_within_30_days
           FROM documents"""
    )
    return {
        "tasks_by_status": run_query(
            "SELECT status, COUNT(*) AS total FROM maintenance_tasks GROUP BY status"
        ),
        "overdue_tasks": overdue[0]["total"],
        "documents": documents[0],
        "alerts_by_state": run_query(
            "SELECT state, COUNT(*) AS total FROM alerts GROUP BY state"
        ),
    }


def get_expiring_documents(params, user):
    days = clamp_int(params.get("days"), default=30, low=1, high=365)
    sql = f"""
        SELECT e.name AS equipment, d.doc_type, d.status, d.expiry_date,
               DATEDIFF(d.expiry_date, CURDATE()) AS days_left
        FROM documents d
        JOIN equipment e ON e.equipment_id = d.equipment_id
        WHERE d.status <> 'Archived'
          AND d.expiry_date IS NOT NULL
          AND d.expiry_date <= DATE_ADD(CURDATE(), INTERVAL %s DAY)
        ORDER BY d.expiry_date ASC
        LIMIT {MAX_ROWS}
    """
    return run_query(sql, (days,))   # negative days_left = already expired


# ---- Only these six actions can ever run ---------------------------------
ACTIONS = {
    "get_overdue_equipment": get_overdue_equipment,
    "get_upcoming_maintenance": get_upcoming_maintenance,
    "get_equipment_details": get_equipment_details,
    "get_maintenance_history": get_maintenance_history,
    "get_maintenance_summary": get_maintenance_summary,
    "get_expiring_documents": get_expiring_documents,
}


def lambda_handler(event, context):
    handler = ACTIONS.get(event.get("action"))
    if handler is None:
        return {"error": "Unknown action."}
    params = event.get("params") if isinstance(event.get("params"), dict) else {}
    user = event.get("user") if isinstance(event.get("user"), dict) else {}
    try:
        data = handler(params, user)
        # default=str turns dates and decimals into text so Lambda can return them
        return json.loads(json.dumps({"data": data}, default=str))
    except Exception as err:
        print("Data error:", event.get("action"), repr(err))
        return {"error": "The records could not be retrieved."}